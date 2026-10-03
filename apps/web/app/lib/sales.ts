import { authenticatedFetch } from "./session";

export interface SaleLineInput {
  presentationId: string;
  quantity: number;
  /** Optional: the server charges the current list price and rejects a different one (PRICE_CHANGED). */
  unitPriceBob?: string;
  /** Lot chosen instead of FEFO; needs the sales.fefo.override permission and `overrideReason`. */
  batchId?: string;
}

export type SalePaymentMethod = "CASH" | "CARD" | "QR";

export const salePaymentMethodLabels: Record<SalePaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  QR: "QR"
};

export interface SalePaymentInput {
  method: SalePaymentMethod;
  amountBob: string;
  /** Required for CARD and QR, not allowed for CASH. */
  reference?: string;
}

export interface ConfirmSaleInput {
  idempotencyKey: string;
  cashShiftId: string;
  warehouseId: string;
  payments: SalePaymentInput[];
  lines: SaleLineInput[];
  /** Required (at most 200 characters) when any line sets `batchId`. */
  overrideReason?: string;
  /** Quote being converted; the API marks it CONVERTED in the same transaction as the sale. */
  quoteId?: string;
  /** Required by the API when any line is a controlled medicine; sent only in that case. */
  prescription?: Record<string, string>;
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

export interface ConfirmedSale {
  id: string;
  saleNumber: string;
  cashShiftId: string;
  warehouseId: string;
  status: "CONFIRMED";
  totalBob: string;
  paidAmountBob: string;
  changeAmountBob: string;
  payments: Array<{ method: SalePaymentMethod; amountBob: string; reference: string | null }>;
  items: ConfirmedSaleItem[];
  /** Archived prescription (id + folio) when the sale dispensed a controlled medicine. */
  prescription: { id: string; folio: string } | null;
}

export interface SalesShift {
  id: string;
  cashRegisterId: string;
  cashRegisterCode: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  status: "SCHEDULED" | "CANCELED";
  control?: { status: "OPEN" | "PENDING_APPROVAL" | "CLOSED" };
}

export interface SalesWarehouse {
  id: string;
  name: string;
  isDispatchEnabled: boolean;
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
  /** Exact decimal text, or null when the presentation has no current price. */
  priceBob: string | null;
  availableBase: number;
  /** Whole presentation units that can be sold now in the chosen warehouse. */
  availableQuantity: number;
  /** The barcode that matched exactly, otherwise null. */
  barcode: string | null;
  /** Controlled medicine: the sale needs prescription data. */
  isControlled: boolean;
}

function key(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Error with the stable API code (for example PRICE_CHANGED) and its extra fields. */
export class SalesApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly presentationId?: string,
    readonly currentPriceBob?: string,
    readonly field?: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    let message = "No pudimos completar la venta.";
    let body: { message?: string; code?: string; presentationId?: string; currentPriceBob?: string; field?: string } = {};
    try {
      body = (await response.json()) as typeof body;
      message = body.message ?? message;
    } catch {
      // Keep the stable fallback for non-JSON responses.
    }
    throw new SalesApiError(message, body.code, body.presentationId, body.currentPriceBob, body.field);
  }
  return (await response.json()) as T;
}

export function salesIdempotencyKey(): string {
  return key();
}

export async function listSalesShifts(): Promise<SalesShift[]> {
  return (await request<{ items: SalesShift[] }>("/api/v1/cash/shifts")).items;
}

export async function listSalesWarehouses(): Promise<SalesWarehouse[]> {
  return (await request<{ items: SalesWarehouse[] }>("/api/v1/inventory/warehouses")).items;
}

export async function lookupSalesPresentations(
  query: string,
  warehouseId: string,
  signal?: AbortSignal
): Promise<SalesLookupItem[]> {
  const params = new URLSearchParams({ q: query, warehouseId, limit: "12" });
  return (await request<{ items: SalesLookupItem[] }>(`/api/v1/sales/lookup?${params.toString()}`, { signal })).items;
}

