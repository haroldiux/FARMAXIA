import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import {
  changedFields,
  normalizeProfile,
  type ProductProfile,
  type ProductProfileInput,
  type SaleClassification
} from "./product-profile.js";
import {
  IdempotencyKeyReusedError,
  IdempotencyService,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";

export interface CatalogCategoryInput {
  name: string;
  isControlled: boolean;
}

export type CatalogProductInput = ProductProfileInput & { name: string };

export type CatalogProductUpdate = ProductProfileInput & { isActive?: boolean };

export interface CatalogCategoryUpdate {
  name?: string;
  isControlled?: boolean;
  isActive?: boolean;
}

export interface CatalogPresentationUpdate {
  name?: string;
  isSellable?: boolean;
  isActive?: boolean;
}

export interface CatalogCategorySummary {
  id: string;
  name: string;
  isControlled: boolean;
  isActive: boolean;
  products: number;
}

export interface CatalogProductDetail extends ProductProfile {
  productId: string;
  categoryName: string | null;
  categoryIsControlled: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  presentations: Array<{
    presentationId: string;
    name: string;
    baseUnitFactor: number;
    isSellable: boolean;
    isActive: boolean;
    barcodes: string[];
    currentPrice: { amount: string; currency: string; priceListName: string } | null;
  }>;
}

export interface CatalogPresentationInput {
  productId: string;
  name: string;
  baseUnitFactor: number;
  isSellable: boolean;
}

export interface CatalogPriceListInput {
  name: string;
  currency: string;
  branchId?: string;
  idempotencyKey?: string;
}

export interface CatalogPriceInput {
  priceListId: string;
  presentationId: string;
  amount: string;
  validFrom: Date;
  validTo?: Date;
  idempotencyKey?: string;
}

export interface CatalogHomologationInput {
  productId: string;
  authority: string;
  externalCode: string;
  externalDescription?: string;
}

export interface BarcodeInput {
  presentationId: string;
  barcode: string;
  idempotencyKey?: string;
}

export interface BarcodeLookup {
  productId: string;
  productName: string;
  presentationId: string;
  presentationName: string;
  baseUnitFactor: number;
  priceAmount: string | null;
  priceCurrency: string | null;
}

export interface CatalogListQuery {
  search?: string;
  limit?: number;
  offset?: number;
  categoryId?: string;
  /** Solo controlados / solo cadena de frío. */
  controlled?: boolean;
  coldChain?: boolean;
  /** Incluye productos y presentaciones desactivados (administración del catálogo). */
  includeInactive?: boolean;
}

export interface CatalogPresentationSummary {
  presentationId: string;
  name: string;
  baseUnitFactor: number;
  isSellable: boolean;
  isActive: boolean;
}

export interface CatalogProductSummary {
  productId: string;
  name: string;
  activeIngredient: string | null;
  genericName: string | null;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  laboratory: string | null;
  saleClassification: SaleClassification;
  /** Controlado por el producto o por su categoría. */
  isControlled: boolean;
  requiresColdChain: boolean;
  isActive: boolean;
  categoryId: string | null;
  categoryName: string | null;
  presentations: CatalogPresentationSummary[];
}

export interface CatalogProductPage {
  items: CatalogProductSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface CatalogPriceListSummary {
  id: string;
  name: string;
  currency: string;
  branchId: string | null;
}

export interface CatalogPriceListPage {
  items: CatalogPriceListSummary[];
}

interface CreatedRow {
  id: string;
}

interface HomologationRow extends CreatedRow {
  authority: string;
  externalCode: string;
}

export class CatalogValidationError extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}

export class CatalogPriceOverlapError extends ConflictException {
  readonly code = "CATALOG_PRICE_OVERLAP";

  constructor() {
    super({ code: "CATALOG_PRICE_OVERLAP", message: "Price interval overlaps an existing price in the same scope." });
  }
}

export class CatalogIdempotencyKeyReusedError extends ConflictException {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super({ code: "IDEMPOTENCY_KEY_REUSED", message: "Idempotency key reused with conflicting request payload." });
  }
}

