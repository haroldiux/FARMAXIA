import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { TenantScope } from "../database/tenant-database.js";
import { fromUnits, toUnits } from "./sales-money.js";

const ZONE = "America/La_Paz";

/** Agreement slice of a normalized payment. */
export interface AgreementPayment {
  method: string;
  amountBob: string;
  agreementId?: string;
}

/** What the sale exposes about the agreement that covered part of it (confirm response and sale detail). */
export interface SaleAgreement {
  id: string;
  name: string;
  /** Amount of the sale paid by the agreement (the charge). */
  coverageAmountBob: string;
}

/** Resolved before any stock is touched: the agreement and the member row (locked), when the sale has an AGREEMENT payment. */
export interface SaleAgreementContext {
  agreementId: string;
  name: string;
  memberId: string;
  customerId: string;
  coveragePercent: string;
  /** Effective monthly limit of the member: its own override or the agreement default. */
  limitBob: string;
  amountBob: string;
}

/**
 * SQL fragment: credit a member used in the current La Paz month = non-voided charges net of reductions.
 * `member` is the SQL alias of agreement_members; `zoneParam` the placeholder carrying the time zone.
 */
export function usedCreditSql(member: string, zoneParam: string): string {
  return `coalesce((select sum(ch.amount_bob - ch.reduced_amount_bob) from agreement_charges ch
    where ch.tenant_id = ${member}.tenant_id and ch.member_id = ${member}.id and ch.status <> 'VOIDED'
      and date_trunc('month', ch.created_at at time zone ${zoneParam}) = date_trunc('month', now() at time zone ${zoneParam})), 0)::numeric(18,4)`;
}

/**
 * Validates the AGREEMENT payment of a sale: the agreement exists and is active and the customer is an active member.
 * The member row is locked, so two concurrent sales of the same member serialize on the monthly credit.
 * Coverage and limit need the sale total and are checked by `chargeSaleAgreement`.
 */
export async function prepareSaleAgreement(
  client: PoolClient,
  scope: TenantScope,
  customerId: string | undefined,
  payments: readonly AgreementPayment[]
): Promise<SaleAgreementContext | null> {
  const payment = payments.find((candidate) => candidate.method === "AGREEMENT");
  if (!payment || customerId === undefined || payment.agreementId === undefined) return null;
  const agreement = await client.query<{ id: string; name: string; isActive: boolean; coveragePercent: string; limitBob: string }>(
    `select id, name, is_active as "isActive", coverage_percent::text as "coveragePercent", monthly_limit_bob::text as "limitBob"
     from agreements where tenant_id = $1 and id = $2`,
    [scope.tenantId, payment.agreementId]
  );
  const row = agreement.rows[0];
  if (!row) throw new NotFoundException({ code: "AGREEMENT_NOT_FOUND", message: "The agreement does not exist in this pharmacy." });
  if (!row.isActive) throw new BadRequestException({ code: "AGREEMENT_INACTIVE", message: "The agreement is inactive." });
  const member = await client.query<{ id: string; isActive: boolean; limitBob: string | null }>(
    `select id, is_active as "isActive", monthly_limit_bob::text as "limitBob"
     from agreement_members where tenant_id = $1 and agreement_id = $2 and customer_id = $3 for update`,
    [scope.tenantId, row.id, customerId]
  );
  const memberRow = member.rows[0];
  if (!memberRow || !memberRow.isActive) {
    throw new BadRequestException({ code: "NOT_AGREEMENT_MEMBER", message: "The customer is not an active member of the agreement." });
  }
  return {
    agreementId: row.id,
    name: row.name,
    memberId: memberRow.id,
    customerId,
    coveragePercent: row.coveragePercent,
    limitBob: memberRow.limitBob ?? row.limitBob,
    amountBob: payment.amountBob
  };
}

/**
 * Checks the coverage cap (round(total x coverage %, 2)) and the remaining monthly credit, then records the charge
 * in the sale transaction. The charge snapshots the sale number and the branch code because the statement is read
 * from any branch while sales and branches are branch-scoped.
 */
export async function chargeSaleAgreement(
  client: PoolClient,
  scope: TenantScope,
  context: SaleAgreementContext,
  sale: { id: string; number: string },
  totalBob: string
): Promise<SaleAgreement> {
  const cap = await client.query<{ cap: string }>(
    "select round($1::numeric * $2::numeric / 100, 2)::numeric(18,4)::text as cap",
    [totalBob, context.coveragePercent]
  );
  const maxCoverageBob = cap.rows[0]!.cap;
  const amount = toUnits(context.amountBob);
  if (amount > toUnits(maxCoverageBob)) {
    throw new BadRequestException({
      code: "AGREEMENT_COVERAGE_EXCEEDED",
      message: "The agreement amount exceeds its coverage of the sale total.",
      maxCoverageBob,
      coveragePercent: context.coveragePercent
    });
  }
  const used = await client.query<{ used: string }>(
    `select ${usedCreditSql("m", "$3")}::text as used from agreement_members m where m.tenant_id = $1 and m.id = $2`,
    [scope.tenantId, context.memberId, ZONE]
  );
  const remaining = toUnits(context.limitBob) - toUnits(used.rows[0]!.used);
  if (amount > remaining) {
    throw new BadRequestException({
      code: "AGREEMENT_LIMIT_EXCEEDED",
      message: "The agreement amount exceeds the remaining monthly credit of the member.",
      remainingBob: fromUnits(remaining < 0n ? 0n : remaining),
      limitBob: fromUnits(toUnits(context.limitBob))
    });
  }
  const branch = await client.query<{ code: string }>("select code from branches where tenant_id = $1 and id = $2", [scope.tenantId, scope.branchId]);
  await client.query(
    `insert into agreement_charges
       (tenant_id, branch_id, agreement_id, member_id, customer_id, sale_id, sale_number, branch_code, amount_bob)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric)`,
    [
      scope.tenantId,
      scope.branchId,
      context.agreementId,
      context.memberId,
      context.customerId,
      sale.id,
      sale.number,
      branch.rows[0]?.code ?? "SUC",
      context.amountBob
    ]
  );
  return { id: context.agreementId, name: context.name, coverageAmountBob: fromUnits(amount) };
}

