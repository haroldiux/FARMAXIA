import type { PoolClient } from "pg";
import type { TenantScope } from "../database/tenant-database.js";

export interface LoyaltySettings {
  enabled: boolean;
  /** BOB paid (cash, card or QR) to earn one point. */
  bobPerPoint: string;
  /** BOB value of one point when redeeming. */
  pointValueBob: string;
}

export type LoyaltyKind = "EARN" | "REDEEM" | "REVERSAL" | "ADJUST";

/** Defaults of a pharmacy that never configured loyalty (D67): 1 point per 10 BOB, 1 point = 0.10 BOB. */
export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = { enabled: true, bobPerPoint: "10.0000", pointValueBob: "0.1000" };

export interface CustomerRef {
  id: string;
  fullName: string;
  docType: string | null;
  docNumber: string | null;
}

export async function loadLoyaltySettings(client: PoolClient, tenantId: string): Promise<LoyaltySettings> {
  const result = await client.query<LoyaltySettings>(
    `select enabled, bob_per_point::text as "bobPerPoint", point_value_bob::text as "pointValueBob"
     from loyalty_settings where tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0] ?? { ...DEFAULT_LOYALTY_SETTINGS };
}

/** Row-locks the customer so concurrent sales/returns of the same customer serialize on the balance. */
export async function lockCustomer(
  client: PoolClient,
  tenantId: string,
  customerId: string
): Promise<(CustomerRef & { isActive: boolean }) | undefined> {
  const result = await client.query<CustomerRef & { isActive: boolean }>(
    `select id, full_name as "fullName", doc_type as "docType", doc_number as "docNumber", is_active as "isActive"
     from customers where tenant_id = $1 and id = $2 for update`,
    [tenantId, customerId]
  );
  return result.rows[0];
}

/** Balance = sum of the ledger, across every branch of the pharmacy. */
export async function customerBalance(client: PoolClient, tenantId: string, customerId: string): Promise<number> {
  const result = await client.query<{ balance: string }>(
    "select coalesce(sum(points), 0)::text as balance from loyalty_movements where tenant_id = $1 and customer_id = $2",
    [tenantId, customerId]
  );
  return Number(result.rows[0]?.balance ?? 0);
}

export interface NewMovement {
  customerId: string;
  kind: LoyaltyKind;
  points: number;
  reason: string;
  saleId?: string;
  saleReturnId?: string;
}

/** Appends to the immutable ledger (clock_timestamp keeps the order of several rows of one transaction). */
export async function insertMovement(client: PoolClient, scope: TenantScope, movement: NewMovement): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into loyalty_movements
       (tenant_id, branch_id, customer_id, sale_id, sale_return_id, kind, points, reason, created_by_user_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
     returning id`,
    [
      scope.tenantId,
      scope.branchId,
      movement.customerId,
      movement.saleId ?? null,
      movement.saleReturnId ?? null,
      movement.kind,
      movement.points,
      movement.reason.slice(0, 300),
      scope.userId
    ]
  );
  return result.rows[0]!.id;
}

export interface SaleLedgerTotals {
  earned: number;
  redeemed: number;
  /** Redeemed points already given back by REVERSAL rows. */
  givenBack: number;
  /** Earned points already taken back by REVERSAL rows. */
  takenBack: number;
}

export async function saleLedgerTotals(client: PoolClient, tenantId: string, saleId: string): Promise<SaleLedgerTotals> {
  const result = await client.query<{ earned: string; redeemed: string; givenBack: string; takenBack: string }>(
    `select coalesce(sum(points) filter (where kind = 'EARN'), 0)::text as earned,
            coalesce(-sum(points) filter (where kind = 'REDEEM'), 0)::text as redeemed,
            coalesce(sum(points) filter (where kind = 'REVERSAL' and points > 0), 0)::text as "givenBack",
            coalesce(-sum(points) filter (where kind = 'REVERSAL' and points < 0), 0)::text as "takenBack"
     from loyalty_movements where tenant_id = $1 and sale_id = $2`,
    [tenantId, saleId]
  );
  const row = result.rows[0]!;
  return { earned: Number(row.earned), redeemed: Number(row.redeemed), givenBack: Number(row.givenBack), takenBack: Number(row.takenBack) };
}
