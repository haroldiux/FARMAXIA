import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { TenantScope } from "../database/tenant-database.js";

export interface FefoRow {
  batchId: string;
  lotCode: string;
  expiresOn: string | Date;
  quantityBase: string;
  reservedBase: string;
}

/**
 * Locks the AVAILABLE, unexpired batches of a presentation in FEFO order (earliest expiry first)
 * and returns them with their balances. Rows stay locked until the transaction ends.
 */
export async function lockFefoRows(
  client: PoolClient,
  scope: TenantScope,
  warehouseId: string,
  presentationId: string
): Promise<FefoRow[]> {
  const result = await client.query<FefoRow>(
    `select b.id as "batchId", b.lot_code as "lotCode", b.expires_on as "expiresOn",
            ib.quantity_base::text as "quantityBase", ib.reserved_base::text as "reservedBase"
     from inventory_balances ib
     join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
     where ib.tenant_id = $1 and ib.warehouse_id = $2 and b.presentation_id = $3
       and b.status = 'AVAILABLE' and b.expires_on >= current_date
       and ib.quantity_base > ib.reserved_base
     order by b.expires_on asc, b.id asc
     for update of ib`,
    [scope.tenantId, warehouseId, presentationId]
  );
  return result.rows;
}

/** The batch FEFO would pick first right now (not locked; used to audit overrides). */
export async function fefoSuggestedBatchId(
  client: PoolClient,
  scope: TenantScope,
  warehouseId: string,
  presentationId: string
): Promise<string | null> {
  const result = await client.query<{ batchId: string }>(
    `select b.id as "batchId"
     from inventory_balances ib
     join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
     where ib.tenant_id = $1 and ib.warehouse_id = $2 and b.presentation_id = $3
       and b.status = 'AVAILABLE' and b.expires_on >= current_date
       and ib.quantity_base > ib.reserved_base
     order by b.expires_on asc, b.id asc
     limit 1`,
    [scope.tenantId, warehouseId, presentationId]
  );
  return result.rows[0]?.batchId ?? null;
}

function overrideConflict(code: string, message: string, batchId: string): ConflictException {
  return new ConflictException({ code, message, batchId });
}

/**
 * Locks the one batch chosen by an authorized user and validates it for the sale line: it must
 * exist in the warehouse, belong to the same product, be AVAILABLE and unexpired, and hold enough
 * unreserved stock to cover the whole line.
 */
export async function lockOverrideRow(
  client: PoolClient,
  scope: TenantScope,
  warehouseId: string,
  presentationId: string,
  batchId: string,
  quantityBase: number
): Promise<FefoRow> {
  const result = await client.query<FefoRow & { status: string; notExpired: boolean; sameProduct: boolean }>(
    `select b.id as "batchId", b.lot_code as "lotCode", b.expires_on as "expiresOn", b.status,
            (b.expires_on >= current_date) as "notExpired",
            (pp.product_id = (select product_id from product_presentations where tenant_id = $1 and id = $4)) as "sameProduct",
            ib.quantity_base::text as "quantityBase", ib.reserved_base::text as "reservedBase"
     from inventory_balances ib
     join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
     join product_presentations pp on pp.tenant_id = b.tenant_id and pp.id = b.presentation_id
     where ib.tenant_id = $1 and ib.warehouse_id = $2 and ib.batch_id = $3
     for update of ib`,
    [scope.tenantId, warehouseId, batchId, presentationId]
  );
  const row = result.rows[0];
  if (!row) {
    throw overrideConflict("FEFO_BATCH_NOT_FOUND", "The chosen batch has no stock in this warehouse.", batchId);
  }
  if (!row.sameProduct) {
    throw overrideConflict("FEFO_BATCH_MISMATCH", "The chosen batch belongs to a different product.", batchId);
  }
  if (row.status !== "AVAILABLE" || !row.notExpired) {
    throw overrideConflict("FEFO_BATCH_UNAVAILABLE", "The chosen batch is quarantined, disposed or expired.", batchId);
  }
  if (Number(row.quantityBase) - Number(row.reservedBase) < quantityBase) {
    throw overrideConflict("FEFO_BATCH_INSUFFICIENT", "The chosen batch does not have enough unreserved stock.", batchId);
  }
  return row;
}
