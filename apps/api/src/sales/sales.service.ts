import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { DocumentSequenceService } from "../transversal/document-sequence.service.js";
import {
  assertAssistedPrescription,
  containsControlledProduct,
  insertPrescription,
  normalizePrescription,
  prescriptionRequired,
  type ControlledPrescriptionInput,
  type NormalizedPrescription,
  type RecordedPrescription
} from "../controlled/prescription.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { SubscriptionAccessError } from "../subscriptions/quota.service.js";
import {
  SalesHistoryReader,
  type SaleDetail,
  type SalesAccess,
  type SalesListQuery,
  type SalesListResult
} from "./sales-history.js";

import { fromUnits, toUnits } from "./sales-money.js";
import { assertPaymentMethod, isCreditLike, isCashMethod, requiresReference, type SalePaymentMethod } from "./payment-methods.js";
import {
  prepareSaleLoyalty,
  settleSaleLoyalty,
  type SaleLoyalty
} from "./sales-loyalty.js";
import {
  chargeSaleAgreement,
  prepareSaleAgreement,
  type SaleAgreement
} from "./sales-agreements.js";
import type { CustomerRef } from "../customers/loyalty-ledger.js";
import { featureEnabled, requireFeature } from "../staff/staff.common.js";
import {
  SalesReturnsWriter,
  type RegisteredReturn,
  type RegisterReturnInput,
  type VoidedSale,
  type VoidSaleInput
} from "./sales-returns.js";
import {
  SalesQuotes,
  type CancelQuoteInput,
  type CreateQuoteInput,
  type QuoteDetail,
  type QuotesListQuery,
  type QuotesListResult
} from "./sales-quotes.js";
import { fefoSuggestedBatchId, lockFefoRows, lockOverrideRow, type FefoRow } from "./sales-fefo.js";
import {
  resolveCurrentPrice,
  SalesLookupReader,
  type SalesBatchesQuery,
  type SalesBatchOption,
  type SalesLookupItem,
  type SalesLookupQuery
} from "./sales-lookup.js";