interface ProductListRow extends CatalogProductSummary {
  total: number;
}

interface PriceListScopeRow {
  branchId: string | null;
}

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new CatalogValidationError(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return normalized;
}

function amountText(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) {
    throw new CatalogValidationError("Price amount must be a non-negative decimal with up to four places.");
  }
  return normalized;
}

function validCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new CatalogValidationError("Currency must be a three-letter ISO code.");
  }
  return normalized;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, field: string): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new NotFoundException({ code: "NOT_FOUND", field, message: "El registro no existe." });
  }
}

// Columnas de la ficha del producto en el mismo orden que profileValues().
const profileColumns = [
  "name", "category_id", "active_ingredient", "generic_name", "concentration", "pharmaceutical_form",
  "laboratory", "sanitary_registration", "sale_classification", "is_controlled", "requires_cold_chain",
  "cold_chain_min_celsius", "cold_chain_max_celsius", "sin_activity_code", "sin_product_code", "sin_unit_code"
] as const;

function profileValues(profile: ProductProfile): unknown[] {
  return [
    profile.name, profile.categoryId, profile.activeIngredient, profile.genericName, profile.concentration,
    profile.pharmaceuticalForm, profile.laboratory, profile.sanitaryRegistration, profile.saleClassification,
    profile.isControlled, profile.requiresColdChain, profile.coldChainMinCelsius, profile.coldChainMaxCelsius,
    profile.sinActivityCode, profile.sinProductCode, profile.sinUnitCode
  ];
}

const profileSelect = `
  product.name, product.category_id as "categoryId", product.active_ingredient as "activeIngredient",
  product.generic_name as "genericName", product.concentration, product.pharmaceutical_form as "pharmaceuticalForm",
  product.laboratory, product.sanitary_registration as "sanitaryRegistration",
  product.sale_classification as "saleClassification", product.is_controlled as "isControlled",
  product.requires_cold_chain as "requiresColdChain",
  product.cold_chain_min_celsius::text as "coldChainMinCelsius", product.cold_chain_max_celsius::text as "coldChainMaxCelsius",
  product.sin_activity_code as "sinActivityCode", product.sin_product_code as "sinProductCode",
  product.sin_unit_code as "sinUnitCode"`;

function validFactor(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CatalogValidationError("Base unit factor must be a positive safe integer.");
  }
  return value;
}