interface ChargeRow {
  id: string;
  status: string;
  amountUnits: bigint;
  reducedUnits: bigint;
}

async function lockCharge(client: PoolClient, scope: TenantScope, saleId: string): Promise<ChargeRow | null> {
  const result = await client.query<{ id: string; status: string; amount: string; reduced: string }>(
    `select id, status, amount_bob::text as amount, reduced_amount_bob::text as reduced
     from agreement_charges where tenant_id = $1 and branch_id = $2 and sale_id = $3 for update`,
    [scope.tenantId, scope.branchId, saleId]
  );
  const row = result.rows[0];
  return row ? { id: row.id, status: row.status, amountUnits: toUnits(row.amount), reducedUnits: toUnits(row.reduced) } : null;
}

function billedConflict(): ConflictException {
  return new ConflictException({
    code: "AGREEMENT_CHARGE_BILLED",
    message: "The agreement charge of this sale is already on an issued statement: it can no longer be voided or reduced."
  });
}

/** Void: the OPEN charge becomes VOIDED. A charge already on a statement (BILLED) blocks the void (409). */
export async function voidAgreementCharge(client: PoolClient, scope: TenantScope, saleId: string): Promise<{ amountBob: string } | null> {
  const charge = await lockCharge(client, scope, saleId);
  if (!charge || charge.status === "VOIDED") return null;
  if (charge.status === "BILLED") throw billedConflict();
  await client.query("update agreement_charges set status = 'VOIDED', updated_at = now() where tenant_id = $1 and id = $2", [scope.tenantId, charge.id]);
  return { amountBob: fromUnits(charge.amountUnits - charge.reducedUnits) };
}

export interface ReturnAgreementPlan {
  chargeId: string | null;
  /** Share of the refund that belonged to the agreement (reduces the charge instead of being refunded). */
  reductionUnits: bigint;
  /** True when this return reduces the charge to zero. */
  closes: boolean;
}

export const NO_RETURN_AGREEMENT: ReturnAgreementPlan = { chargeId: null, reductionUnits: 0n, closes: false };

/**
 * D70: with `cumulativeUnits` = value returned so far including this return and `totalUnits` = sale total, the
 * agreement share reduced so far is floor(charge x cumulative / total); this return reduces the difference, so
 * rounding never drifts and the final return closes the charge exactly. A BILLED charge cannot be reduced (409).
 */
export async function planReturnAgreement(
  client: PoolClient,
  scope: TenantScope,
  saleId: string,
  cumulativeUnits: bigint,
  totalUnits: bigint
): Promise<ReturnAgreementPlan> {
  if (totalUnits <= 0n) return NO_RETURN_AGREEMENT;
  const charge = await lockCharge(client, scope, saleId);
  if (!charge || charge.status === "VOIDED") return NO_RETURN_AGREEMENT;
  const target = (charge.amountUnits * cumulativeUnits) / totalUnits;
  const reduction = target > charge.reducedUnits ? target - charge.reducedUnits : 0n;
  if (reduction > 0n && charge.status === "BILLED") throw billedConflict();
  return { chargeId: charge.id, reductionUnits: reduction, closes: charge.reducedUnits + reduction === charge.amountUnits };
}

export async function applyReturnAgreement(client: PoolClient, scope: TenantScope, plan: ReturnAgreementPlan): Promise<void> {
  if (!plan.chargeId || plan.reductionUnits <= 0n) return;
  await client.query(
    `update agreement_charges
     set reduced_amount_bob = reduced_amount_bob + $3::numeric,
         status = case when $4::boolean then 'VOIDED' else status end,
         updated_at = now()
     where tenant_id = $1 and id = $2`,
    [scope.tenantId, plan.chargeId, fromUnits(plan.reductionUnits), plan.closes]
  );
}

/** Agreement of a sale (id, name and the amount charged), for the sale detail. */
export async function loadSaleAgreement(client: PoolClient, tenantId: string, branchId: string, saleId: string): Promise<SaleAgreement | null> {
  const result = await client.query<{ id: string; name: string; amount: string }>(
    `select a.id, a.name, ch.amount_bob::numeric(18,4)::text as amount
     from agreement_charges ch join agreements a on a.tenant_id = ch.tenant_id and a.id = ch.agreement_id
     where ch.tenant_id = $1 and ch.branch_id = $2 and ch.sale_id = $3`,
    [tenantId, branchId, saleId]
  );
  const row = result.rows[0];
  return row ? { id: row.id, name: row.name, coverageAmountBob: row.amount } : null;
}
