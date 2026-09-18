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
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderList {
  items: PurchaseOrder[];
}

export interface PurchaseOrderInput {
  supplierId: string;
  warehouseId: string;
  lines: [{ presentationId: string; quantityBase: number; unitCost: string }];
}

async function parseError(response: Response): Promise<Error> {
  let message = "No pudimos completar la operación de compras.";
  try {
    const body = (await response.json()) as { message?: string; error?: { message?: string } };
    message = body.message ?? body.error?.message ?? message;
  } catch {
    // Keep a stable message when the API has no JSON error body.
  }
  if (response.status === 403) {
    message = "Tu sesión no tiene permiso para administrar compras.";
  }
  if (response.status === 409) {
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