@Injectable()
export class CatalogService {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async createCategory(scope: TenantScope, input: CatalogCategoryInput): Promise<CreatedRow> {
    const name = requiredText(input.name ?? "", "Category name", 160);
    const isControlled = input.isControlled === true;
    return this.catalogWrite(async () => this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into product_categories (tenant_id, name, is_controlled)
         values ($1, $2, $3)
         returning id`,
        [scope.tenantId, name, isControlled]
      );
      const created = this.requireCreated(rows[0]);
      await this.audit.recordInTransaction(client, {
        action: "catalog.category_created",
        entityType: "product_category",
        entityId: created.id,
        payload: { name, isControlled }
      });
      return created;
    }), "Ya existe una categoría con ese nombre.");
  }

  async listCategories(scope: TenantScope): Promise<CatalogCategorySummary[]> {
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CatalogCategorySummary>(
        `select category.id, category.name, category.is_controlled as "isControlled", category.is_active as "isActive",
                (select count(*)::int from products where products.tenant_id = category.tenant_id
                   and products.category_id = category.id and products.is_active) as products
         from product_categories as category
         where category.tenant_id = $1
         order by category.is_active desc, category.name`,
        [scope.tenantId]
      );
      return rows;
    });
  }

  async updateCategory(scope: TenantScope, categoryId: string, input: CatalogCategoryUpdate): Promise<void> {
    assertUuid(categoryId, "categoryId");
    const name = input.name === undefined ? undefined : requiredText(input.name, "Category name", 160);
    for (const [field, value] of [["isControlled", input.isControlled], ["isActive", input.isActive]] as const) {
      if (value !== undefined && typeof value !== "boolean") {
        throw new CatalogValidationError(`${field} must be a boolean.`);
      }
    }
    await this.catalogWrite(async () => this.database.withScope(scope, async (client) => {
      const { rowCount } = await client.query(
        `update product_categories
         set name = coalesce($3, name),
             is_controlled = coalesce($4, is_controlled),
             is_active = coalesce($5, is_active),
             updated_at = now()
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, categoryId, name ?? null, input.isControlled ?? null, input.isActive ?? null]
      );
      if (!rowCount) {
        throw new NotFoundException({ code: "CATEGORY_NOT_FOUND", message: "La categoría no existe." });
      }
      if (input.isControlled === true) {
        // Una categoría controlada vuelve controlados a sus productos.
        await client.query(
          "update products set is_controlled = true, updated_at = now() where tenant_id = $1 and category_id = $2 and not is_controlled",
          [scope.tenantId, categoryId]
        );
      }
      await this.audit.recordInTransaction(client, {
        action: "catalog.category_updated",
        entityType: "product_category",
        entityId: categoryId,
        payload: { name, isControlled: input.isControlled, isActive: input.isActive }
      });
    }), "Ya existe una categoría con ese nombre.");
  }

  async createProduct(scope: TenantScope, input: CatalogProductInput): Promise<CreatedRow> {
    const profile = normalizeProfile(input ?? {});
    return this.catalogWrite(async () => this.database.withScope(scope, async (client) => {
      const categoryControlled = await this.categoryControlled(client, scope.tenantId, profile.categoryId);
      const saved = { ...profile, isControlled: profile.isControlled || categoryControlled };
      const { rows } = await client.query<CreatedRow>(
        `insert into products (tenant_id, ${profileColumns.join(", ")})
         values ($1, ${profileColumns.map((_, index) => `$${index + 2}`).join(", ")})
         returning id`,
        [scope.tenantId, ...profileValues(saved)]
      );
      const created = this.requireCreated(rows[0]);
      await this.audit.recordInTransaction(client, {
        action: "catalog.product_created",
        entityType: "product",
        entityId: created.id,
        payload: { ...saved }
      });
      return created;
    }));
  }

  async getProduct(scope: TenantScope, productId: string, at = new Date()): Promise<CatalogProductDetail> {
    assertUuid(productId, "productId");
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CatalogProductDetail>(
        `select product.id as "productId", ${profileSelect},
                category.name as "categoryName", coalesce(category.is_controlled, false) as "categoryIsControlled",
                product.is_active as "isActive", product.created_at as "createdAt", product.updated_at as "updatedAt",
                coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'presentationId', presentation.id,
                    'name', presentation.name,
                    'baseUnitFactor', presentation.base_unit_factor::int,
                    'isSellable', presentation.is_sellable,
                    'isActive', presentation.is_active,
                    'barcodes', coalesce((
                      select jsonb_agg(barcode.barcode order by barcode.barcode)
                      from product_barcodes as barcode
                      where barcode.tenant_id = presentation.tenant_id and barcode.presentation_id = presentation.id
                    ), '[]'::jsonb),
                    'currentPrice', (
                      select jsonb_build_object('amount', price.amount::text, 'currency', list.currency, 'priceListName', list.name)
                      from presentation_prices as price
                      join price_lists as list on list.tenant_id = price.tenant_id and list.id = price.price_list_id
                      where price.tenant_id = presentation.tenant_id
                        and price.presentation_id = presentation.id
                        and price.valid_from <= $3
                        and (price.valid_to is null or price.valid_to > $3)
                        and list.is_active
                        and (list.branch_id is null or list.branch_id = $4)
                      order by case when list.branch_id = $4 then 0 else 1 end, price.valid_from desc
                      limit 1
                    )
                  ) order by presentation.is_active desc, presentation.base_unit_factor desc, presentation.name)
                  from product_presentations as presentation
                  where presentation.tenant_id = product.tenant_id and presentation.product_id = product.id
                ), '[]'::jsonb) as presentations
         from products as product
         left join product_categories as category
           on category.tenant_id = product.tenant_id and category.id = product.category_id
         where product.tenant_id = $1 and product.id = $2`,
        [scope.tenantId, productId, at, scope.branchId]
      );
      const product = rows[0];
      if (!product) {
        throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "El producto no existe." });
      }
      return product;
    });
  }

  async updateProduct(scope: TenantScope, productId: string, input: CatalogProductUpdate): Promise<void> {
    assertUuid(productId, "productId");
    if (input?.isActive !== undefined && typeof input.isActive !== "boolean") {
      throw new CatalogValidationError("isActive must be a boolean.");
    }
    await this.catalogWrite(async () => this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<ProductProfile & { isActive: boolean }>(
        `select ${profileSelect}, product.is_active as "isActive"
         from products as product
         where product.tenant_id = $1 and product.id = $2
         for update`,
        [scope.tenantId, productId]
      );
      const current = rows[0];
      if (!current) {
        throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "El producto no existe." });
      }
      const { isActive: currentActive, ...currentProfile } = current;
      const next = normalizeProfile(input ?? {}, currentProfile);
      next.isControlled = next.isControlled || await this.categoryControlled(client, scope.tenantId, next.categoryId);
      const changes = changedFields(currentProfile, next);
      const isActive = input?.isActive ?? currentActive;
      if (!Object.keys(changes).length && isActive === currentActive) {
        return;
      }

      await client.query(
        `update products
         set ${profileColumns.map((column, index) => `${column} = $${index + 3}`).join(", ")},
             is_active = $${profileColumns.length + 3},
             updated_at = now()
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, productId, ...profileValues(next), isActive]
      );
      if (Object.keys(changes).length) {
        await this.audit.recordInTransaction(client, {
          action: "catalog.product_updated",
          entityType: "product",
          entityId: productId,
          payload: { changes }
        });
      }
      if (isActive !== currentActive) {
        await this.audit.recordInTransaction(client, {
          action: isActive ? "catalog.product_reactivated" : "catalog.product_deactivated",
          entityType: "product",
          entityId: productId,
          payload: { name: next.name }
        });
      }
    }));
  }

  async createPresentation(
    scope: TenantScope,
    input: CatalogPresentationInput
  ): Promise<CreatedRow> {
    const name = requiredText(input.name ?? "", "Presentation name", 160);
    const factor = validFactor(Number(input.baseUnitFactor));
    const isSellable = input.isSellable !== false;
    assertUuid(input.productId, "productId");
    return this.catalogWrite(async () => this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into product_presentations
           (tenant_id, product_id, name, base_unit_factor, is_sellable)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [scope.tenantId, input.productId, name, factor, isSellable]
      );
      const created = this.requireCreated(rows[0]);
      await this.audit.recordInTransaction(client, {
        action: "catalog.presentation_created",
        entityType: "product_presentation",
        entityId: created.id,
        payload: { productId: input.productId, name, baseUnitFactor: factor, isSellable }
      });
      return created;
    }), "Ese producto ya tiene una presentación con ese nombre.");
  }

  /**
   * El factor de conversión no se edita: el stock y las ventas ya registradas dependen de
   * él. Para cambiarlo se crea otra presentación y se desactiva la anterior.
   */
  async updatePresentation(scope: TenantScope, presentationId: string, input: CatalogPresentationUpdate & { baseUnitFactor?: unknown }): Promise<void> {
    assertUuid(presentationId, "presentationId");
    if (input?.baseUnitFactor !== undefined) {
      throw new ConflictException({
        code: "FACTOR_IMMUTABLE",
        message: "El factor de conversión no se puede cambiar. Crea una presentación nueva y desactiva esta."
      });
    }
    const name = input?.name === undefined ? undefined : requiredText(input.name, "Presentation name", 160);
    for (const [field, value] of [["isSellable", input?.isSellable], ["isActive", input?.isActive]] as const) {
      if (value !== undefined && typeof value !== "boolean") {
        throw new CatalogValidationError(`${field} must be a boolean.`);
      }
    }
    await this.catalogWrite(async () => this.database.withScope(scope, async (client) => {
      const { rowCount } = await client.query(
        `update product_presentations
         set name = coalesce($3, name),
             is_sellable = coalesce($4, is_sellable),
             is_active = coalesce($5, is_active),
             updated_at = now()
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, presentationId, name ?? null, input?.isSellable ?? null, input?.isActive ?? null]
      );
      if (!rowCount) {
        throw new NotFoundException({ code: "PRESENTATION_NOT_FOUND", message: "La presentación no existe." });
      }
      await this.audit.recordInTransaction(client, {
        action: "catalog.presentation_updated",
        entityType: "product_presentation",
        entityId: presentationId,
        payload: { name, isSellable: input?.isSellable, isActive: input?.isActive }
      });
    }), "Ese producto ya tiene una presentación con ese nombre.");
  }

  private async categoryControlled(client: PoolClient, tenantId: string, categoryId: string | null): Promise<boolean> {
    if (!categoryId) {
      return false;
    }
    const { rows } = await client.query<{ isControlled: boolean }>(
      `select is_controlled as "isControlled" from product_categories where tenant_id = $1 and id = $2 and is_active`,
      [tenantId, categoryId]
    );
    if (!rows[0]) {
      throw new CatalogValidationError("La categoría no existe o está desactivada.");
    }
    return rows[0].isControlled;
  }

  /** Traduce duplicados y referencias inválidas a respuestas claras. */
  private async catalogWrite<T>(operation: () => Promise<T>, duplicateMessage = "Ese registro ya existe."): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictException({ code: "DUPLICATE", message: duplicateMessage });
      }
      if (code === "23503") {
        throw new CatalogValidationError("Alguna referencia no existe en esta farmacia.");
      }
      if (code === "23514") {
        throw new CatalogValidationError("Los datos no cumplen las reglas del catálogo.");
      }
      throw error;
    }
  }

  async registerBarcode(scope: TenantScope, input: BarcodeInput): Promise<CreatedRow> {
    const barcode = requiredText(input.barcode, "Barcode", 80);
    const presentationId = requiredText(input.presentationId, "Presentation ID", 64);
    return this.executeMutation(
      scope,
      "catalog.register_barcode",
      input.idempotencyKey,
      { barcode, presentationId },
      async (client) => {
        const { rows } = await client.query<CreatedRow>(
          `insert into product_barcodes (tenant_id, presentation_id, barcode)
           values ($1, $2, $3)
           returning id`,
          [scope.tenantId, presentationId, barcode]
        );
        const created = this.requireCreated(rows[0]);
        await this.audit.recordInTransaction(client, {
          action: "catalog.barcode_registered",
          entityType: "product_barcode",
          entityId: created.id,
          payload: { barcode, presentationId }
        });
        return created;
      }
    );
  }

  async createPriceList(scope: TenantScope, input: CatalogPriceListInput): Promise<CreatedRow> {
    const name = requiredText(input.name, "Price list name", 120);
    const currency = validCurrency(input.currency);
    if (input.branchId && input.branchId !== scope.branchId) {
      throw new CatalogValidationError("Price list branch must match the active branch scope.");
    }
    const branchId = input.branchId ?? null;
    return this.executeMutation(
      scope,
      "catalog.create_price_list",
      input.idempotencyKey,
      { name, currency, branchId },
      async (client) => {
        const { rows } = await client.query<CreatedRow>(
          `insert into price_lists (tenant_id, branch_id, name, currency)
           values ($1, $2, $3, $4)
           returning id`,
          [scope.tenantId, branchId, name, currency]
        );
        const created = this.requireCreated(rows[0]);
        await this.audit.recordInTransaction(client, {
          action: "catalog.price_list_created",
          entityType: "price_list",
          entityId: created.id,
          payload: { name, currency, branchId }
        });
        return created;
      }
    );
  }

  async listPriceLists(scope: TenantScope): Promise<CatalogPriceListPage> {
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CatalogPriceListSummary>(
        `select id, name, currency, branch_id as "branchId"
         from price_lists
         where tenant_id = $1
           and is_active
           and (branch_id is null or branch_id = $2)
         order by case when branch_id = $2 then 0 else 1 end, name asc, id asc`,
        [scope.tenantId, scope.branchId]
      );
      return { items: rows };
    });
  }

  async setPrice(scope: TenantScope, input: CatalogPriceInput): Promise<CreatedRow> {
    const amount = amountText(input.amount);
    if (!(input.validFrom instanceof Date) || Number.isNaN(input.validFrom.getTime())) {
      throw new CatalogValidationError("Price validFrom must be a valid date.");
    }
    if (input.validTo && (!(input.validTo instanceof Date) || Number.isNaN(input.validTo.getTime()) || input.validTo <= input.validFrom)) {
      throw new CatalogValidationError("Price validTo must be later than validFrom.");
    }
    const priceListId = requiredText(input.priceListId, "Price list ID", 64);
    const presentationId = requiredText(input.presentationId, "Presentation ID", 64);
    const validFrom = input.validFrom.toISOString();
    const validTo = input.validTo?.toISOString() ?? null;
    return this.executeMutation(
      scope,
      "catalog.set_price",
      input.idempotencyKey,
      { amount, priceListId, presentationId, validFrom, validTo },
      async (client) => {
        const scopeResult = await client.query<PriceListScopeRow>(
          `select branch_id as "branchId"
           from price_lists
           where tenant_id = $1 and id = $2 and is_active
           for key share`,
          [scope.tenantId, priceListId]
        );
        const priceList = scopeResult.rows[0];
        if (!priceList) {
          throw new CatalogValidationError("Price list is not available in the active branch scope.");
        }
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${scope.tenantId}:${presentationId}:${priceList.branchId ?? "global"}`
        ]);
        const overlap = await client.query<{ id: string }>(
          `select price.id
           from presentation_prices as price
           join price_lists as list
             on list.tenant_id = price.tenant_id and list.id = price.price_list_id
           where price.tenant_id = $1
             and price.presentation_id = $2
             and list.branch_id is not distinct from $3::uuid
             and price.valid_from < coalesce($5::timestamptz, 'infinity'::timestamptz)
             and coalesce(price.valid_to, 'infinity'::timestamptz) > $4::timestamptz
           limit 1`,
          [scope.tenantId, presentationId, priceList.branchId, validFrom, validTo]
        );
        if (overlap.rows[0]) {
          throw new CatalogPriceOverlapError();
        }
        const { rows } = await client.query<CreatedRow>(
          `insert into presentation_prices
             (tenant_id, price_list_id, presentation_id, amount, valid_from, valid_to)
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [scope.tenantId, priceListId, presentationId, amount, validFrom, validTo]
        );
        const created = this.requireCreated(rows[0]);
        await this.audit.recordInTransaction(client, {
          action: "catalog.price_set",
          entityType: "presentation_price",
          entityId: created.id,
          payload: { amount, priceListId, presentationId, validFrom, validTo, branchId: priceList.branchId }
        });
        return created;
      }
    );
  }

  private requireCreated(row: CreatedRow | undefined): CreatedRow {
    if (!row) {
      throw new Error("Catalog mutation did not return its created record.");
    }
    return row;
  }

  private async executeMutation<T>(
    scope: TenantScope,
    operation: string,
    idempotencyKey: string | undefined,
    payload: Record<string, unknown>,
    action: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    try {
      if (!idempotencyKey) {
        return await this.database.withScope(scope, action);
      }
      const result = await this.idempotency.execute(
        this.database,
        scope,
        operation,
        requiredText(idempotencyKey, "Idempotency key", 200),
        payload,
        async (client): Promise<IdempotentExecutionResult<T>> => ({
          statusCode: 201,
          body: await action(client)
        })
      );
      return (result.body ?? result.data) as T;
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) {
        throw new CatalogIdempotencyKeyReusedError();
      }
      const databaseCode = (error as { code?: string }).code;
      if (databaseCode === "23505") {
        throw new ConflictException("Catalog record already exists in this tenant.");
      }
      throw error;
    }
  }

  async addHomologation(
    scope: TenantScope,
    input: CatalogHomologationInput
  ): Promise<HomologationRow> {
    const authority = requiredText(input.authority, "Homologation authority", 80).toUpperCase();
    const externalCode = requiredText(input.externalCode, "External code", 120);
    const externalDescription = input.externalDescription?.trim() || null;
    if (externalDescription && externalDescription.length > 255) {
      throw new Error("External description must be at most 255 characters.");
    }
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<HomologationRow>(
        `insert into product_homologations
           (tenant_id, product_id, authority, external_code, external_description)
         values ($1, $2, $3, $4, $5)
         returning id, authority, external_code as "externalCode"`,
        [scope.tenantId, input.productId, authority, externalCode, externalDescription]
      );
      return rows[0] as HomologationRow;
    });
  }

  async listProducts(scope: TenantScope, input: CatalogListQuery = {}): Promise<CatalogProductPage> {
    const search = input.search?.trim() ?? "";
    if (search.length > 120) {
      throw new Error("Catalog search must be at most 120 characters.");
    }
    const limit = input.limit ?? 25;
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Catalog limit must be an integer between 1 and 100.");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Catalog offset must be a non-negative integer.");
    }

    if (input.categoryId !== undefined && input.categoryId !== "" && !uuidPattern.test(input.categoryId)) {
      throw new CatalogValidationError("categoryId must be a UUID.");
    }
    const includeInactive = input.includeInactive === true;

    return this.database.withScope(scope, async (client) => {
      // La búsqueda cubre nombre comercial, genérico, principio activo, laboratorio y
      // código de barras exacto de cualquiera de sus presentaciones.
      const { rows } = await client.query<ProductListRow>(
        `with filtered_products as (
           select
             product.id,
             product.name,
             product.active_ingredient as "activeIngredient",
             product.generic_name as "genericName",
             product.concentration,
             product.pharmaceutical_form as "pharmaceuticalForm",
             product.laboratory,
             product.sale_classification as "saleClassification",
             (product.is_controlled or coalesce(category.is_controlled, false)) as "isControlled",
             product.requires_cold_chain as "requiresColdChain",
             product.is_active as "isActive",
             product.category_id as "categoryId",
             category.name as "categoryName"
           from products as product
           left join product_categories as category
             on category.tenant_id = product.tenant_id
            and category.id = product.category_id
           where product.tenant_id = $1
             and ($5 or product.is_active)
             and ($6::uuid is null or product.category_id = $6::uuid)
             and ($7::boolean is null or (product.is_controlled or coalesce(category.is_controlled, false)) = $7::boolean)
             and ($8::boolean is null or product.requires_cold_chain = $8::boolean)
             and (
               $2 = ''
               or lower(product.name) like '%' || lower($2) || '%'
               or lower(coalesce(product.active_ingredient, '')) like '%' || lower($2) || '%'
               or lower(coalesce(product.generic_name, '')) like '%' || lower($2) || '%'
               or lower(coalesce(product.laboratory, '')) like '%' || lower($2) || '%'
               or exists (
                 select 1 from product_barcodes as barcode
                 join product_presentations as coded on coded.tenant_id = barcode.tenant_id and coded.id = barcode.presentation_id
                 where barcode.tenant_id = product.tenant_id and coded.product_id = product.id and barcode.barcode = $2
               )
             )
         )
         select
           filtered.id as "productId",
           filtered.name,
           filtered."activeIngredient",
           filtered."genericName",
           filtered.concentration,
           filtered."pharmaceuticalForm",
           filtered.laboratory,
           filtered."saleClassification",
           filtered."isControlled",
           filtered."requiresColdChain",
           filtered."isActive",
           filtered."categoryId",
           filtered."categoryName",
           count(*) over()::int as total,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'presentationId', presentation.id,
                 'name', presentation.name,
                 'baseUnitFactor', presentation.base_unit_factor::int,
                 'isSellable', presentation.is_sellable,
                 'isActive', presentation.is_active
               ) order by presentation.name
             ) filter (where presentation.id is not null),
             '[]'::jsonb
           ) as presentations
         from filtered_products as filtered
         left join product_presentations as presentation
           on presentation.tenant_id = $1
          and presentation.product_id = filtered.id
          and ($5 or presentation.is_active)
         group by filtered.id, filtered.name, filtered."activeIngredient", filtered."genericName", filtered.concentration,
                  filtered."pharmaceuticalForm", filtered.laboratory, filtered."saleClassification", filtered."isControlled",
                  filtered."requiresColdChain", filtered."isActive", filtered."categoryId", filtered."categoryName"
         order by filtered."isActive" desc, filtered.name
         limit $3 offset $4`,
        [
          scope.tenantId,
          search,
          limit,
          offset,
          includeInactive,
          input.categoryId || null,
          input.controlled ?? null,
          input.coldChain ?? null
        ]
      );
      const total = rows[0]?.total ?? 0;
      return {
        items: rows.map(({ total: _total, ...item }) => item),
        total,
        limit,
        offset
      };
    });
  }

  async findByBarcode(
    scope: TenantScope,
    barcode: string,
    at = new Date()
  ): Promise<BarcodeLookup | null> {
    const normalizedBarcode = requiredText(barcode, "Barcode", 80);
    if (Number.isNaN(at.getTime())) {
      throw new Error("Lookup date must be valid.");
    }
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<BarcodeLookup>(
        `select
           product.id as "productId",
           product.name as "productName",
           presentation.id as "presentationId",
           presentation.name as "presentationName",
           presentation.base_unit_factor::int as "baseUnitFactor",
           selected_price.amount as "priceAmount",
           selected_price.currency as "priceCurrency"
         from product_barcodes as barcode
         join product_presentations as presentation
           on presentation.tenant_id = barcode.tenant_id
          and presentation.id = barcode.presentation_id
         join products as product
           on product.tenant_id = presentation.tenant_id
          and product.id = presentation.product_id
         left join lateral (
           select price.amount, price_list.currency
           from presentation_prices as price
           join price_lists as price_list
             on price_list.tenant_id = price.tenant_id
            and price_list.id = price.price_list_id
           where price.tenant_id = barcode.tenant_id
             and price.presentation_id = presentation.id
             and price.valid_from <= $3
             and (price.valid_to is null or price.valid_to > $3)
             and price_list.is_active
             and (price_list.branch_id is null or price_list.branch_id = $4)
           order by
             case when price_list.branch_id = $4 then 0 else 1 end,
             price.valid_from desc
           limit 1
         ) as selected_price on true
         where barcode.tenant_id = $1
           and barcode.barcode = $2
           and product.is_active
           and presentation.is_sellable
           and presentation.is_active
         limit 1`,
        [scope.tenantId, normalizedBarcode, at, scope.branchId]
      );
      return rows[0] ?? null;
    });
  }
}
