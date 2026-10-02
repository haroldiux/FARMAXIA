import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface SalesLookupQuery {
  q?: string;
  warehouseId?: string;
  limit?: number;
}

export interface SalesLookupItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  genericName: string | null;
  activeIngredient: string | null;
  laboratory: string | null;
  baseUnitFactor: number;
  /** Current price of the branch (or the general list), exact decimal text; null when none is set. */
  priceBob: string | null;
  /** Sellable base units: AVAILABLE, unexpired batches minus reservations, in the chosen warehouse. */
  availableBase: number;
  /** Whole presentation units that can be sold now (availableBase / baseUnitFactor, rounded down). */
  availableQuantity: number;
  /** The barcode that matched exactly, otherwise null. */
  barcode: string | null;
}

export interface SalesBatchesQuery {
  presentationId?: string;
  warehouseId?: string;
}

/** A sellable lot of a presentation, as offered to users who may choose a lot different from FEFO. */
export interface SalesBatchOption {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  /** Unreserved base units in the warehouse. */
  availableBase: number;
  /** True for the lot FEFO would consume first. */
  fefoSuggested: boolean;
}

interface LookupRow extends Omit<SalesLookupItem, "baseUnitFactor" | "availableBase" | "availableQuantity"> {
  baseUnitFactor: number;
  availableBase: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}


/**
 * Shared price resolution: the active price list of the branch wins over the general one, and the
 * price must be valid right now. Used by the POS lookup and by sale confirmation so both agree.
 * Exposes `selected_price.amount`; `branchParam` is a SQL parameter holding the branch id.
 */
export function currentPriceLateral(presentationRef: string, tenantRef: string, branchParam: string): string {
  return `left join lateral (
           select price.amount
           from presentation_prices price
           join price_lists pl on pl.tenant_id = price.tenant_id and pl.id = price.price_list_id
           where price.tenant_id = ${tenantRef} and price.presentation_id = ${presentationRef}
             and price.valid_from <= now() and (price.valid_to is null or price.valid_to > now())
             and pl.is_active and pl.currency = 'BOB'
             and (pl.branch_id is null or pl.branch_id = ${branchParam})
           order by case when pl.branch_id = ${branchParam} then 0 else 1 end, price.valid_from desc
           limit 1
         ) selected_price on true`;
}