export { resolveSalesAccess } from "./sales-history.js";
export type { SalesBatchesQuery, SalesBatchOption, SalesLookupItem, SalesLookupQuery } from "./sales-lookup.js";
export type {
  CancelQuoteInput,
  CreateQuoteInput,
  QuoteDetail,
  QuotesListQuery,
  QuotesListResult
} from "./sales-quotes.js";
export type { RegisteredReturn, RegisterReturnInput, VoidedSale, VoidSaleInput } from "./sales-returns.js";
export type { SaleDetail, SalesAccess, SalesListQuery, SalesListResult } from "./sales-history.js";
import { AuditService } from "../transversal/audit.service.js";
import { OutboxService } from "../transversal/outbox.service.js";
import { FiscalService } from "../fiscal/fiscal.service.js";
import {
  IdempotencyService,
  IdempotencyKeyReusedError,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";

export type { SalePaymentMethod } from "./payment-methods.js";

export interface SalePaymentInput {
  method: SalePaymentMethod | string;
  amountBob: string;
  /** Required for CARD and QR (manual voucher/transaction reference); forbidden for CASH, POINTS and AGREEMENT. */
  reference?: string;
  /** Required by (and only allowed on) an AGREEMENT payment: the agreement that covers part of the sale. */
  agreementId?: string;
}

export interface NormalizedSalePayment {
  method: SalePaymentMethod;
  amountBob: string;
  reference?: string;
  agreementId?: string;
}

export interface ConfirmSaleLineInput {
  presentationId: string;
  quantity: number;
  /**
   * Optional. The server always charges the current list price; when the client sends one it must
   * match, otherwise the sale is rejected with PRICE_CHANGED.
   */
  unitPriceBob?: string;
  /**
   * Optional lot chosen instead of FEFO. Requires the `sales.fefo.override` permission and the
   * request-level `overrideReason`.
   */
  batchId?: string;
}

/** What the caller may do beyond plain selling; resolved by the controller from the permissions. */
export interface SalesConfirmAccess {
  canOverrideFefo: boolean;
}

export interface ConfirmSaleInput {
  idempotencyKey: string;
  cashShiftId: string;
  warehouseId: string;
  /** One or more payments (mixed methods allowed). */
  payments?: readonly SalePaymentInput[];
  /** Legacy single-payment shape, used only when `payments` is absent. */
  paymentMethod?: SalePaymentMethod | string;
  paidAmountBob?: string;
  lines: readonly ConfirmSaleLineInput[];
  /** Mandatory (at most 200 characters) when any line sets `batchId`. */
  overrideReason?: string;
  /** Quote being converted; it becomes CONVERTED in the same transaction as the sale. */
  quoteId?: string;
  /**
   * Optional customer (F17): must exist, be active and belong to the pharmacy. Required by a POINTS payment;
   * with the crm.loyalty feature the sale earns points.
   */
  customerId?: string;
  /**
   * Prescription data. Mandatory (PRESCRIPTION_REQUIRED) when any line is an effectively controlled
   * product (F15/D57); ignored for sales without controlled products.
   */
  prescription?: ControlledPrescriptionInput;
}

export interface NormalizedSaleInput {
  idempotencyKey: string;
  cashShiftId: string;
  warehouseId: string;
  payments: NormalizedSalePayment[];
  lines: ConfirmSaleLineInput[];
  overrideReason?: string;
  quoteId?: string;
  customerId?: string;
  prescription?: NormalizedPrescription;
}

export interface SaleAllocation {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
  fefoOverride: boolean;
}

export interface ConfirmedSaleItem {
  presentationId: string;
  quantity: number;
  quantityBase: number;
  unitPriceBob: string;
  lineTotalBob: string;
  fefoOverride: boolean;
  fefoOverrideReason: string | null;
  allocations: SaleAllocation[];
}

/** Resumen de ventas de la sucursal para el panel (hora de Bolivia). Montos en BOB como texto exacto. */
export interface SalesSummary {
  today: { totalBob: string; count: number };
  month: { totalBob: string; count: number; units: number; averageTicketBob: string };
  monthly: Array<{ month: string; totalBob: string; count: number }>;
  daily: Array<{ day: string; totalBob: string; count: number }>;
  recent: Array<{ id: string; createdAt: string; totalBob: string; items: number; cashierName: string | null }>;
}

export interface ConfirmedSalePayment {
  method: SalePaymentMethod;
  amountBob: string;
  reference: string | null;
}

export interface ConfirmedSale {
  id: string;
  /** Human-readable per-branch number, e.g. V-MAIN-000001. */
  saleNumber: string;
  cashShiftId: string;
  warehouseId: string;
  status: "CONFIRMED";
  totalBob: string;
  /** Total tendered across all payments (exceeds the total only by the cash change). */
  paidAmountBob: string;
  changeAmountBob: string;
  payments: ConfirmedSalePayment[];
  items: ConfirmedSaleItem[];
  /** Archived controlled-medicine prescription (id + folio R-<branch>-000001), null when none was required. */
  prescription: RecordedPrescription | null;
  /** The customer linked to the sale, null for anonymous sales. */
  customer: CustomerRef | null;
  /** Points earned/redeemed and the balance afterwards; null without customer or when loyalty does not apply. */
  loyalty: SaleLoyalty | null;
  /** The agreement that covered part of the sale (F17 Part B), null without an AGREEMENT payment. */
  agreement: SaleAgreement | null;
}

const decimalPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

function text(value: string, field: string, max = 255): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) {
    throw new BadRequestException(`${field} must be non-empty and at most ${max} characters.`);
  }
  return normalized;
}

function decimal(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized || !decimalPattern.test(normalized)) {
    throw new BadRequestException(`${field} must be a non-negative decimal with at most 4 places.`);
  }
  return normalized;
}

function quantity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000) {
    throw new BadRequestException(`${field} must be a positive safe integer.`);
  }
  return value;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function batchIdValue(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!uuidPattern.test(normalized)) throw new BadRequestException("Batch ID must be a valid UUID.");
  return normalized;
}

function normalizePayment(payment: SalePaymentInput): NormalizedSalePayment {
  const method = assertPaymentMethod(text(payment?.method, "Payment method", 16).toUpperCase());
  const amountBob = decimal(payment.amountBob, "Payment amount");
  if (toUnits(amountBob) <= 0n) {
    throw new BadRequestException("Payment amount must be greater than zero.");
  }
  const reference = payment.reference?.trim();
  const rawAgreementId = typeof payment.agreementId === "string" ? payment.agreementId.trim() : payment.agreementId;
  if (method === "AGREEMENT") {
    if (typeof rawAgreementId !== "string" || !uuidPattern.test(rawAgreementId)) {
      throw new BadRequestException({ code: "INVALID_INPUT", message: "An AGREEMENT payment requires a valid agreementId." });
    }
  } else if (rawAgreementId !== undefined && rawAgreementId !== null) {
    throw new BadRequestException({ code: "INVALID_INPUT", message: `A ${method} payment must not have an agreementId.` });
  }
  if (!requiresReference(method)) {
    if (reference) throw new BadRequestException(`A ${method} payment must not have a reference.`);
    return method === "AGREEMENT" ? { method, amountBob, agreementId: rawAgreementId as string } : { method, amountBob };
  }
  if (!reference || reference.length > 64) {
    throw new BadRequestException(`A ${method} payment requires a reference of at most 64 characters.`);
  }
  return { method, amountBob, reference };
}

