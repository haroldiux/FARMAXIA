import { authenticatedFetch } from "./session";

export interface Warehouse {
  id: string;
  name: string;
  isDispatchEnabled: boolean;
  warehouseType?: string;
}

export interface WarehouseList {
  items: Warehouse[];
}

export interface TenantStockReportItem {
  branchId: string;
  branchCode: string;
  branchName: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  presentationId: string;
  presentationName: string;
  physical: string;
  reserved: string;
  available: string;
}

export interface TenantStockReportSubtotal {
  branchId: string;
  branchCode: string;
  branchName: string;
  physical: string;
  reserved: string;
  available: string;
}

export interface TenantStockReport {
  items: TenantStockReportItem[];
  branchSubtotals: TenantStockReportSubtotal[];
  tenantTotal: { physical: string; reserved: string; available: string };
  total: number;
  limit: number;
  offset: number;
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
  disposalMethod?: "DESTRUCTION" | "SUPPLIER_RETURN" | "OTHER";
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

export async function listTenantStockReport(input: {
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<TenantStockReport> {
  const params = new URLSearchParams();
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.offset !== undefined) params.set("offset", String(input.offset));
  const query = params.toString();
  return request<TenantStockReport>(`/api/v1/inventory/reports/tenant-stock${query ? `?${query}` : ""}`);
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

export async function recordWaste(batchId: string, input: WasteInput): Promise<{ wasteEventId: string; actNumber: string }> {
  const key = idempotencyKey();
  return request("/api/v1/inventory/waste", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, batchId, idempotencyKey: key })
  });
}

// ---- Módulo 3: almacenes, conteos, actas de baja, reservas y alertas ----

export type WarehouseType = "GENERAL" | "CENTRAL" | "QUARANTINE" | "COLD";
export type DisposalMethod = "DESTRUCTION" | "SUPPLIER_RETURN" | "OTHER";

export const warehouseTypeLabels: Record<WarehouseType, string> = {
  GENERAL: "General",
  CENTRAL: "Central",
  QUARANTINE: "Cuarentena",
  COLD: "Cadena de frío"
};

export const disposalMethodLabels: Record<DisposalMethod, string> = {
  DESTRUCTION: "Destrucción",
  SUPPLIER_RETURN: "Devolución al proveedor",
  OTHER: "Otro"
};

export interface WarehouseDetail {
  id: string;
  name: string;
  warehouseType: WarehouseType;
  isDispatchEnabled: boolean;
  isActive: boolean;
  batchCount: number;
  stockBase: number;
  reservedBase: number;
  createdAt: string;
}

export type CountStatus = "OPEN" | "SUBMITTED" | "APPROVED" | "CANCELED";

export interface CountSummary {
  id: string;
  number: string;
  status: CountStatus;
  warehouseId: string;
  warehouseName: string;
  notes: string | null;
  lineCount: number;
  countedLines: number;
  differenceLines: number | null;
  createdByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
}

export interface CountLine {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  productName: string;
  presentationName: string;
  countedQuantity: number | null;
  expectedQuantity: number | null;
  difference: number | null;
  countedAt: string | null;
}

export interface CountDetail extends CountSummary {
  lines: CountLine[];
}

export interface WasteAct {
  id: string;
  actNumber: string | null;
  createdAt: string;
  warehouseName: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
  reason: string;
  disposalMethod: DisposalMethod | null;
  createdByName: string | null;
}

export interface WasteActDocument extends WasteAct {
  tenantName: string;
  legalName: string;
  taxId: string;
  branchCode: string;
  branchName: string;
  unitCost: string;
  totalCost: string;
}

export type ReservationStatus = "ACTIVE" | "CONSUMED" | "RELEASED" | "EXPIRED";

export interface ReservationSummary {
  id: string;
  status: ReservationStatus;
  warehouseName: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
  reservedUntil: string;
  createdAt: string;
}

export interface InventoryAlert {
  id: string;
  alertType: "EXPIRING" | "EXPIRED";
  warehouseId: string;
  warehouseName: string;
  batchId: string;
  lotCode: string;
  productName: string;
  presentationName: string;
  expiresOn: string;
  daysToExpiry: number;
  quantityBase: number;
  createdAt: string;
  acknowledgedAt: string | null;
}

// Los mensajes de error del módulo 3 vienen en español desde la API; se muestran tal cual.
async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    let message = "No pudimos completar la operación de inventario.";
    try {
      const data = (await response.json()) as { message?: string | string[] };
      if (typeof data.message === "string") message = data.message;
    } catch {
      // Sin cuerpo JSON: se mantiene el mensaje general.
    }
    if (response.status === 403) message = "Tu sesión no tiene permiso para esta acción.";
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function listWarehouseDetails(includeInactive = true): Promise<{ items: WarehouseDetail[] }> {
  return send(`/api/v1/inventory/warehouses/details?includeInactive=${includeInactive}`, "GET");
}

export function createWarehouse(input: { name: string; warehouseType: WarehouseType; isDispatchEnabled: boolean }): Promise<WarehouseDetail> {
  return send("/api/v1/inventory/warehouses", "POST", input);
}

export function updateWarehouse(
  id: string,
  input: Partial<{ name: string; warehouseType: WarehouseType; isDispatchEnabled: boolean; isActive: boolean }>
): Promise<WarehouseDetail> {
  return send(`/api/v1/inventory/warehouses/${id}`, "PATCH", input);
}

export function listCounts(): Promise<{ items: CountSummary[] }> {
  return send("/api/v1/inventory/counts", "GET");
}

export function createCount(input: { warehouseId: string; notes?: string }): Promise<CountDetail> {
  return send("/api/v1/inventory/counts", "POST", input);
}

export function getCount(id: string): Promise<CountDetail> {
  return send(`/api/v1/inventory/counts/${id}`, "GET");
}

export function recordCountLines(id: string, lines: Array<{ batchId: string; countedQuantity: number | null }>): Promise<CountDetail> {
  return send(`/api/v1/inventory/counts/${id}/lines`, "PUT", { lines });
}

export function countAction(id: string, action: "submit" | "approve" | "cancel"): Promise<CountDetail> {
  return send(`/api/v1/inventory/counts/${id}/${action}`, "POST");
}

export function listWasteActs(): Promise<{ items: WasteAct[] }> {
  return send("/api/v1/inventory/waste-acts", "GET");
}

export function getWasteAct(id: string): Promise<WasteActDocument> {
  return send(`/api/v1/inventory/waste-acts/${id}`, "GET");
}

export function listReservations(status?: ReservationStatus): Promise<{ items: ReservationSummary[] }> {
  return send(`/api/v1/inventory/reservations${status ? `?status=${status}` : ""}`, "GET");
}

export function listInventoryAlerts(includeAcknowledged = true): Promise<{ items: InventoryAlert[]; unacknowledged: number }> {
  return send(`/api/v1/inventory/alerts?includeAcknowledged=${includeAcknowledged}`, "GET");
}

export function acknowledgeAlert(id: string): Promise<{ id: string; acknowledgedAt: string }> {
  return send(`/api/v1/inventory/alerts/${id}/acknowledge`, "POST");
}

export const countStatusLabels: Record<CountStatus, string> = {
  OPEN: "Contando",
  SUBMITTED: "En revisión",
  APPROVED: "Aprobado",
  CANCELED: "Anulado"
};

export async function releaseReservation(id: string): Promise<void> {
  const key = idempotencyKey();
  await request(`/api/v1/inventory/reservations/${id}/release`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ idempotencyKey: key })
  });
}
