import { authenticatedFetch } from "./session";

/** Prescription data collected at the POS when the cart holds a controlled medicine. */
export interface PrescriptionDraft {
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  /** YYYY-MM-DD. */
  prescribedAt: string;
  notes: string;
}

export const prescriptionFieldLabels: Record<Exclude<keyof PrescriptionDraft, "notes">, string> = {
  doctorName: "Médico",
  doctorLicense: "Matrícula",
  patientName: "Paciente",
  patientDocument: "CI / documento",
  issuingCenter: "Centro de salud emisor",
  prescribedAt: "Fecha de la receta"
};

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function emptyPrescription(now: Date = new Date()): PrescriptionDraft {
  return { doctorName: "", doctorLicense: "", patientName: "", patientDocument: "", issuingCenter: "", prescribedAt: todayIso(now), notes: "" };
}

/** Returns the first required field that is empty, or null when the draft is complete. */
export function firstMissingPrescriptionField(draft: PrescriptionDraft): keyof typeof prescriptionFieldLabels | null {
  for (const field of Object.keys(prescriptionFieldLabels) as Array<keyof typeof prescriptionFieldLabels>) {
    if (!draft[field].trim()) return field;
  }
  return null;
}

/** Body sent as `prescription` in the sale confirmation (notes omitted when empty). */
export function prescriptionPayload(draft: PrescriptionDraft): Record<string, string> {
  const notes = draft.notes.trim();
  return {
    doctorName: draft.doctorName.trim(),
    doctorLicense: draft.doctorLicense.trim(),
    patientName: draft.patientName.trim(),
    patientDocument: draft.patientDocument.trim(),
    issuingCenter: draft.issuingCenter.trim(),
    prescribedAt: draft.prescribedAt,
    ...(notes ? { notes } : {})
  };
}

export const movementTypeLabels: Record<string, string> = {
  RECEIPT: "Compra",
  SALE: "Venta",
  SALE_VOID: "Anulación de venta",
  SALE_RETURN: "Devolución",
  TRANSFER_IN: "Traspaso recibido",
  TRANSFER_OUT: "Traspaso enviado",
  WASTE: "Baja",
  ADJUSTMENT: "Ajuste de inventario",
  RESERVATION_CONSUME: "Consumo de reserva"
};

export function movementTypeLabel(type: string): string {
  return movementTypeLabels[type] ?? type;
}

export interface PrescriptionItem {
  productName: string;
  presentationName: string;
  quantity: number;
  quantityBase: number;
  isControlled: boolean;
  lots: Array<{ lotCode: string; quantityBase: number }>;
}

export interface Prescription {
  id: string;
  folio: string;
  saleId: string;
  saleNumber: string;
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  prescribedAt: string;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  items: PrescriptionItem[];
}

export interface PrescriptionList {
  items: Prescription[];
  total: number;
  limit: number;
  offset: number;
}

export interface PrescriptionFilters {
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface BalanceFlow {
  total: number;
  byType: Record<string, number>;
}

export interface BalanceItem {
  productId: string;
  productName: string;
  presentations: Array<{ id: string; name: string; baseUnitFactor: number }>;
  openingBase: number;
  entries: BalanceFlow;
  exits: BalanceFlow;
  closingBase: number;
  currentStockBase: number;
}

export interface ControlledBalance {
  month: string;
  items: BalanceItem[];
}

export interface BookLine {
  folio: number | string;
  occurredAt: string;
  date: string;
  productId: string;
  productName: string;
  presentationName: string | null;
  lotCode: string | null;
  warehouseName: string | null;
  movementType: string;
  quantityIn: number;
  quantityOut: number;
  balanceBase: number;
  document: { type: string; number: string | null } | null;
  prescription: null | { folio: string; doctorName: string; doctorLicense: string; patientName: string; patientDocument: string };
}

export interface ControlledBook {
  month: string;
  openings: Array<{ productId: string; productName: string; openingBase: number }>;
  lines: BookLine[];
}

/** API error with its stable code (for example PLAN_FEATURE_RESTRICTED). */
export class ControlledApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly field?: string) {
    super(message);
  }
}

export function isPlanRestricted(reason: unknown): boolean {
  return reason instanceof ControlledApiError && reason.code === "PLAN_FEATURE_RESTRICTED";
}

async function parseError(response: Response): Promise<ControlledApiError> {
  let message = "No pudimos completar la operación de medicamentos controlados.";
  let body: { message?: string; code?: string; field?: string } = {};
  try {
    body = (await response.json()) as typeof body;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Non-JSON body: keep the generic message.
  }
  if (response.status === 403 && body.code !== "PLAN_FEATURE_RESTRICTED") {
    message = "Tu sesión no tiene permiso para consultar medicamentos controlados.";
  }
  return new ControlledApiError(message, response.status, body.code, body.field);
}

async function request<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path);
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function listPrescriptions(filters: PrescriptionFilters = {}): Promise<PrescriptionList> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(name, String(value));
  }
  const query = params.toString();
  return request<PrescriptionList>(`/api/v1/controlled/prescriptions${query ? `?${query}` : ""}`);
}

export function getPrescription(prescriptionId: string): Promise<Prescription> {
  return request<Prescription>(`/api/v1/controlled/prescriptions/${encodeURIComponent(prescriptionId)}`);
}

export function getControlledBalance(month: string): Promise<ControlledBalance> {
  return request<ControlledBalance>(`/api/v1/controlled/balance?month=${encodeURIComponent(month)}`);
}

export function getControlledBook(month: string): Promise<ControlledBook> {
  return request<ControlledBook>(`/api/v1/controlled/book?month=${encodeURIComponent(month)}`);
}

/** The export needs the bearer token, so it is fetched and saved as a blob. */
export async function downloadControlledBookCsv(month: string): Promise<void> {
  const response = await authenticatedFetch(`/api/v1/controlled/book/export?month=${encodeURIComponent(month)}`);
  if (!response.ok) throw await parseError(response);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `libro-controlados-${month}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