export function normalizeSaleInput(input: ConfirmSaleInput): NormalizedSaleInput {
  const rawPayments: readonly SalePaymentInput[] | undefined =
    input.payments ??
    (input.paymentMethod !== undefined && input.paidAmountBob !== undefined
      ? [{ method: input.paymentMethod, amountBob: input.paidAmountBob }]
      : undefined);
  if (!Array.isArray(rawPayments) || rawPayments.length === 0 || rawPayments.length > 10) {
    throw new BadRequestException("At least one and at most 10 payments are required.");
  }
  const payments = rawPayments.map(normalizePayment);
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 100) {
    throw new BadRequestException("At least one and at most 100 sale lines are required.");
  }
  const lines = input.lines.map((line) => ({
    presentationId: text(line.presentationId, "Presentation ID", 64),
    quantity: quantity(line.quantity, "Sale quantity"),
    ...(line.batchId === undefined || line.batchId === null ? {} : { batchId: batchIdValue(line.batchId) }),
    ...(line.unitPriceBob === undefined || line.unitPriceBob === null
      ? {}
      : { unitPriceBob: decimal(line.unitPriceBob, "Unit price") })
  }));
  let overrideReason: string | undefined;
  if (lines.some((line) => line.batchId !== undefined)) {
    const reason = typeof input.overrideReason === "string" ? input.overrideReason.trim() : "";
    if (!reason || reason.length > 200) {
      throw new BadRequestException("An override reason of 1 to 200 characters is required when a lot is chosen.");
    }
    overrideReason = reason;
  }
  let quoteId: string | undefined;
  if (input.quoteId !== undefined && input.quoteId !== null) {
    const candidate = typeof input.quoteId === "string" ? input.quoteId.trim() : "";
    if (!uuidPattern.test(candidate)) throw new BadRequestException("Quote ID must be a valid UUID.");
    quoteId = candidate;
  }
  let customerId: string | undefined;
  if (input.customerId !== undefined && input.customerId !== null) {
    const candidate = typeof input.customerId === "string" ? input.customerId.trim() : "";
    if (!uuidPattern.test(candidate)) throw new BadRequestException("Customer ID must be a valid UUID.");
    customerId = candidate;
  }
  const creditLike = payments.filter((payment) => isCreditLike(payment.method));
  if (creditLike.length > 0 && customerId === undefined) {
    throw new BadRequestException({ code: "INVALID_INPUT", message: "A POINTS or AGREEMENT payment requires a customer." });
  }
  if (new Set(creditLike.map((payment) => payment.method)).size !== creditLike.length) {
    throw new BadRequestException({ code: "INVALID_INPUT", message: "Each credit-like payment method may appear only once." });
  }
  const prescription = normalizePrescription(input.prescription);
  return {
    idempotencyKey: text(input.idempotencyKey, "Idempotency key"),
    cashShiftId: text(input.cashShiftId, "Cash shift ID", 64),
    warehouseId: text(input.warehouseId, "Warehouse ID", 64),
    payments,
    lines,
    ...(overrideReason === undefined ? {} : { overrideReason }),
    ...(quoteId === undefined ? {} : { quoteId }),
    ...(customerId === undefined ? {} : { customerId }),
    ...(prescription === undefined ? {} : { prescription })
  };
}

export interface PaymentEvaluation {
  paidBob: string;
  changeBob: string;
  /** CASH that stays in the drawer: cash tendered minus the change given back. */
  cashNetBob: string;
}

/**
 * Validates tendered payments against the exact sale total. Payments must cover the total;
 * only CASH may exceed it (the excess is the change); every other method (CARD, QR, POINTS...) can never exceed what is due.
 */
export function evaluatePayments(totalBob: string, payments: readonly NormalizedSalePayment[]): PaymentEvaluation {
  const total = toUnits(totalBob);
  let cash = 0n;
  let nonCash = 0n;
  for (const payment of payments) {
    const amount = toUnits(payment.amountBob);
    if (isCashMethod(payment.method)) cash += amount;
    else nonCash += amount;
  }
  const paid = cash + nonCash;
  if (paid < total) {
    throw new BadRequestException("Payments must cover the sale total.");
  }
  if (nonCash > total) {
    throw new BadRequestException("Card or QR payments (and points) cannot exceed the amount due.");
  }
  const change = paid - total;
  return { paidBob: fromUnits(paid), changeBob: fromUnits(change), cashNetBob: fromUnits(cash - change) };
}

interface SaleRow {
  id: string;
  totalBob: string;
  paidAmountBob: string;
}

