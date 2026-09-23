import { authenticatedFetch } from "./session";

export interface SaleLineInput {
  presentationId: string;
  quantity: number;
  unitPriceBob: string;
}

export interface ConfirmSaleInput {
  idempotencyKey: string;
  cashShiftId: string;
  warehouseId: string;
  paymentMethod: "CASH";
  paidAmountBob: string;
  lines: SaleLineInput[];
}

export interface SaleAllocation {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
}

export interface ConfirmedSaleItem {
  presentationId: string;
  quantity: number;
  quantityBase: number;
  unitPriceBob: string;
  lineTotalBob: string;
  allocations: SaleAllocation[];
}

export interface ConfirmedSale {
  id: string;
  cashShiftId: string;
  warehouseId: string;
  status: "CONFIRMED";
  paymentMethod: "CASH";
  totalBob: string;
  paidAmountBob: string;
  items: ConfirmedSaleItem[];
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

export interface SalesPresentation {
  presentationId: string;
  name: string;
  baseUnitFactor: number;
  isSellable: boolean;
}

export interface SalesProduct {
  productId: string;
  name: string;
  presentations: SalesPresentation[];
}

function key(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    let message = "No pudimos completar la venta.";
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep the stable fallback for non-JSON responses.
    }
    throw new Error(message);
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

export async function listSalesProducts(): Promise<SalesProduct[]> {
  return (await request<{ items: SalesProduct[] }>("/api/v1/catalog/products?limit=100&offset=0")).items;
}

export function confirmCashSale(input: Omit<ConfirmSaleInput, "idempotencyKey" | "paymentMethod">): Promise<ConfirmedSale> {
  const idempotencyKey = key();
  return request<ConfirmedSale>("/api/v1/sales/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ ...input, idempotencyKey, paymentMethod: "CASH" })
  });
}
