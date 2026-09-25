import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import {
  IdempotencyKeyReusedError,
  IdempotencyService,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";

export interface CatalogCategoryInput {
  name: string;
  isControlled: boolean;
}

export interface CatalogProductInput {
  name: string;
  categoryId?: string;
  activeIngredient?: string;
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
}

export interface CatalogPresentationSummary {
  presentationId: string;
  name: string;
  baseUnitFactor: number;
  isSellable: boolean;
}

export interface CatalogProductSummary {
  productId: string;
  name: string;
  activeIngredient: string | null;
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
    const name = requiredText(input.name, "Category name", 160);
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into product_categories (tenant_id, name, is_controlled)
         values ($1, $2, $3)
         returning id`,
        [scope.tenantId, name, input.isControlled]
      );
      return rows[0] as CreatedRow;
    });
  }

  async createProduct(scope: TenantScope, input: CatalogProductInput): Promise<CreatedRow> {
    const name = requiredText(input.name, "Product name", 200);
    const activeIngredient = input.activeIngredient?.trim() || null;
    if (activeIngredient && activeIngredient.length > 240) {
      throw new Error("Active ingredient must be at most 240 characters.");
    }
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into products (tenant_id, category_id, name, active_ingredient)
         values ($1, $2, $3, $4)
         returning id`,
        [scope.tenantId, input.categoryId ?? null, name, activeIngredient]
      );
      return rows[0] as CreatedRow;
    });
  }

  async createPresentation(
    scope: TenantScope,
    input: CatalogPresentationInput
  ): Promise<CreatedRow> {
    const name = requiredText(input.name, "Presentation name", 160);
    const factor = validFactor(input.baseUnitFactor);
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into product_presentations
           (tenant_id, product_id, name, base_unit_factor, is_sellable)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [scope.tenantId, input.productId, name, factor, input.isSellable]
      );
      return rows[0] as CreatedRow;
    });
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

    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<ProductListRow>(
        `with filtered_products as (
           select
             product.id,
             product.name,
             product.active_ingredient as "activeIngredient",
             category.name as "categoryName"
           from products as product
           left join product_categories as category
             on category.tenant_id = product.tenant_id
            and category.id = product.category_id
           where product.tenant_id = $1
             and product.is_active
             and (
               $2 = ''
               or lower(product.name) like '%' || lower($2) || '%'
               or lower(coalesce(product.active_ingredient, '')) like '%' || lower($2) || '%'
             )
         )
         select
           filtered.id as "productId",
           filtered.name,
           filtered."activeIngredient",
           filtered."categoryName",
           count(*) over()::int as total,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'presentationId', presentation.id,
                 'name', presentation.name,
                 'baseUnitFactor', presentation.base_unit_factor::int,
                 'isSellable', presentation.is_sellable
               ) order by presentation.name
             ) filter (where presentation.id is not null),
             '[]'::jsonb
           ) as presentations
         from filtered_products as filtered
         left join product_presentations as presentation
           on presentation.tenant_id = $1
          and presentation.product_id = filtered.id
         group by filtered.id, filtered.name, filtered."activeIngredient", filtered."categoryName"
         order by filtered.name
         limit $3 offset $4`,
        [scope.tenantId, search, limit, offset]
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
         limit 1`,
        [scope.tenantId, normalizedBarcode, at, scope.branchId]
      );
      return rows[0] ?? null;
    });
  }
}