/** Sale total net of the refunds already registered against it (voided/fully returned sales are excluded by status). */
const netTotal = `(s.total_amount_bob - coalesce((select sum(r.refund_amount_bob) from sale_returns r
  where r.tenant_id = s.tenant_id and r.branch_id = s.branch_id and r.sale_id = s.id), 0))`;
const returnedQuantity = `coalesce((select sum(ri.quantity) from sale_return_items ri
  where ri.tenant_id = i.tenant_id and ri.branch_id = i.branch_id and ri.sale_item_id = i.id), 0)`;

@Injectable()
export class SalesService {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();
  private readonly outbox = new OutboxService();
  private readonly sequences = new DocumentSequenceService();
  /** F13 (D51): creates the fiscal_invoices draft row synchronously, inside the sale-confirm transaction. */
  private readonly fiscal: FiscalService;
  private readonly history: SalesHistoryReader;
  private readonly catalogLookup: SalesLookupReader;
  private readonly returns: SalesReturnsWriter;
  private readonly quotes: SalesQuotes;
  private readonly features: FeatureService;

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.history = new SalesHistoryReader(database);
    this.catalogLookup = new SalesLookupReader(database);
    this.returns = new SalesReturnsWriter(database);
    this.quotes = new SalesQuotes(database);
    this.fiscal = new FiscalService(database);
    this.features = new FeatureService(database);
  }

  createQuote(scope: TenantScope, input: CreateQuoteInput): Promise<QuoteDetail> {
    return this.quotes.create(scope, input);
  }

  listQuotes(scope: TenantScope, query: QuotesListQuery): Promise<QuotesListResult> {
    return this.quotes.list(scope, query);
  }

  quoteDetail(scope: TenantScope, quoteId: string): Promise<QuoteDetail> {
    return this.quotes.detail(scope, quoteId);
  }

  cancelQuote(scope: TenantScope, quoteId: string, input: CancelQuoteInput): Promise<QuoteDetail> {
    return this.quotes.cancel(scope, quoteId, input);
  }

  lookup(scope: TenantScope, query: SalesLookupQuery): Promise<{ items: SalesLookupItem[] }> {
    return this.catalogLookup.lookup(scope, query);
  }

  list(scope: TenantScope, query: SalesListQuery, access: SalesAccess): Promise<SalesListResult> {
    return this.history.list(scope, query, access);
  }

  detail(scope: TenantScope, saleId: string, access: SalesAccess): Promise<SaleDetail> {
    return this.history.detail(scope, saleId, access);
  }

  /** Full void while the sale's cash shift is still open: stock and cash go back exactly. */
  voidSale(scope: TenantScope, saleId: string, input: VoidSaleInput, access: SalesAccess): Promise<VoidedSale> {
    return this.returns.voidSale(scope, saleId, input, access);
  }

  /** Partial or full return of sold lines, any time after the sale. */
  registerReturn(
    scope: TenantScope,
    saleId: string,
    input: RegisterReturnInput,
    access: SalesAccess
  ): Promise<RegisteredReturn> {
    return this.returns.registerReturn(scope, saleId, input, access);
  }

  /** Lots of a presentation in FEFO order, for users who may choose a lot different from FEFO. */
  listBatches(scope: TenantScope, query: SalesBatchesQuery): Promise<{ items: SalesBatchOption[] }> {
    return this.catalogLookup.listBatches(scope, query);
  }

  async confirm(scope: TenantScope, input: ConfirmSaleInput, access?: SalesConfirmAccess): Promise<ConfirmedSale> {
    if (Array.isArray(input?.lines) && input.lines.some((line) => line?.batchId) && !access?.canOverrideFefo) {
      throw new ForbiddenException({
        code: "FEFO_OVERRIDE_FORBIDDEN",
        message: "Choosing a lot different from FEFO requires the sales.fefo.override permission."
      });
    }
    const normalized = normalizeSaleInput(input);
    await this.assertAssistedPrescription(scope, normalized);
    const loyaltyPlan = await this.resolveCrmPlan(scope, normalized);
    try {
      const result = await this.idempotency.execute(
        this.database,
        scope,
        "sales.confirm_cash",
        normalized.idempotencyKey,
        normalized,
        async (client) => ({
          statusCode: 201,
          body: await this.postSale(client, scope, normalized, loyaltyPlan)
        } satisfies IdempotentExecutionResult<ConfirmedSale>)
      );
      return (result.body ?? result.data) as ConfirmedSale;
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) {
        throw new ConflictException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  /**
   * Plans with `controlled.assisted` get stricter checks (ID formats, validity window) on the
   * prescription of a sale that really dispenses a controlled product. Runs before the idempotent
   * execution; a tenant without an active subscription simply gets the manual rules.
   */
  private async assertAssistedPrescription(scope: TenantScope, input: NormalizedSaleInput): Promise<void> {
    if (!input.prescription) return;
    const presentationIds = input.lines.map((line) => line.presentationId);
    const controlled = await this.database.withScope(scope, (client) =>
      containsControlledProduct(client, scope, presentationIds)
    );
    if (!controlled) return;
    let assisted = false;
    try {
      assisted = await this.features.isEnabled(scope, "controlled.assisted");
    } catch (error) {
      if (!(error instanceof SubscriptionAccessError)) throw error;
    }
    if (assisted) assertAssistedPrescription(input.prescription);
  }

  /**
   * F17: a sale with a customer needs crm.customers (403 otherwise); loyalty only applies when the plan has
   * crm.loyalty. Sales without customer skip these checks entirely.
   */
  private async resolveCrmPlan(scope: TenantScope, input: NormalizedSaleInput): Promise<boolean> {
    if (input.customerId === undefined) return false;
    await requireFeature(this.features, scope, "crm.customers");
    if (input.payments.some((payment) => payment.method === "AGREEMENT")) {
      await requireFeature(this.features, scope, "crm.agreements");
    }
    return featureEnabled(this.features, scope, "crm.loyalty");
  }

  private async postSale(
    client: PoolClient,
    scope: TenantScope,
    input: NormalizedSaleInput,
    loyaltyPlan: boolean
  ): Promise<ConfirmedSale> {
    const shift = await client.query<{ id: string }>(
      `select control.cash_shift_id as id
       from cash_shift_controls control
       join cash_shift_users assignment
         on assignment.tenant_id = control.tenant_id
        and assignment.branch_id = control.branch_id
        and assignment.cash_shift_id = control.cash_shift_id
       join users app_user on app_user.id = assignment.user_id
       join cash_shifts shift
         on shift.tenant_id = control.tenant_id
        and shift.branch_id = control.branch_id
        and shift.id = control.cash_shift_id
       where control.tenant_id = $1 and control.branch_id = $2
         and control.cash_shift_id = $3 and control.status = 'OPEN'
         and assignment.user_id = $4 and app_user.is_active = true
         and shift.status = 'SCHEDULED'
       for update of control` ,
      [scope.tenantId, scope.branchId, input.cashShiftId, scope.userId]
    );
    if (!shift.rows[0]) {
      throw new ConflictException("An OPEN cash shift assigned to the authenticated user is required.");
    }

    const warehouse = await client.query<{ id: string }>(
      `select id from warehouses
       where tenant_id = $1 and branch_id = $2 and id = $3 and is_dispatch_enabled = true and is_active
       for key share`,
      [scope.tenantId, scope.branchId, input.warehouseId]
    );
    if (!warehouse.rows[0]) {
      throw new NotFoundException("The warehouse is not available for this branch.");
    }

    const controlled = await containsControlledProduct(
      client,
      scope,
      input.lines.map((line) => line.presentationId)
    );
    if (controlled && !input.prescription) throw prescriptionRequired();

    const loyaltyContext = await prepareSaleLoyalty(client, scope, input.customerId, input.payments, loyaltyPlan);
    // F17 Part B: agreement and member are validated (member row locked) before any stock moves.
    const agreementContext = await prepareSaleAgreement(client, scope, input.customerId, input.payments);

    const saleNumber = await this.nextSaleNumber(client, scope);
    const sale = await client.query<SaleRow>(
      `insert into sales
         (tenant_id, branch_id, cash_shift_id, warehouse_id, status, total_amount_bob, paid_amount_bob, created_by_user_id, sale_number, customer_id)
       values ($1, $2, $3, $4, 'CONFIRMED', 0, 0, $5, $6, $7)
       returning id, total_amount_bob::text as "totalBob", paid_amount_bob::text as "paidAmountBob"`,
      [scope.tenantId, scope.branchId, input.cashShiftId, input.warehouseId, scope.userId, saleNumber, input.customerId ?? null]
    );
    const saleRow = sale.rows[0];
    if (!saleRow) throw new Error("Sale was not created.");
    if (input.quoteId) await this.quotes.convertInTransaction(client, scope, input.quoteId, saleRow.id);

    const items: ConfirmedSaleItem[] = [];
    let totalBob = "0";
    for (const line of input.lines) {
      const presentation = await client.query<{ id: string; factor: string }>(
        `select id, base_unit_factor::text as factor
         from product_presentations
         where tenant_id = $1 and id = $2 and is_sellable = true and is_active = true
           and exists (
             select 1 from products
             where products.tenant_id = product_presentations.tenant_id
               and products.id = product_presentations.product_id
               and products.is_active
           )
         for key share`,
        [scope.tenantId, line.presentationId]
      );
      const presentationRow = presentation.rows[0];
      if (!presentationRow) {
        throw new NotFoundException("The product presentation is not available in this tenant.");
      }
      const currentPrice = await resolveCurrentPrice(client, scope, line.presentationId);
      if (currentPrice === null) {
        throw new ConflictException({
          code: "PRICE_NOT_FOUND",
          message: "The presentation has no current price.",
          presentationId: line.presentationId
        });
      }
      if (line.unitPriceBob !== undefined && toUnits(line.unitPriceBob) !== toUnits(currentPrice)) {
        throw new ConflictException({
          code: "PRICE_CHANGED",
          message: "The price changed since it was loaded.",
          presentationId: line.presentationId,
          currentPriceBob: currentPrice
        });
      }
      const unitPriceBob = currentPrice;
      const factor = Number(presentationRow.factor);
      const quantityBase = factor * line.quantity;
      if (!Number.isSafeInteger(quantityBase)) {
        throw new BadRequestException("Sale quantity exceeds the safe base-unit limit.");
      }

      let allocationRows: FefoRow[];
      let fefoOverride = false;
      let fefoBatchId: string | null = null;
      if (line.batchId) {
        fefoBatchId = await fefoSuggestedBatchId(client, scope, input.warehouseId, line.presentationId);
        allocationRows = [
          await lockOverrideRow(client, scope, input.warehouseId, line.presentationId, line.batchId, quantityBase)
        ];
        fefoOverride = fefoBatchId !== line.batchId;
      } else {
        allocationRows = await lockFefoRows(client, scope, input.warehouseId, line.presentationId);
      }
      const overrideReason = fefoOverride ? (input.overrideReason ?? null) : null;
      const available = allocationRows.reduce(
        (sum, row) => sum + Number(row.quantityBase) - Number(row.reservedBase),
        0
      );
      if (available < quantityBase) {
        throw new ConflictException("Insufficient available FEFO inventory for the sale line.");
      }

      const item = await client.query<{ id: string; lineTotalBob: string }>(
        `insert into sale_items
           (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob,
            fefo_override, fefo_override_reason, unit_cost_base_bob)
         values ($1, $2, $3, $4, $5::bigint, $6, $7::numeric, ($5::bigint * $7::numeric), $8, $9,
                 -- F18 (D72): average cost per base unit at confirm time; null when the presentation has no recorded cost.
                 (select cost.average_unit_cost from presentation_costs cost where cost.tenant_id = $1 and cost.presentation_id = $4))
         returning id, line_total_bob::text as "lineTotalBob"`,
        [scope.tenantId, scope.branchId, saleRow.id, line.presentationId, line.quantity, quantityBase, unitPriceBob, fefoOverride, overrideReason]
      );
      const itemRow = item.rows[0];
      if (!itemRow) throw new Error("Sale item was not created.");

      let remaining = quantityBase;
      const allocations: SaleAllocation[] = [];
      for (const row of allocationRows) {
        if (remaining === 0) break;
        const availableRow = Number(row.quantityBase) - Number(row.reservedBase);
        const take = Math.min(remaining, availableRow);
        await client.query(
          `update inventory_balances
           set quantity_base = quantity_base - $4, updated_at = now()
           where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
             and quantity_base - reserved_base >= $4`,
          [scope.tenantId, input.warehouseId, row.batchId, take]
        );
        await client.query(
          `insert into inventory_movements
             (tenant_id, warehouse_id, batch_id, movement_type, movement_direction, quantity_base, reference_type, reference_id)
           values ($1, $2, $3, 'SALE', 'OUT', $4, 'SALE', $5)`,
          [scope.tenantId, input.warehouseId, row.batchId, take, saleRow.id]
        );
        await client.query(
          `insert into sale_allocations (tenant_id, branch_id, sale_item_id, batch_id, quantity_base, fefo_override)
           values ($1, $2, $3, $4, $5, $6)`,
          [scope.tenantId, scope.branchId, itemRow.id, row.batchId, take, fefoOverride]
        );
        allocations.push({
          batchId: row.batchId,
          lotCode: row.lotCode,
          expiresOn: new Date(row.expiresOn).toISOString().slice(0, 10),
          quantityBase: take,
          fefoOverride
        });
        remaining -= take;
      }
      if (fefoOverride && line.batchId) {
        await this.audit.recordInTransaction(client, scope, {
          action: "sales.fefo_override",
          entityType: "sale",
          entityId: saleRow.id,
          payload: {
            saleItemId: itemRow.id,
            presentationId: line.presentationId,
            chosenBatchId: line.batchId,
            fefoBatchId,
            reason: overrideReason
          }
        });
      }
      totalBob = await this.sumTotal(client, saleRow.id);
      items.push({
        presentationId: line.presentationId,
        quantity: line.quantity,
        quantityBase,
        unitPriceBob,
        lineTotalBob: itemRow.lineTotalBob,
        fefoOverride,
        fefoOverrideReason: overrideReason,
        allocations
      });
    }

    const total = await this.sumTotal(client, saleRow.id);
    const evaluation = evaluatePayments(total, input.payments);
    await client.query(
      `update sales set total_amount_bob = $4::numeric, paid_amount_bob = $5::numeric, change_amount_bob = $6::numeric
       where tenant_id = $1 and branch_id = $2 and id = $3`,
      [scope.tenantId, scope.branchId, saleRow.id, total, evaluation.paidBob, evaluation.changeBob]
    );
    const agreement = agreementContext
      ? await chargeSaleAgreement(client, scope, agreementContext, { id: saleRow.id, number: saleNumber }, total)
      : null;
    const payments: ConfirmedSalePayment[] = [];
    for (const payment of input.payments) {
      await client.query(
        `insert into sale_payments (tenant_id, branch_id, sale_id, method, amount_bob, reference)
         values ($1, $2, $3, $4, $5::numeric, $6)`,
        [scope.tenantId, scope.branchId, saleRow.id, payment.method, payment.amountBob, payment.reference ?? null]
      );
      payments.push({
        method: payment.method,
        amountBob: fromUnits(toUnits(payment.amountBob)),
        reference: payment.reference ?? null
      });
    }
    // Only the CASH that stays in the drawer (tendered minus change) enters the expected cash.
    await client.query(
      `update cash_shift_controls
       set expected_amount_bob = expected_amount_bob + $4::numeric
       where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3 and status = 'OPEN'`,
      [scope.tenantId, scope.branchId, input.cashShiftId, evaluation.cashNetBob]
    );
    const loyalty = loyaltyContext
      ? await settleSaleLoyalty(client, scope, loyaltyContext, { id: saleRow.id, number: saleNumber }, input.payments, evaluation.changeBob)
      : null;
    await this.audit.recordInTransaction(client, scope, {
      action: "sales.cash_sale_confirmed",
      entityType: "sale",
      entityId: saleRow.id,
      payload: {
        cashShiftId: input.cashShiftId,
        warehouseId: input.warehouseId,
        totalBob: total,
        changeBob: evaluation.changeBob,
        methods: payments.map((payment) => payment.method),
        ...(loyaltyContext ? { customerId: loyaltyContext.customer.id, loyalty } : {}),
        ...(agreement ? { agreement } : {})
      }
    });
    let recordedPrescription: RecordedPrescription | null = null;
    if (controlled && input.prescription) {
      recordedPrescription = await insertPrescription(client, scope, saleRow.id, input.prescription, this.sequences);
      await this.audit.recordInTransaction(client, scope, {
        action: "controlled.prescription_recorded",
        entityType: "sale",
        entityId: saleRow.id,
        payload: {
          prescriptionId: recordedPrescription.id,
          folio: recordedPrescription.folio,
          doctorLicense: input.prescription.doctorLicense,
          patientDocument: input.prescription.patientDocument,
          prescribedAt: input.prescription.prescribedAt
        }
      });
    }
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "sale",
      aggregateId: saleRow.id,
      eventType: "sales.cash_sale_confirmed",
      payload: { saleId: saleRow.id, totalBob: total, changeBob: evaluation.changeBob }
    });
    // F13 (T2/D51): every confirmed sale gets its fiscal_invoices draft row in the same transaction.
    await this.fiscal.createDraftInTransaction(client, scope, {
      saleId: saleRow.id,
      saleNumber,
      totalBob: total
    });
    return {
      id: saleRow.id,
      saleNumber,
      cashShiftId: input.cashShiftId,
      warehouseId: input.warehouseId,
      status: "CONFIRMED",
      totalBob: total,
      paidAmountBob: evaluation.paidBob,
      changeAmountBob: evaluation.changeBob,
      payments,
      items,
      prescription: recordedPrescription,
      customer: loyaltyContext?.customer ?? null,
      loyalty,
      agreement
    };
  }

  /** Totales de hoy y del mes, últimos 8 meses, últimos 14 días y últimas ventas de la sucursal activa. */
  async summary(scope: TenantScope, access: SalesAccess): Promise<SalesSummary> {
    return this.database.withScope(scope, async (client) => {
      const zone = "America/La_Paz";
      const params = [scope.tenantId, scope.branchId, zone, access.viewAll, scope.userId];
      const totals = await client.query<{
        todayTotal: string; todayCount: number; monthTotal: string; monthCount: number; monthUnits: string;
      }>(
        `with local_sales as (
           select s.id, ${netTotal} as total_amount_bob, (s.created_at at time zone $3) as local_at
           from sales s where s.tenant_id = $1 and s.branch_id = $2 and s.status in ('CONFIRMED', 'PARTIALLY_RETURNED')
             and ($4::boolean or s.created_by_user_id = $5)
         ), now_local as (select (now() at time zone $3) as at)
         select
           coalesce(sum(total_amount_bob) filter (where local_at::date = (select at from now_local)::date), 0)::text as "todayTotal",
           (count(*) filter (where local_at::date = (select at from now_local)::date))::int as "todayCount",
           coalesce(sum(total_amount_bob) filter (where date_trunc('month', local_at) = date_trunc('month', (select at from now_local))), 0)::text as "monthTotal",
           (count(*) filter (where date_trunc('month', local_at) = date_trunc('month', (select at from now_local))))::int as "monthCount",
           coalesce((select sum(i.quantity - ${returnedQuantity}) from sale_items i join local_sales ls on ls.id = i.sale_id
                     where i.tenant_id = $1 and date_trunc('month', ls.local_at) = date_trunc('month', (select at from now_local))), 0)::text as "monthUnits"
         from local_sales`,
        params
      );
      const monthly = await client.query<{ month: string; totalBob: string; count: number }>(
        `with months as (
           select generate_series(date_trunc('month', now() at time zone $3) - interval '7 months', date_trunc('month', now() at time zone $3), interval '1 month') as month
         )
         select to_char(m.month, 'YYYY-MM') as month,
                coalesce(sum(${netTotal}), 0)::text as "totalBob",
                count(s.id)::int as count
         from months m
         left join sales s on s.tenant_id = $1 and s.branch_id = $2 and s.status in ('CONFIRMED', 'PARTIALLY_RETURNED')
           and ($4::boolean or s.created_by_user_id = $5)
           and date_trunc('month', s.created_at at time zone $3) = m.month
         group by m.month order by m.month`,
        params
      );
      const daily = await client.query<{ day: string; totalBob: string; count: number }>(
        `with days as (
           select generate_series((now() at time zone $3)::date - 13, (now() at time zone $3)::date, interval '1 day')::date as day
         )
         select to_char(d.day, 'YYYY-MM-DD') as day,
                coalesce(sum(${netTotal}), 0)::text as "totalBob",
                count(s.id)::int as count
         from days d
         left join sales s on s.tenant_id = $1 and s.branch_id = $2 and s.status in ('CONFIRMED', 'PARTIALLY_RETURNED')
           and ($4::boolean or s.created_by_user_id = $5)
           and (s.created_at at time zone $3)::date = d.day
         group by d.day order by d.day`,
        params
      );
      const recent = await client.query<{ id: string; createdAt: Date; totalBob: string; items: number; cashierName: string | null }>(
        `select s.id, s.created_at as "createdAt", (${netTotal})::text as "totalBob",
                (select count(*) from sale_items i where i.sale_id = s.id)::int as items,
                u.display_name as "cashierName"
         from sales s left join users u on u.id = s.created_by_user_id
         where s.tenant_id = $1 and s.branch_id = $2 and s.status in ('CONFIRMED', 'PARTIALLY_RETURNED')
           and ($3::boolean or s.created_by_user_id = $4)
         order by s.created_at desc limit 6`,
        [scope.tenantId, scope.branchId, access.viewAll, scope.userId]
      );
      const row = totals.rows[0]!;
      const monthCount = row.monthCount;
      const average = monthCount ? (Number(row.monthTotal) / monthCount).toFixed(2) : "0.00";
      return {
        today: { totalBob: row.todayTotal, count: row.todayCount },
        month: { totalBob: row.monthTotal, count: monthCount, units: Number(row.monthUnits), averageTicketBob: average },
        monthly: monthly.rows,
        daily: daily.rows,
        recent: recent.rows.map((sale) => ({ ...sale, createdAt: sale.createdAt.toISOString() }))
      };
    });
  }

  private async nextSaleNumber(client: PoolClient, scope: TenantScope): Promise<string> {
    const branch = await client.query<{ code: string }>(
      "select code from branches where tenant_id = $1 and id = $2",
      [scope.tenantId, scope.branchId]
    );
    const number = await this.sequences.nextNumberInTransaction(client, "SALE");
    return `V-${branch.rows[0]?.code ?? "SUC"}-${number.toString().padStart(6, "0")}`;
  }

  private async sumTotal(client: PoolClient, saleId: string): Promise<string> {
    const result = await client.query<{ total: string }>(
      `select coalesce(sum(line_total_bob), 0)::text as total from sale_items where sale_id = $1`,
      [saleId]
    );
    return result.rows[0]?.total ?? "0";
  }
}