export function confirmSale(input: Omit<ConfirmSaleInput, "idempotencyKey">): Promise<ConfirmedSale> {
  const idempotencyKey = key();
  return request<ConfirmedSale>("/api/v1/sales/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ ...input, idempotencyKey })
  });
}

/** Resumen de ventas de la sucursal para el panel (montos en BOB como texto exacto). */
export interface SalesSummary {
  today: { totalBob: string; count: number };
  month: { totalBob: string; count: number; units: number; averageTicketBob: string };
  monthly: Array<{ month: string; totalBob: string; count: number }>;
  daily: Array<{ day: string; totalBob: string; count: number }>;
  recent: Array<{ id: string; createdAt: string; totalBob: string; items: number; cashierName: string | null }>;
}

export async function salesSummary(): Promise<SalesSummary> {
  return request<SalesSummary>("/api/v1/sales/summary");
}

export interface SalesBatchOption {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  /** Unreserved base units in the warehouse. */
  availableBase: number;
  /** The lot FEFO would consume first. */
  fefoSuggested: boolean;
}

/** Lots of a presentation in FEFO order; only for users with sales.fefo.override. */
export async function listSalesBatches(presentationId: string, warehouseId: string): Promise<SalesBatchOption[]> {
  const params = new URLSearchParams({ presentationId, warehouseId });
  return (await request<{ items: SalesBatchOption[] }>(`/api/v1/sales/lookup/batches?${params.toString()}`)).items;
}

export type SaleStatus = "CONFIRMED" | "VOIDED" | "PARTIALLY_RETURNED" | "RETURNED";

export const saleStatusLabels: Record<SaleStatus, string> = {
  CONFIRMED: "Confirmada",
  VOIDED: "Anulada",
  PARTIALLY_RETURNED: "Devolución parcial",
  RETURNED: "Devuelta"
};

export interface SaleListItem {
  id: string;
  number: string;
  createdAt: string;
  status: SaleStatus;
  cashierId: string;
  cashierName: string | null;
  cashShiftId: string;
  totalBob: string;
  paidAmountBob: string;
  changeAmountBob: string;
  paymentMethods: SalePaymentMethod[];
  /** Total refunded through returns. */
  refundedBob: string;
}

export interface SaleList {
  items: SaleListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SaleListFilters {
  from?: string;
  to?: string;
  cashShiftId?: string;
  cashierId?: string;
  status?: SaleStatus | "";
  limit?: number;
  offset?: number;
}

export interface SaleDetail {
  id: string;
  number: string;
  status: SaleStatus;
  createdAt: string;
  totalBob: string;
  paidAmountBob: string;
  changeAmountBob: string;
  cashier: { id: string; name: string | null };
  shift: { id: string; registerCode: string };
  branch: { id: string; code: string; name: string };
  pharmacy: { name: string; legalName: string; taxId: string };
  warehouse: { id: string; name: string };
  void: { at: string; byUserId: string; byName: string | null; reason: string } | null;
  returns: SaleReturn[];
  items: Array<{
    id: string;
    returnedQuantity: number;
    productName: string;
    presentationName: string;
    quantity: number;
    quantityBase: number;
    unitPriceBob: string;
    lineTotalBob: string;
    fefoOverride: boolean;
    fefoOverrideReason: string | null;
    allocations: Array<{ lotCode: string; expiresOn: string; quantityBase: number; fefoOverride: boolean }>;
  }>;
  payments: Array<{ method: SalePaymentMethod; amountBob: string; reference: string | null; reversed: boolean }>;
}

export interface SaleReturn {
  id: string;
  number: string;
  createdAt: string;
  reason: string;
  refundMethod: SalePaymentMethod;
  refundReference: string | null;
  refundAmountBob: string;
  restock: boolean;
  createdByName: string | null;
  items: Array<{ saleItemId: string; productName: string; presentationName: string; quantity: number; unitPriceBob: string; lineTotalBob: string }>;
}

export interface RegisterReturnInput {
  reason: string;
  refundMethod: SalePaymentMethod;
  refundReference?: string;
  restock: boolean;
  lines: Array<{ saleItemId: string; quantity: number }>;
}

export function voidSale(saleId: string, reason: string): Promise<{ id: string; status: "VOIDED" }> {
  const idempotencyKey = key();
  return request(`/api/v1/sales/${encodeURIComponent(saleId)}/void`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ idempotencyKey, reason })
  });
}

