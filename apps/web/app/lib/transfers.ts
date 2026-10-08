import { authenticatedFetch } from "./session";

export type TransferStatus =
  | "REQUESTED"
  | "APPROVED"
  | "DISPATCHED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "REJECTED"
  | "CANCELLED";

export interface TransferItem {
  id: string;
  presentationId: string;
  batchId: string;
  requestedQty: number;
  dispatchedQty: number | null;
  receivedQty: number;
  differenceReason: string | null;
}

export interface Transfer {
  id: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  status: TransferStatus;
  requestedByUserId: string;
  dispatchedByUserId: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: TransferItem[];
}

export interface TransferList {
  items: Transfer[];
}

export interface TransferStockLookupItem {
  presentationId: string;
  productName: string;
  presentationName: string;
  batchId: string;
  lotCode: string | null;
  availableQty: number;
}

export interface TransferStockLookupResult {
  items: TransferStockLookupItem[];
}

export interface TransferWarehouseOption {
  id: string;
  name: string;
  branchId: string;
  branchName: string | null;
  warehouseType: string;
}

export interface TransferWarehouseListResult {
  items: TransferWarehouseOption[];
}

export interface RequestTransferItemInput {
  presentationId: string;
  batchId: string;
  requestedQty: number;
}

export interface RequestTransferInput {
  originWarehouseId: string;
  destinationWarehouseId: string;
  items: RequestTransferItemInput[];
}

export interface ReceiveTransferItemInput {
  itemId: string;
  receivedQty: number;
  differenceReason?: string;
}

export function transfersIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `transfers-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseError(response: Response): Promise<Error> {
  let message = "No pudimos completar la operación de traspasos.";
  let serverMessage: string | undefined;
  try {
    const body = (await response.json()) as { message?: string; error?: { message?: string } };
    serverMessage = typeof body.message === "string" ? body.message : body.error?.message;
    message = serverMessage ?? message;
  } catch {
    // Sin cuerpo JSON: queda el mensaje genérico.
  }
  if (response.status === 403) {
    message = "Tu sesión no tiene permiso para esta operación de traspasos.";
  }
  if (response.status === 409 && (!serverMessage || serverMessage === "Conflict")) {
    message = "El traspaso cambió mientras trabajabas. Actualiza la vista e inténtalo nuevamente.";
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

export function listTransfers(): Promise<TransferList> {
  return request<TransferList>("/api/v1/transfers");
}

export function getTransfer(transferId: string): Promise<Transfer> {
  return request<Transfer>(`/api/v1/transfers/${transferId}`);
}

export function lookupStock(warehouseId: string): Promise<TransferStockLookupResult> {
  return request<TransferStockLookupResult>(`/api/v1/transfers/lookup/stock?warehouseId=${encodeURIComponent(warehouseId)}`);
}

export function lookupWarehouses(): Promise<TransferWarehouseListResult> {
  return request<TransferWarehouseListResult>("/api/v1/transfers/lookup/warehouses");
}

export function requestTransfer(input: RequestTransferInput): Promise<Transfer> {
  const idempotencyKey = transfersIdempotencyKey();
  return request<Transfer>("/api/v1/transfers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, idempotencyKey })
  });
}

export function approveTransfer(transferId: string): Promise<Transfer> {
  const idempotencyKey = transfersIdempotencyKey();
  return request<Transfer>(`/api/v1/transfers/${transferId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey })
  });
}

export function rejectTransfer(transferId: string, reason: string): Promise<Transfer> {
  const idempotencyKey = transfersIdempotencyKey();
  return request<Transfer>(`/api/v1/transfers/${transferId}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey, reason })
  });
}

export function dispatchTransfer(transferId: string): Promise<Transfer> {
  const idempotencyKey = transfersIdempotencyKey();
  return request<Transfer>(`/api/v1/transfers/${transferId}/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey })
  });
}

export function receiveTransfer(transferId: string, items: ReceiveTransferItemInput[]): Promise<Transfer> {
  const idempotencyKey = transfersIdempotencyKey();
  return request<Transfer>(`/api/v1/transfers/${transferId}/receive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey, items })
  });
}
