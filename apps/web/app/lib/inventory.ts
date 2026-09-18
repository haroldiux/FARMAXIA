import { authenticatedFetch } from "./session";

export interface Warehouse {
  id: string;
  name: string;
  isDispatchEnabled: boolean;
}

export interface WarehouseList {
  items: Warehouse[];
}

export type ExpiryAlertStatus = "EXPIRED" | "DUE_SOON";
export type BatchStatus = "AVAILABLE" | "QUARANTINED" | "DISPOSED";

export interface ExpiryAlert {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  status: ExpiryAlertStatus;
  batchStatus: BatchStatus;
  quantityBase: number;
  reservedBase: number;
  availableQuantity: number;
}

export type QuarantineReasonCode = "QUALITY" | "COLD_CHAIN" | "DAMAGE" | "OTHER";

export interface QuarantineInput {
  warehouseId: string;
  reasonCode: QuarantineReasonCode;
  reason: string;
  temperatureCelsius?: number;
}

export interface ReleaseQuarantineInput {
  warehouseId: string;
  reason: string;
}

export interface WasteInput {
  warehouseId: string;
  quantityBase: number;
  reason: string;
}

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `inventory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseError(response: Response): Promise<Error> {
  let message = "No pudimos completar la operación de inventario.";
  try {
    const body = (await response.json()) as { message?: string; error?: { message?: string } };
    message = body.message ?? body.error?.message ?? message;
  } catch {
    // Keep the stable fallback when the API has no JSON error body.
  }
  if (response.status === 403) {
    message = "Tu sesión no tiene permiso para administrar inventario.";
  }
  if (response.status === 409) {
    message = "El inventario cambió mientras trabajabas. Actualiza la vista e inténtalo nuevamente.";
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

export async function listWarehouses(): Promise<WarehouseList> {
  return request<WarehouseList>("/api/v1/inventory/warehouses");
}

export async function listExpiryAlerts(
  warehouseId: string,
  horizonDays: number
): Promise<ExpiryAlert[]> {
  const params = new URLSearchParams({ warehouseId, horizonDays: String(horizonDays) });
  return request<ExpiryAlert[]>(`/api/v1/inventory/expiry-alerts?${params.toString()}`);
}

export async function quarantineBatch(batchId: string, input: QuarantineInput): Promise<void> {
  const key = idempotencyKey();
  await request(`/api/v1/inventory/batches/${batchId}/quarantine`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, idempotencyKey: key })
  });
}

export async function releaseQuarantine(batchId: string, input: ReleaseQuarantineInput): Promise<void> {
  const key = idempotencyKey();
  await request(`/api/v1/inventory/batches/${batchId}/release-quarantine`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, idempotencyKey: key })
  });
}

export async function recordWaste(batchId: string, input: WasteInput): Promise<void> {
  const key = idempotencyKey();
  await request("/api/v1/inventory/waste", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, batchId, idempotencyKey: key })
  });
}
