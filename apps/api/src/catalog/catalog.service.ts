import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";

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
}

export interface CatalogPriceInput {
  priceListId: string;
  presentationId: string;
  amount: string;
  validFrom: Date;
  validTo?: Date;
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

interface CreatedRow {
  id: string;
}

interface HomologationRow extends CreatedRow {
  authority: string;
  externalCode: string;
}

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return normalized;
}

function amountText(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) {
    throw new Error("Price amount must be a non-negative decimal with up to four places.");
  }
  return normalized;
}

function validCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("Currency must be a three-letter ISO code.");
  }
  return normalized;
}

function validFactor(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Base unit factor must be a positive safe integer.");
  }
  return value;
}

export class CatalogService {
  constructor(private readonly database: TenantDatabase) {}

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
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into product_barcodes (tenant_id, presentation_id, barcode)
         values ($1, $2, $3)
         returning id`,
        [scope.tenantId, input.presentationId, barcode]
      );
      return rows[0] as CreatedRow;
    });
  }

  async createPriceList(scope: TenantScope, input: CatalogPriceListInput): Promise<CreatedRow> {
    const name = requiredText(input.name, "Price list name", 120);
    const currency = validCurrency(input.currency);
    if (input.branchId && input.branchId !== scope.branchId) {
      throw new Error("Price list branch must match the active branch scope.");
    }
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into price_lists (tenant_id, branch_id, name, currency)
         values ($1, $2, $3, $4)
         returning id`,
        [scope.tenantId, input.branchId ?? null, name, currency]
      );
      return rows[0] as CreatedRow;
    });
  }

  async setPrice(scope: TenantScope, input: CatalogPriceInput): Promise<CreatedRow> {
    const amount = amountText(input.amount);
    if (!(input.validFrom instanceof Date) || Number.isNaN(input.validFrom.getTime())) {
      throw new Error("Price validFrom must be a valid date.");
    }
    if (input.validTo && input.validTo <= input.validFrom) {
      throw new Error("Price validTo must be later than validFrom.");
    }
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into presentation_prices
           (tenant_id, price_list_id, presentation_id, amount, valid_from, valid_to)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [scope.tenantId, input.priceListId, input.presentationId, amount, input.validFrom, input.validTo ?? null]
      );
      return rows[0] as CreatedRow;
    });
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
