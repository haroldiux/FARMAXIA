import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { branchAvailableStockLateral, currentPriceLateral } from "../sales/sales-lookup.js";

/*
 * Public read-only API v1 (F19, D78). Stable contract for external systems; additive changes only.
 * Every answer is limited to the API key's pharmacy and branch.
 *
 * GET /api/public/v1/products?search=&limit=20&offset=0   (limit 1-100, search <= 80 chars)
 *   -> { items: PublicProduct[], total, limit, offset }
 * GET /api/public/v1/products/:productId                    -> PublicProduct (404 PRODUCT_NOT_FOUND)
 * GET /api/public/v1/stock?presentationId=&limit=50&offset=0 (limit 1-200)
 *   -> { items: PublicStockItem[], total, limit, offset }
 *
 * PublicProduct = { productId, name, genericName, activeIngredient, concentration, pharmaceuticalForm,
 *                   laboratory, saleClassification, presentations: PublicPresentation[] }
 * PublicPresentation = { presentationId, name, baseUnitFactor, barcodes: string[],
 *                        priceBob: string | null (exact decimal, current branch price),
 *                        availableBase: number (base units), availableQuantity: number (whole presentations) }
 * PublicStockItem = { presentationId, productId, productName, presentationName, baseUnitFactor, availableBase, availableQuantity }
 *
 * Only active products and their active, sellable presentations are exposed. Stock = AVAILABLE, unexpired
 * lots minus reservations in the branch's active dispatch warehouses.
 */

export interface PublicPresentation {
  presentationId: string;
  name: string;
  baseUnitFactor: number;
  barcodes: string[];
  priceBob: string | null;
  availableBase: number;
  availableQuantity: number;
}

export interface PublicProduct {
  productId: string;
  name: string;
  genericName: string | null;
  activeIngredient: string | null;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  laboratory: string | null;
  saleClassification: string;
  presentations: PublicPresentation[];
}

export interface PublicStockItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  availableBase: number;
  availableQuantity: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_MAX_LENGTH = 80;

function invalidQuery(field: string, message: string): BadRequestException {
  return new BadRequestException({ code: "INVALID_QUERY", message, field });
}

function intParam(value: string | undefined, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw invalidQuery(field, `El parámetro ${field} debe ser un entero entre ${min} y ${max}.`);
  }
  return parsed;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const sellablePresentation = "pr.is_active and pr.is_sellable";

const productColumns = `p.id as "productId", p.name, p.generic_name as "genericName", p.active_ingredient as "activeIngredient",
  p.concentration, p.pharmaceutical_form as "pharmaceuticalForm", p.laboratory, p.sale_classification as "saleClassification"`;

@Injectable()
export class PublicApiService {
  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  listProducts(scope: TenantScope, query: { search?: string; limit?: string; offset?: string }): Promise<Page<PublicProduct>> {
    const search = typeof query.search === "string" ? query.search.trim() : "";
    if (search.length > SEARCH_MAX_LENGTH) {
      throw invalidQuery("search", `La búsqueda admite hasta ${SEARCH_MAX_LENGTH} caracteres.`);
    }
    const limit = intParam(query.limit, "limit", 20, 1, 100);
    const offset = intParam(query.offset, "offset", 0, 0, 1_000_000);

    return this.database.withScope(scope, async (client) => {
      const filter = `p.tenant_id = $1 and p.is_active
        and exists (select 1 from product_presentations pr where pr.tenant_id = p.tenant_id and pr.product_id = p.id and ${sellablePresentation})
        and ($2::text = '' or p.name ilike $3 or p.generic_name ilike $3 or p.active_ingredient ilike $3 or p.laboratory ilike $3
             or exists (select 1 from product_barcodes bc
                        join product_presentations pr on pr.tenant_id = bc.tenant_id and pr.id = bc.presentation_id
                        where bc.tenant_id = p.tenant_id and pr.product_id = p.id and ${sellablePresentation} and bc.barcode = $2))`;
      const params = [scope.tenantId, search, `%${escapeLike(search)}%`];
      const total = await client.query<{ total: number }>(`select count(*)::int as total from products p where ${filter}`, params);
      const products = await client.query<Omit<PublicProduct, "presentations">>(
        `select ${productColumns} from products p where ${filter}
         order by p.name asc, p.id asc limit $4 offset $5`,
        [...params, limit, offset]
      );
      const items = await this.withPresentations(client, scope, products.rows);
      return { items, total: total.rows[0]?.total ?? 0, limit, offset };
    });
  }

