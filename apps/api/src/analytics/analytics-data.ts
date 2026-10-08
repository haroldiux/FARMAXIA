import { ForbiddenException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";
import { ZONE } from "../staff/staff.common.js";

/**
 * Shared data access for the analytics reports (F18). Everything here is read-only and runs inside ONE branch
 * scope at a time (sales, returns, warehouses and costs are branch-isolated by RLS); the cross-branch reports
 * call it once per accessible branch through `forEachBranch` and merge the rows.
 */

export interface AnalyticsBranch {
  id: string;
  code: string;
  name: string;
}

/** Net sales of one presentation in one branch over a period (voided sales excluded, returns netted). */
export interface NetSalesRow {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  laboratory: string | null;
  baseUnitFactor: number;
  /** Units sold in the presentation's own unit, net of returns. */
  units: number;
  /** Units in base units, net of returns. */
  base: number;
  revenue: number;
  /** Cost of the lines that carry a cost snapshot (net base × snapshot) and the revenue of those lines. */
  snapshotCost: number;
  snapshotRevenue: number;
  /** Base quantity and revenue of the lines WITHOUT a snapshot (historical sales or no cost at confirm). */
  unsnapshotBase: number;
  unsnapshotRevenue: number;
  /** Current average cost per base unit (pharmacy level), null when never received. */
  averageCost: number | null;
}

/** Stock a branch can dispatch today: dispatch warehouses, AVAILABLE and not expired batches, physical - reserved. */
export interface AvailableStockRow {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  laboratory: string | null;
  baseUnitFactor: number;
  availableBase: number;
  averageCost: number | null;
}

/** Calendar days of the inclusive period. */
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** La Paz calendar day, shifted by `offsetDays`. */
export function laPazDay(offsetDays = 0): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: ZONE });
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * Branches of the pharmacy the user belongs to (optionally narrowed to `requested`). Holders of analytics.read
 * may list their own memberships in every branch (migration 0033); asking for a branch they do not belong to is 403.
 */
export async function accessibleBranchIds(database: TenantDatabase, scope: TenantScope, requested?: string | null): Promise<string[]> {
  const ids = await database.withScope(scope, async (client) => {
    const result = await client.query<{ branchId: string }>(
      `select membership.branch_id as "branchId"
       from user_branch_memberships membership
       where membership.tenant_id = $1 and membership.user_id = $2
       order by membership.branch_id`,
      [scope.tenantId, scope.userId]
    );
    return result.rows.map((row) => row.branchId);
  });
  if (requested) {
    if (!ids.includes(requested)) {
      throw new ForbiddenException({ code: "BRANCH_NOT_ACCESSIBLE", message: "No tienes acceso a esa sucursal." });
    }
    return [requested];
  }
  return ids;
}

/** Runs `operation` once per accessible active branch, each inside that branch's own RLS scope. */
export async function forEachBranch<T>(
  database: TenantDatabase,
  scope: TenantScope,
  requested: string | null | undefined,
  operation: (client: PoolClient, branch: AnalyticsBranch) => Promise<T>
): Promise<T[]> {
  const results: T[] = [];
  for (const branchId of await accessibleBranchIds(database, scope, requested)) {
    const result = await database.withScope({ ...scope, branchId }, async (client) => {
      const branch = await client.query<AnalyticsBranch & { isActive: boolean }>(
        `select id, code, name, is_active as "isActive" from branches where tenant_id = $1 and id = $2`,
        [scope.tenantId, branchId]
      );
      const row = branch.rows[0];
      if (!row?.isActive) return undefined;
      return operation(client, { id: row.id, code: row.code, name: row.name });
    });
    if (result !== undefined) results.push(result);
  }
  return results;
}

/**
 * Net sales per presentation for one branch and a La Paz calendar period (inclusive): CONFIRMED and
 * PARTIALLY_RETURNED/RETURNED sales count, VOIDED ones never do, and every line is reduced by what was returned
 * through `sale_return_items`.
 */