export function registerSaleReturn(saleId: string, input: RegisterReturnInput): Promise<{ returnNumber: string; refundAmountBob: string }> {
  const idempotencyKey = key();
  return request(`/api/v1/sales/${encodeURIComponent(saleId)}/returns`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ ...input, idempotencyKey })
  });
}

export function listSales(filters: SaleListFilters = {}): Promise<SaleList> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(name, String(value));
  }
  const query = params.toString();
  return request<SaleList>(`/api/v1/sales${query ? `?${query}` : ""}`);
}

export function getSale(saleId: string): Promise<SaleDetail> {
  return request<SaleDetail>(`/api/v1/sales/${encodeURIComponent(saleId)}`);
}

export type QuoteStatus = "OPEN" | "CONVERTED" | "CANCELED" | "EXPIRED";

export const quoteStatusLabels: Record<QuoteStatus, string> = {
  OPEN: "Vigente",
  CONVERTED: "Convertida en venta",
  CANCELED: "Anulada",
  EXPIRED: "Vencida"
};

export interface QuoteListItem {
  id: string;
  number: string;
  status: QuoteStatus;
  createdAt: string;
  validUntil: string;
  customerName: string | null;
  totalBob: string;
  createdByName: string | null;
  convertedSaleId: string | null;
}

export interface QuoteList {
  items: QuoteListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface QuoteListFilters {
  status?: QuoteStatus | "";
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface QuoteDetailItem {
  presentationId: string;
  productName: string;
  presentationName: string;
  quantity: number;
  quotedUnitPriceBob: string;
  lineTotalBob: string;
  /** Null when the presentation has no current price. */
  currentUnitPriceBob: string | null;
  currentLineTotalBob: string | null;
  priceChanged: boolean;
}

export interface QuoteDetail {
  id: string;
  number: string;
  status: QuoteStatus;
  createdAt: string;
  validUntil: string;
  customerName: string | null;
  customerNote: string | null;
  totalBob: string;
  currentTotalBob: string | null;
  pricesChanged: boolean;
  createdBy: { id: string; name: string | null };
  convertedSaleId: string | null;
  convertedSaleNumber: string | null;
  branch: { id: string; code: string; name: string };
  pharmacy: { name: string; legalName: string; taxId: string };
  items: QuoteDetailItem[];
}

export interface CreateQuoteInput {
  lines: Array<{ presentationId: string; quantity: number }>;
  customerName?: string;
  customerNote?: string;
  validDays?: number;
}

export function createQuote(input: CreateQuoteInput): Promise<QuoteDetail> {
  const idempotencyKey = key();
  return request<QuoteDetail>("/api/v1/sales/quotes", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ ...input, idempotencyKey })
  });
}

export function listQuotes(filters: QuoteListFilters = {}): Promise<QuoteList> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(name, String(value));
  }
  const query = params.toString();
  return request<QuoteList>(`/api/v1/sales/quotes${query ? `?${query}` : ""}`);
}

export function getQuote(quoteId: string): Promise<QuoteDetail> {
  return request<QuoteDetail>(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}`);
}

export function cancelQuote(quoteId: string): Promise<QuoteDetail> {
  const idempotencyKey = key();
  return request<QuoteDetail>(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ idempotencyKey })
  });
}