/** Current BOB price of a presentation for the branch, as exact decimal text, or null when none applies. */
export async function resolveCurrentPrice(
  client: PoolClient,
  scope: TenantScope,
  presentationId: string
): Promise<string | null> {
  const result = await client.query<{ priceBob: string | null }>(
    `select selected_price.amount::text as "priceBob"
     from product_presentations pr
     ${currentPriceLateral("pr.id", "pr.tenant_id", "$3")}
     where pr.tenant_id = $1 and pr.id = $2`,
    [scope.tenantId, presentationId, scope.branchId]
  );
  return result.rows[0]?.priceBob ?? null;
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

/** Compact read model for the POS counter: sellable presentations with price and stock. */
export class SalesLookupReader {
  constructor(private readonly database: TenantDatabase) {}

  /** AVAILABLE, unexpired lots with unreserved stock in the warehouse, in FEFO order (first = suggested). */
  async listBatches(scope: TenantScope, query: SalesBatchesQuery): Promise<{ items: SalesBatchOption[] }> {
    if (typeof query.presentationId !== "string" || !uuidPattern.test(query.presentationId)) {
      throw new BadRequestException("Selecciona una presentación válida.");
    }
    if (typeof query.warehouseId !== "string" || !uuidPattern.test(query.warehouseId)) {
      throw new BadRequestException("Selecciona un almacén de despacho válido.");
    }
    const { presentationId, warehouseId } = query;
    return this.database.withScope(scope, async (client) => {
      const warehouse = await client.query(
        `select 1 from warehouses where tenant_id = $1 and branch_id = $2 and id = $3 and is_active`,
        [scope.tenantId, scope.branchId, warehouseId]
      );
      if (!warehouse.rowCount) {
        throw new NotFoundException("Almacén no encontrado en la sucursal.");
      }
      const result = await client.query<{
        batchId: string;
        lotCode: string;
        expiresOn: string | Date;
        availableBase: string;
      }>(
        `select b.id as "batchId", b.lot_code as "lotCode", b.expires_on as "expiresOn",
                (ib.quantity_base - ib.reserved_base)::text as "availableBase"
         from inventory_balances ib
         join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
         where ib.tenant_id = $1 and ib.warehouse_id = $2 and b.presentation_id = $3
           and b.status = 'AVAILABLE' and b.expires_on >= current_date
           and ib.quantity_base > ib.reserved_base
         order by b.expires_on asc, b.id asc`,
        [scope.tenantId, warehouseId, presentationId]
      );
      return {
        items: result.rows.map((row, index) => ({
          batchId: row.batchId,
          lotCode: row.lotCode,
          expiresOn: dateOnly(row.expiresOn),
          availableBase: Number(row.availableBase),
          fefoSuggested: index === 0
        }))
      };
    });
  }

  async lookup(scope: TenantScope, query: SalesLookupQuery): Promise<{ items: SalesLookupItem[] }> {
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (q.length < 1 || q.length > 80) {
      throw new BadRequestException("La búsqueda debe tener entre 1 y 80 caracteres.");
    }
    if (typeof query.warehouseId !== "string" || !uuidPattern.test(query.warehouseId)) {
      throw new BadRequestException("Selecciona un almacén de despacho válido.");
    }
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`El límite debe estar entre 1 y ${MAX_LIMIT}.`);
    }
    const warehouseId = query.warehouseId;

    return this.database.withScope(scope, async (client) => {
      const warehouse = await client.query(
        `select 1 from warehouses where tenant_id = $1 and branch_id = $2 and id = $3 and is_active`,
        [scope.tenantId, scope.branchId, warehouseId]
      );
      if (!warehouse.rowCount) {
        throw new NotFoundException("Almacén no encontrado en la sucursal.");
      }
      const result = await client.query<LookupRow>(
        `select pr.id as "presentationId", p.id as "productId", p.name as "productName",
                pr.name as "presentationName", p.generic_name as "genericName",
                p.active_ingredient as "activeIngredient", p.laboratory,
                pr.base_unit_factor::int as "baseUnitFactor",
                selected_price.amount::text as "priceBob",
                coalesce(stock.available, 0)::text as "availableBase",
                bc.barcode
         from product_presentations pr
         join products p on p.tenant_id = pr.tenant_id and p.id = pr.product_id
         left join product_barcodes bc
           on bc.tenant_id = pr.tenant_id and bc.presentation_id = pr.id and bc.barcode = $2
         ${currentPriceLateral("pr.id", "pr.tenant_id", "$4")}
         left join lateral (
           select sum(ib.quantity_base - ib.reserved_base) as available
           from inventory_balances ib
           join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
           where ib.tenant_id = pr.tenant_id and ib.warehouse_id = $5 and b.presentation_id = pr.id
             and b.status = 'AVAILABLE' and b.expires_on >= current_date
             and ib.quantity_base > ib.reserved_base
         ) stock on true
         where pr.tenant_id = $1 and p.is_active and pr.is_active and pr.is_sellable
           and (bc.barcode is not null
                or p.name ilike $3 or p.generic_name ilike $3 or p.active_ingredient ilike $3
                or p.laboratory ilike $3 or pr.name ilike $3)
         order by (bc.barcode is not null) desc, p.name asc, pr.name asc, pr.id asc
         limit $6`,
        [scope.tenantId, q, `%${escapeLike(q)}%`, scope.branchId, warehouseId, limit]
      );
      return {
        items: result.rows.map((row) => {
          const availableBase = Number(row.availableBase);
          return {
            ...row,
            barcode: row.barcode ?? null,
            availableBase,
            availableQuantity: Math.floor(availableBase / row.baseUnitFactor)
          };
        })
      };
    });
  }
}