export async function netSalesByPresentation(client: PoolClient, tenantId: string, branchId: string, from: string, to: string): Promise<NetSalesRow[]> {
  const result = await client.query<{
    presentationId: string;
    productId: string;
    productName: string;
    presentationName: string;
    laboratory: string | null;
    baseUnitFactor: string;
    units: string;
    base: string;
    revenue: string;
    snapshotCost: string;
    snapshotRevenue: string;
    unsnapshotBase: string;
    unsnapshotRevenue: string;
    averageCost: string | null;
  }>(
    `with returned as (
       select sale_item_id, sum(quantity) as quantity, sum(quantity_base) as quantity_base, sum(line_total_bob) as amount
       from sale_return_items
       where tenant_id = $1 and branch_id = $2
       group by sale_item_id
     ), lines as (
       select item.presentation_id,
              item.quantity - coalesce(returned.quantity, 0) as units,
              item.quantity_base - coalesce(returned.quantity_base, 0) as base,
              item.line_total_bob - coalesce(returned.amount, 0) as revenue,
              item.unit_cost_base_bob as snapshot
       from sale_items item
       join sales sale on sale.tenant_id = item.tenant_id and sale.branch_id = item.branch_id and sale.id = item.sale_id
       left join returned on returned.sale_item_id = item.id
       where item.tenant_id = $1 and item.branch_id = $2 and sale.status <> 'VOIDED'
         and sale.created_at >= $3::date::timestamp at time zone '${ZONE}'
         and sale.created_at < ($4::date + 1)::timestamp at time zone '${ZONE}'
     )
     select presentation.id as "presentationId", product.id as "productId", product.name as "productName",
            presentation.name as "presentationName", product.laboratory,
            presentation.base_unit_factor::text as "baseUnitFactor",
            sum(lines.units)::text as units, sum(lines.base)::text as base, sum(lines.revenue)::text as revenue,
            coalesce(sum(lines.base * lines.snapshot) filter (where lines.snapshot is not null), 0)::text as "snapshotCost",
            coalesce(sum(lines.revenue) filter (where lines.snapshot is not null), 0)::text as "snapshotRevenue",
            coalesce(sum(lines.base) filter (where lines.snapshot is null), 0)::text as "unsnapshotBase",
            coalesce(sum(lines.revenue) filter (where lines.snapshot is null), 0)::text as "unsnapshotRevenue",
            cost.average_unit_cost::text as "averageCost"
     from lines
     join product_presentations presentation on presentation.tenant_id = $1 and presentation.id = lines.presentation_id
     join products product on product.tenant_id = presentation.tenant_id and product.id = presentation.product_id
     left join presentation_costs cost on cost.tenant_id = presentation.tenant_id and cost.presentation_id = presentation.id
     group by presentation.id, product.id, product.name, presentation.name, product.laboratory, presentation.base_unit_factor, cost.average_unit_cost`,
    [tenantId, branchId, from, to]
  );
  return result.rows.map((row) => ({
    presentationId: row.presentationId,
    productId: row.productId,
    productName: row.productName,
    presentationName: row.presentationName,
    laboratory: row.laboratory,
    baseUnitFactor: Number(row.baseUnitFactor),
    units: Number(row.units),
    base: Number(row.base),
    revenue: Number(row.revenue),
    snapshotCost: Number(row.snapshotCost),
    snapshotRevenue: Number(row.snapshotRevenue),
    unsnapshotBase: Number(row.unsnapshotBase),
    unsnapshotRevenue: Number(row.unsnapshotRevenue),
    averageCost: row.averageCost === null ? null : Number(row.averageCost)
  }));
}

/** Available stock per presentation for one branch (same rules as the reorder suggestions and FEFO sales). */
export async function availableStockByPresentation(client: PoolClient, tenantId: string, branchId: string): Promise<AvailableStockRow[]> {
  const result = await client.query<{
    presentationId: string;
    productId: string;
    productName: string;
    presentationName: string;
    laboratory: string | null;
    baseUnitFactor: string;
    availableBase: string;
    averageCost: string | null;
  }>(
    `select presentation.id as "presentationId", product.id as "productId", product.name as "productName",
            presentation.name as "presentationName", product.laboratory,
            presentation.base_unit_factor::text as "baseUnitFactor",
            greatest(sum(balance.quantity_base - balance.reserved_base), 0)::text as "availableBase",
            cost.average_unit_cost::text as "averageCost"
     from inventory_balances balance
     join inventory_batches batch on batch.tenant_id = balance.tenant_id and batch.id = balance.batch_id
     join warehouses warehouse on warehouse.tenant_id = balance.tenant_id and warehouse.id = balance.warehouse_id
     join product_presentations presentation on presentation.tenant_id = batch.tenant_id and presentation.id = batch.presentation_id
     join products product on product.tenant_id = presentation.tenant_id and product.id = presentation.product_id
     left join presentation_costs cost on cost.tenant_id = presentation.tenant_id and cost.presentation_id = presentation.id
     where balance.tenant_id = $1 and warehouse.branch_id = $2
       and warehouse.is_dispatch_enabled and warehouse.is_active
       and batch.status = 'AVAILABLE' and batch.expires_on >= current_date
     group by presentation.id, product.id, product.name, presentation.name, product.laboratory, presentation.base_unit_factor, cost.average_unit_cost`,
    [tenantId, branchId]
  );
  return result.rows.map((row) => ({
    presentationId: row.presentationId,
    productId: row.productId,
    productName: row.productName,
    presentationName: row.presentationName,
    laboratory: row.laboratory,
    baseUnitFactor: Number(row.baseUnitFactor),
    availableBase: Number(row.availableBase),
    averageCost: row.averageCost === null ? null : Number(row.averageCost)
  }));
}

