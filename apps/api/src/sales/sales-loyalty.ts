import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  customerBalance,
  insertMovement,
  loadLoyaltySettings,
  lockCustomer,
  saleLedgerTotals,
  type CustomerRef,
  type LoyaltySettings
} from "../customers/loyalty-ledger.js";
import type { TenantScope } from "../database/tenant-database.js";
import { earnsLoyalty } from "./payment-methods.js";
import { toUnits } from "./sales-money.js";

/** Loyalty-relevant slice of a normalized payment. */
export interface LoyaltyPayment {
  method: string;
  amountBob: string;
}

export interface SaleLoyalty {
  earned: number;
  redeemed: number;
  balance: number;
}

/** Resolved before any stock is touched: the customer (locked) and the settings in force, if loyalty applies. */
export interface SaleLoyaltyContext {
  customer: CustomerRef;
  /** Null when the plan lacks crm.loyalty or the pharmacy turned it off: nothing is earned or redeemed. */
  settings: LoyaltySettings | null;
  redeemPoints: number;
}

function pointsPayment(payments: readonly LoyaltyPayment[]): LoyaltyPayment | undefined {
  return payments.find((payment) => payment.method === "POINTS");
}

/**
 * Validates the customer of a sale and any POINTS payment. Runs inside the sale transaction with the
 * customer row locked, so two concurrent sales cannot spend the same points.
 */
export async function prepareSaleLoyalty(
  client: PoolClient,
  scope: TenantScope,
  customerId: string | undefined,
  payments: readonly LoyaltyPayment[],
  loyaltyPlan: boolean
): Promise<SaleLoyaltyContext | null> {
  if (customerId === undefined) return null;
  const customer = await lockCustomer(client, scope.tenantId, customerId);
  if (!customer) {
    throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "The customer does not exist in this pharmacy." });
  }
  if (!customer.isActive) {
    throw new ConflictException({ code: "CUSTOMER_INACTIVE", message: "The customer is inactive." });
  }
  const ref: CustomerRef = { id: customer.id, fullName: customer.fullName, docType: customer.docType, docNumber: customer.docNumber };
  const points = pointsPayment(payments);
  if (!loyaltyPlan) {
    if (points) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "PLAN_FEATURE_RESTRICTED",
        message: "Tu plan no incluye esta funcionalidad.",
        feature: "crm.loyalty"
      });
    }
    return { customer: ref, settings: null, redeemPoints: 0 };
  }
  const settings = await loadLoyaltySettings(client, scope.tenantId);
  if (!settings.enabled) {
    if (points) {
      throw new BadRequestException({ code: "LOYALTY_DISABLED", message: "Loyalty points are disabled for this pharmacy." });
    }
    return { customer: ref, settings: null, redeemPoints: 0 };
  }
  let redeemPoints = 0;
  if (points) {
    const value = toUnits(settings.pointValueBob);
    const amount = toUnits(points.amountBob);
    if (amount % value !== 0n) {
      throw new BadRequestException({
        code: "INVALID_INPUT",
        message: `A POINTS payment must be a whole number of points (1 point = ${settings.pointValueBob} BOB).`
      });
    }
    redeemPoints = Number(amount / value);
    const balance = await customerBalance(client, scope.tenantId, customer.id);
    if (redeemPoints > balance) {
      throw new BadRequestException({
        code: "INSUFFICIENT_POINTS",
        message: "The customer does not have enough points.",
        required: redeemPoints,
        balance
      });
    }
  }
  return { customer: ref, settings, redeemPoints };
}

/** Appends REDEEM and EARN rows of a confirmed sale; earning = floor(CASH net of change + CARD + QR, per bobPerPoint). */
export async function settleSaleLoyalty(
  client: PoolClient,
  scope: TenantScope,
  context: SaleLoyaltyContext,
  sale: { id: string; number: string },
  payments: readonly LoyaltyPayment[],
  changeBob: string
): Promise<SaleLoyalty | null> {
  if (!context.settings) return null;
  const customerId = context.customer.id;
  if (context.redeemPoints > 0) {
    await insertMovement(client, scope, {
      customerId,
      saleId: sale.id,
      kind: "REDEEM",
      points: -context.redeemPoints,
      reason: `Canje de puntos en venta ${sale.number}`
    });
  }
  const received = payments.filter((payment) => earnsLoyalty(payment.method)).reduce((sum, payment) => sum + toUnits(payment.amountBob), 0n);
  const earned = Number((received - toUnits(changeBob)) / toUnits(context.settings.bobPerPoint));
  if (earned > 0) {
    await insertMovement(client, scope, {
      customerId,
      saleId: sale.id,
      kind: "EARN",
      points: earned,
      reason: `Puntos ganados en venta ${sale.number}`
    });
  }
  return { earned, redeemed: context.redeemPoints, balance: await customerBalance(client, scope.tenantId, customerId) };
}

/** What a sale earned and redeemed (original amounts) plus the current balance of its customer. */
export async function loadSaleLoyalty(client: PoolClient, tenantId: string, saleId: string, customerId: string): Promise<SaleLoyalty> {
  const totals = await saleLedgerTotals(client, tenantId, saleId);
  return { earned: totals.earned, redeemed: totals.redeemed, balance: await customerBalance(client, tenantId, customerId) };
}

