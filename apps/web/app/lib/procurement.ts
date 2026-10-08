import { authenticatedFetch } from "./session";

export interface Supplier {
  id: string;
  name: string;
  taxId: string | null;
  isActive: boolean;
}

export interface SupplierList {
  items: Supplier[];
}

export interface Presentation {
  presentationId: string;
  presentationName: string;
  productName: string;
  baseUnitFactor: number;
  isSellable: boolean;
}

export interface PresentationList {
  items: Presentation[];
}

export interface PurchaseOrderLine {
  presentationId: string;
  presentationName: string;
  productName: string;
  quantityBase: number;
  receivedBase: number;
  unitCost: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  status: string;
  orderedAt: string;
  closeReason: string | null;
  closedAt: string | null;
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderList {
  items: PurchaseOrder[];
}

export interface PurchaseOrderInput {
  supplierId: string;
  warehouseId: string;
  lines: Array<{ presentationId: string; quantityBase: number; unitCost: string }>;
}

export interface ReceiptLineInput {
  presentationId: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
  unitCost: string;
}

export interface ReceiveInput {
  idempotencyKey: string;
  supplierId: string;
  purchaseOrderId: string;
  warehouseId: string;
  receivedAt: string;
  lines: ReceiptLineInput[];
}

export interface ReceiveResult {
  receiptId: string;
  lineCount: number;
}

export interface GoodsReceipt {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  receivedAt: string;
  lineCount: number;
}

export interface GoodsReceiptList {
  items: GoodsReceipt[];
}

export interface SupplierInvoice {
  invoiceId: string;
  supplierId: string;
  supplierName: string;
  goodsReceiptId: string | null;
  invoiceNumber: string;
  issuedOn: string;
  currency: string;
  totalAmount: string;
  dueOn: string;
  originalAmount: string;
  outstandingAmount: string;
  status: "OPEN" | "PAID" | "OVERDUE";
}

export interface SupplierInvoiceList {
  items: SupplierInvoice[];
}

export interface SupplierInvoiceInput {
  idempotencyKey: string;
  supplierId: string;
  goodsReceiptId: string;
  invoiceNumber: string;
  issuedOn: string;
  currency: string;
  totalAmount: string;
  dueOn: string;
}

export function procurementIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `procurement-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseError(response: Response): Promise<Error> {
  let message = "No pudimos completar la operación de compras.";
  let serverMessage: string | undefined;
  try {
    const body = (await response.json()) as { message?: string; error?: { message?: string } };
    serverMessage = typeof body.message === "string" ? body.message : body.error?.message;
    message = serverMessage ?? message;
  } catch {
    // Keep a stable message when the API has no JSON error body.
  }
  if (response.status === 403) {
    message = "Tu sesión no tiene permiso para esta operación de compras.";
  }
  // Un 409 con explicación del servidor (p. ej. "El pago supera el saldo") se muestra tal cual.
  if (response.status === 409 && (!serverMessage || serverMessage === "Conflict")) {
    message = "La compra cambió mientras trabajabas. Actualiza la vista e inténtalo nuevamente.";
  }
  return new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as T;
}

export function listSuppliers(): Promise<SupplierList> {
  return request<SupplierList>("/api/v1/procurement/suppliers");
}

export function listPresentations(): Promise<PresentationList> {
  return request<PresentationList>("/api/v1/procurement/presentations");
}

export function listPurchaseOrders(): Promise<PurchaseOrderList> {
  return request<PurchaseOrderList>("/api/v1/procurement/purchase-orders");
}

export function listGoodsReceipts(): Promise<GoodsReceiptList> {
  return request<GoodsReceiptList>("/api/v1/procurement/receipts");
}

export function listSupplierInvoices(): Promise<SupplierInvoiceList> {
  return request<SupplierInvoiceList>("/api/v1/procurement/invoices");
}

export function createSupplierInvoice(input: SupplierInvoiceInput): Promise<{ invoiceId: string; payableId: string }> {
  return request<{ invoiceId: string; payableId: string }>("/api/v1/procurement/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input)
  });
}

export function createSupplier(input: { name: string; taxId?: string }): Promise<{ id: string }> {
  return request<{ id: string }>("/api/v1/procurement/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function createPurchaseOrder(input: PurchaseOrderInput): Promise<{ id: string }> {
  return request<{ id: string }>("/api/v1/procurement/purchase-orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function receivePurchaseOrder(input: ReceiveInput): Promise<ReceiveResult> {
  return request<ReceiveResult>("/api/v1/procurement/receipts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey
    },
    body: JSON.stringify(input)
  });
}

// ---- Módulo 4: cancelación, costos, reposición y pagos a proveedores ----

export interface PresentationCost {
  presentationId: string;
  productName: string;
  presentationName: string;
  averageUnitCost: string;
  lastUnitCost: string;
  updatedAt: string;
}

export interface ReorderSuggestion {
  presentationId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  soldBase: number;
  averageDailyBase: number;
  availableBase: number;
  incomingBase: number;
  daysOfStock: number | null;
  suggestedBase: number;
  averageUnitCost: string | null;
  estimatedCost: string | null;
  lastSupplierId: string | null;
  lastSupplierName: string | null;
}

export type PayableStatus = "OPEN" | "PARTIAL" | "PAID" | "OVERDUE";
export type ScheduleBucket = "overdue" | "thisWeek" | "next30" | "later" | "paid";
export type PaymentMethod = "CASH" | "TRANSFER" | "CHECK" | "QR" | "OTHER";

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CHECK: "Cheque",
  QR: "QR",
  OTHER: "Otro"
};

export interface Payable {
  payableId: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  issuedOn: string;
  dueOn: string;
  scheduledOn: string | null;
  originalAmount: string;
  outstandingAmount: string;
  paidAmount: string;
  status: PayableStatus;
  bucket: ScheduleBucket;
  daysToDue: number;
  paymentCount: number;
}

export interface PayableList {
  items: Payable[];
  totals: Array<{ bucket: Exclude<ScheduleBucket, "paid">; currency: string; outstanding: string; count: number }>;
}

export interface SupplierPayment {
  id: string;
  paidOn: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

export function cancelPurchaseOrder(orderId: string, reason: string): Promise<{ id: string; status: "CANCELED" | "CLOSED" }> {
  return request(`/api/v1/procurement/purchase-orders/${orderId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function listCosts(): Promise<{ items: PresentationCost[] }> {
  return request("/api/v1/procurement/costs");
}

export function reorderSuggestions(coverageDays: number): Promise<{ coverageDays: number; salesWindowDays: number; items: ReorderSuggestion[] }> {
  return request(`/api/v1/procurement/reorder-suggestions?coverageDays=${coverageDays}`);
}

export function listPayables(): Promise<PayableList> {
  return request("/api/v1/procurement/payables");
}

export function listSupplierPayments(payableId: string): Promise<{ items: SupplierPayment[] }> {
  return request(`/api/v1/procurement/payables/${payableId}/payments`);
}

export function registerSupplierPayment(
  payableId: string,
  input: { amount: string; paidOn: string; method: PaymentMethod; reference?: string; notes?: string }
): Promise<{ paymentId: string; outstandingAmount: string; status: "OPEN" | "PARTIAL" | "PAID" }> {
  const idempotencyKey = procurementIdempotencyKey();
  return request(`/api/v1/procurement/payables/${payableId}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ ...input, idempotencyKey })
  });
}

export function schedulePayable(payableId: string, scheduledOn: string | null): Promise<{ payableId: string; scheduledOn: string | null }> {
  return request(`/api/v1/procurement/payables/${payableId}/schedule`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduledOn })
  });
}