/** Tickets of a branch and La Paz period: sales that still stand (CONFIRMED and PARTIALLY_RETURNED; voided and fully returned ones do not count). */
export async function countTickets(client: PoolClient, tenantId: string, branchId: string, from: string, to: string): Promise<number> {
  const result = await client.query<{ tickets: string }>(
    `select count(*)::text as tickets
     from sales
     where tenant_id = $1 and branch_id = $2 and status in ('CONFIRMED', 'PARTIALLY_RETURNED')
       and created_at >= $3::date::timestamp at time zone '${ZONE}'
       and created_at < ($4::date + 1)::timestamp at time zone '${ZONE}'`,
    [tenantId, branchId, from, to]
  );
  return Number(result.rows[0]?.tickets ?? 0);
}

export interface NearExpiryStock {
  /** Physical base units of AVAILABLE batches expiring within the horizon (already expired batches are excluded). */
  units: number;
  /** Value at the current average cost per base unit. */
  value: number;
  /** Units whose presentation has no recorded average cost (not valued). */
  uncostedUnits: number;
}

export async function nearExpiryStock(client: PoolClient, tenantId: string, branchId: string, days: number): Promise<NearExpiryStock> {
  const result = await client.query<{ units: string; value: string; uncostedUnits: string }>(
    `select coalesce(sum(balance.quantity_base), 0)::text as units,
            coalesce(sum(balance.quantity_base * cost.average_unit_cost), 0)::text as value,
            coalesce(sum(balance.quantity_base) filter (where cost.average_unit_cost is null), 0)::text as "uncostedUnits"
     from inventory_balances balance
     join inventory_batches batch on batch.tenant_id = balance.tenant_id and batch.id = balance.batch_id
     join warehouses warehouse on warehouse.tenant_id = balance.tenant_id and warehouse.id = balance.warehouse_id
     left join presentation_costs cost on cost.tenant_id = batch.tenant_id and cost.presentation_id = batch.presentation_id
     where balance.tenant_id = $1 and warehouse.branch_id = $2 and warehouse.is_active
       and balance.quantity_base > 0
       and batch.status = 'AVAILABLE'
       and batch.expires_on >= current_date and batch.expires_on <= current_date + $3::int`,
    [tenantId, branchId, days]
  );
  const row = result.rows[0];
  return { units: Number(row?.units ?? 0), value: Number(row?.value ?? 0), uncostedUnits: Number(row?.uncostedUnits ?? 0) };
}

export interface WeeklyNetRow {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  /** Monday (La Paz) of the week, YYYY-MM-DD. */
  weekStart: string;
  /** Net base units (voided excluded, returns netted). */
  base: number;
  revenue: number;
}

/** Net base units and revenue per presentation and La Paz week (Monday start) for one branch. */
export async function weeklyNetSales(client: PoolClient, tenantId: string, branchId: string, from: string, to: string): Promise<WeeklyNetRow[]> {
  const result = await client.query<{
    presentationId: string;
    productId: string;
    productName: string;
    presentationName: string;
    baseUnitFactor: string;
    weekStart: string;
    base: string;
    revenue: string;
  }>(
    `with returned as (
       select sale_item_id, sum(quantity_base) as quantity_base, sum(line_total_bob) as amount
       from sale_return_items
       where tenant_id = $1 and branch_id = $2
       group by sale_item_id
     )
     select presentation.id as "presentationId", product.id as "productId", product.name as "productName",
            presentation.name as "presentationName", presentation.base_unit_factor::text as "baseUnitFactor",
            to_char(date_trunc('week', sale.created_at at time zone '${ZONE}'), 'YYYY-MM-DD') as "weekStart",
            sum(item.quantity_base - coalesce(returned.quantity_base, 0))::text as base,
            sum(item.line_total_bob - coalesce(returned.amount, 0))::text as revenue
     from sale_items item
     join sales sale on sale.tenant_id = item.tenant_id and sale.branch_id = item.branch_id and sale.id = item.sale_id
     left join returned on returned.sale_item_id = item.id
     join product_presentations presentation on presentation.tenant_id = item.tenant_id and presentation.id = item.presentation_id
     join products product on product.tenant_id = presentation.tenant_id and product.id = presentation.product_id
     where item.tenant_id = $1 and item.branch_id = $2 and sale.status <> 'VOIDED'
       and sale.created_at >= $3::date::timestamp at time zone '${ZONE}'
       and sale.created_at < ($4::date + 1)::timestamp at time zone '${ZONE}'
     group by presentation.id, product.id, product.name, presentation.name, presentation.base_unit_factor, "weekStart"`,
    [tenantId, branchId, from, to]
  );
  return result.rows.map((row) => ({
    presentationId: row.presentationId,
    productId: row.productId,
    productName: row.productName,
    presentationName: row.presentationName,
    baseUnitFactor: Number(row.baseUnitFactor),
    weekStart: row.weekStart,
    base: Number(row.base),
    revenue: Number(row.revenue)
  }));
}