export interface VoidLoyaltyResult {
  earnedReversed: number;
  redeemedReturned: number;
  /** Earned points that could not be reversed because the customer already spent them. */
  shortfall: number;
}

/**
 * Gives back every redeemed point and takes back the earned ones. The balance never goes negative: when the
 * customer already spent part of the earned points, only what they still hold is reversed and the missing
 * amount (shortfall) is written in the reason of the REVERSAL row and returned to the caller.
 */
export async function reverseSaleLoyalty(
  client: PoolClient,
  scope: TenantScope,
  sale: { id: string; number: string; customerId: string | null },
  label: { reasonPrefix: string; saleReturnId?: string },
  targets: { give: number; take: number }
): Promise<VoidLoyaltyResult | null> {
  if (!sale.customerId) return null;
  const customerId = sale.customerId;
  await lockCustomer(client, scope.tenantId, customerId);
  let balance = await customerBalance(client, scope.tenantId, customerId);
  if (targets.give > 0) {
    await insertMovement(client, scope, {
      customerId,
      saleId: sale.id,
      saleReturnId: label.saleReturnId,
      kind: "REVERSAL",
      points: targets.give,
      reason: `${label.reasonPrefix}: puntos canjeados devueltos`
    });
    balance += targets.give;
  }
  const taken = Math.min(targets.take, balance);
  const shortfall = targets.take - taken;
  if (taken > 0) {
    const note = shortfall > 0 ? ` (faltaron ${shortfall} pts: el cliente ya los uso)` : "";
    await insertMovement(client, scope, {
      customerId,
      saleId: sale.id,
      saleReturnId: label.saleReturnId,
      kind: "REVERSAL",
      points: -taken,
      reason: `${label.reasonPrefix}: puntos ganados revertidos${note}`
    });
  }
  return { earnedReversed: taken, redeemedReturned: targets.give, shortfall };
}

/** Void: everything goes back. */
export async function reverseLoyaltyOnVoid(
  client: PoolClient,
  scope: TenantScope,
  sale: { id: string; number: string; customerId: string | null }
): Promise<VoidLoyaltyResult | null> {
  if (!sale.customerId) return null;
  const totals = await saleLedgerTotals(client, scope.tenantId, sale.id);
  if (totals.earned === 0 && totals.redeemed === 0) return null;
  return reverseSaleLoyalty(client, scope, sale, { reasonPrefix: `Anulacion de venta ${sale.number}` }, {
    give: totals.redeemed - totals.givenBack,
    take: totals.earned - totals.takenBack
  });
}

export interface ReturnLoyaltyPlan {
  /** False when the sale has no customer or never moved points: the return behaves exactly as before. */
  applies: boolean;
  /** Points handed back to the customer for the part of the refund that was paid with points. */
  pointsReturned: number;
  /** BOB value of those points (taken from the refund; the rest is refunded by the chosen method). */
  pointsValueUnits: bigint;
  /** Earned points to reverse with this return (floor, cumulative). */
  earnedToReverse: number;
}

export const NO_RETURN_LOYALTY: ReturnLoyaltyPlan = { applies: false, pointsReturned: 0, pointsValueUnits: 0n, earnedToReverse: 0 };

/**
 * D70: a return refunds the payment mix proportionally. With `cumulativeUnits` = value of everything returned so far
 * including this return and `totalUnits` = sale total, the points given back and the earned points reversed are the
 * floored cumulative shares minus what previous returns already moved, so rounding never drifts and the final
 * return closes the sale exactly.
 */
export async function planReturnLoyalty(
  client: PoolClient,
  tenantId: string,
  sale: { id: string; customerId: string | null },
  cumulativeUnits: bigint,
  totalUnits: bigint
): Promise<ReturnLoyaltyPlan> {
  if (!sale.customerId || totalUnits <= 0n) return NO_RETURN_LOYALTY;
  const totals = await saleLedgerTotals(client, tenantId, sale.id);
  if (totals.earned === 0 && totals.redeemed === 0) return NO_RETURN_LOYALTY;
  const share = (amount: number): number => Number((BigInt(amount) * cumulativeUnits) / totalUnits);
  const pointsReturned = Math.max(0, share(totals.redeemed) - totals.givenBack);
  const earnedToReverse = Math.max(0, share(totals.earned) - totals.takenBack);
  let pointsValueUnits = 0n;
  if (pointsReturned > 0) {
    const paid = await client.query<{ amount: string }>(
      `select coalesce(sum(amount_bob), 0)::text as amount from sale_payments
       where tenant_id = $1 and sale_id = $2 and method = 'POINTS'`,
      [tenantId, sale.id]
    );
    // points * (value of one point at sale time); the point value is exactly paid / redeemed.
    pointsValueUnits = (toUnits(paid.rows[0]!.amount) / BigInt(totals.redeemed)) * BigInt(pointsReturned);
  }
  return { applies: true, pointsReturned, pointsValueUnits, earnedToReverse };
}