  getProduct(scope: TenantScope, productId: string): Promise<PublicProduct> {
    if (!uuidPattern.test(productId)) {
      throw invalidQuery("productId", "El producto no es válido.");
    }
    return this.database.withScope(scope, async (client) => {
      const product = await client.query<Omit<PublicProduct, "presentations">>(
        `select ${productColumns} from products p where p.tenant_id = $1 and p.id = $2 and p.is_active`,
        [scope.tenantId, productId]
      );
      if (!product.rows[0]) {
        throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      }
      const [item] = await this.withPresentations(client, scope, product.rows);
      return item!;
    });
  }

  listStock(scope: TenantScope, query: { presentationId?: string; limit?: string; offset?: string }): Promise<Page<PublicStockItem>> {
    const presentationId = typeof query.presentationId === "string" && query.presentationId !== "" ? query.presentationId : null;
    if (presentationId !== null && !uuidPattern.test(presentationId)) {
      throw invalidQuery("presentationId", "La presentación no es válida.");
    }
    const limit = intParam(query.limit, "limit", 50, 1, 200);
    const offset = intParam(query.offset, "offset", 0, 0, 1_000_000);

    return this.database.withScope(scope, async (client) => {
      const filter = `pr.tenant_id = $1 and ${sellablePresentation} and p.is_active and ($2::uuid is null or pr.id = $2::uuid)`;
      const from = `from product_presentations pr join products p on p.tenant_id = pr.tenant_id and p.id = pr.product_id`;
      const total = await client.query<{ total: number }>(`select count(*)::int as total ${from} where ${filter}`, [scope.tenantId, presentationId]);
      const rows = await client.query<Omit<PublicStockItem, "availableBase" | "availableQuantity"> & { availableBase: string }>(
        `select pr.id as "presentationId", p.id as "productId", p.name as "productName", pr.name as "presentationName",
                pr.base_unit_factor::int as "baseUnitFactor", coalesce(branch_stock.available, 0)::text as "availableBase"
         ${from}
         ${branchAvailableStockLateral("pr.id", "pr.tenant_id", "$3")}
         where ${filter}
         order by p.name asc, pr.name asc, pr.id asc
         limit $4 offset $5`,
        [scope.tenantId, presentationId, scope.branchId, limit, offset]
      );
      return {
        items: rows.rows.map((row) => {
          const availableBase = Number(row.availableBase);
          return { ...row, availableBase, availableQuantity: Math.floor(availableBase / row.baseUnitFactor) };
        }),
        total: total.rows[0]?.total ?? 0,
        limit,
        offset
      };
    });
  }

  private async withPresentations(
    client: PoolClient,
    scope: TenantScope,
    products: Array<Omit<PublicProduct, "presentations">>
  ): Promise<PublicProduct[]> {
    if (products.length === 0) {
      return [];
    }
    const result = await client.query<Omit<PublicPresentation, "availableBase" | "availableQuantity"> & { productId: string; availableBase: string }>(
      `select pr.id as "presentationId", pr.product_id as "productId", pr.name, pr.base_unit_factor::int as "baseUnitFactor",
              coalesce((select array_agg(bc.barcode::text order by bc.barcode) from product_barcodes bc
                        where bc.tenant_id = pr.tenant_id and bc.presentation_id = pr.id), '{}'::text[]) as barcodes,
              selected_price.amount::text as "priceBob",
              coalesce(branch_stock.available, 0)::text as "availableBase"
       from product_presentations pr
       ${currentPriceLateral("pr.id", "pr.tenant_id", "$2")}
       ${branchAvailableStockLateral("pr.id", "pr.tenant_id", "$2")}
       where pr.tenant_id = $1 and pr.product_id = any($3::uuid[]) and ${sellablePresentation}
       order by pr.name asc, pr.id asc`,
      [scope.tenantId, scope.branchId, products.map((product) => product.productId)]
    );
    const byProduct = new Map<string, PublicPresentation[]>();
    for (const row of result.rows) {
      const availableBase = Number(row.availableBase);
      const presentation: PublicPresentation = {
        presentationId: row.presentationId,
        name: row.name,
        baseUnitFactor: row.baseUnitFactor,
        barcodes: row.barcodes,
        priceBob: row.priceBob,
        availableBase,
        availableQuantity: Math.floor(availableBase / row.baseUnitFactor)
      };
      byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), presentation]);
    }
    return products.map((product) => ({ ...product, presentations: byProduct.get(product.productId) ?? [] }));
  }
}
