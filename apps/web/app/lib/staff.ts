import { authenticatedFetch } from "./session";

export type ShiftKind = "REGULAR" | "NIGHT_DUTY";
export type ShiftStatus = "SCHEDULED" | "CANCELED";
export type RuleScope = "DEFAULT" | "CATEGORY" | "PRODUCT";
export type RateSource = "PRODUCT" | "CATEGORY" | "DEFAULT" | "TIER" | "NONE";

export interface StaffShift {
  id: string;
  userId: string;
  userName: string;
  kind: ShiftKind;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  status: ShiftStatus;
  cancelReason: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface StaffMember {
  userId: string;
  displayName: string;
}

export interface CreateShiftInput {
  userId: string;
  kind: ShiftKind;
  startsAt: string;
  endsAt: string;
  notes?: string | null;
}

export interface CommissionRule {
  id: string;
  scope: RuleScope;
  targetId: string | null;
  targetName: string | null;
  ratePercent: string;
  isActive: boolean;
  createdAt: string;
}

export interface CommissionTier {
  id: string;
  minNetSalesBob: string;
  ratePercent: string;
  createdAt: string;
}

export interface CommissionLine {
  saleId: string;
  saleNumber: string;
  saleDate: string;
  saleItemId: string;
  productId: string;
  productName: string;
  presentationName: string;
  quantity: number;
  lineTotalBob: string;
  returnedBob: string;
  netBob: string;
  ratePercent: string;
  rateSource: RateSource;
  commissionBob: string;
}

export interface SellerCommission {
  userId: string;
  userName: string;
  netSalesBob: string;
  tierRatePercent: string | null;
  commissionBob: string;
  lines: CommissionLine[];
}

export interface CommissionReport {
  from: string;
  to: string;
  multilevelApplied: boolean;
  sellers: SellerCommission[];
  totalCommissionBob: string;
}

export interface SellerProductivity {
  userId: string;
  userName: string;
  salesCount: number;
  netSalesBob: string;
  units: number;
  averageTicketBob: string;
  returnsCount: number;
  returnsBob: string;
  voidsCount: number;
  hoursWorked: number | null;
  salesPerHourBob: string | null;
}

export interface ProductivityReport {
  from: string;
  to: string;
  hoursAvailable: boolean;
  sellers: SellerProductivity[];
}

export const shiftKindLabels: Record<ShiftKind, string> = {
  REGULAR: "Turno normal",
  NIGHT_DUTY: "Guardia nocturna"
};

export const rateSourceLabels: Record<RateSource, string> = {
  PRODUCT: "Regla de producto",
  CATEGORY: "Regla de categoría",
  DEFAULT: "Regla general",
  TIER: "Nivel por ventas",
  NONE: "Sin regla"
};

export const ruleScopeLabels: Record<RuleScope, string> = {
  DEFAULT: "General",
  CATEGORY: "Categoría",
  PRODUCT: "Producto"
};

/** API error with its stable code (for example PLAN_FEATURE_RESTRICTED or CHECK_IN_OUT_OF_WINDOW). */
export class StaffApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly field?: string) {
    super(message);
  }
}

export function isPlanRestricted(reason: unknown): boolean {
  return reason instanceof StaffApiError && reason.code === "PLAN_FEATURE_RESTRICTED";
}

export function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

async function parseError(response: Response): Promise<StaffApiError> {
  let message = "No pudimos completar la operación de personal.";
  let body: { message?: string; code?: string; field?: string } = {};
  try {
    body = (await response.json()) as typeof body;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Non-JSON body: keep the generic message.
  }
  return new StaffApiError(message, response.status, body.code, body.field);
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await authenticatedFetch(
    path,
    method === "GET"
      ? undefined
      : {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body)
        }
  );
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) search.set(name, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

const base = "/api/v1/staff";

// ---- Dates (La Paz is UTC-4 all year, no daylight saving) ----

export const STAFF_ZONE = "America/La_Paz";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthStartIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
}

function parts(day: string): [number, number, number] {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return [year, month, date];
}

/** Calendar-day arithmetic on YYYY-MM-DD strings, independent of the browser time zone. */
export function addDays(day: string, amount: number): string {
  const [year, month, date] = parts(day);
  const moved = new Date(Date.UTC(year, month - 1, date + amount));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** Monday of the week containing the given day. */
export function weekStart(day: string): string {
  const [year, month, date] = parts(day);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** La Paz calendar day (YYYY-MM-DD) of an instant. */
export function bolivianDay(value: string): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: STAFF_ZONE });
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("es-BO", { timeZone: STAFF_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatShiftDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { timeZone: STAFF_ZONE, dateStyle: "short", timeStyle: "short" });
}

export function formatDayLabel(day: string): string {
  const [year, month, date] = parts(day);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("es-BO", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Converts a datetime-local value (YYYY-MM-DDTHH:mm, Bolivia time) to an ISO instant with the -04:00 offset. */
export function boliviaInputToIso(value: string): string {
  return `${value}:00-04:00`;
}

// ---- Shifts ----

export const listStaffMembers = () => request<StaffMember[]>(`${base}/members`);
export const listShifts = (params: { from?: string; to?: string; userId?: string }) => request<StaffShift[]>(`${base}/shifts${query(params)}`);
export const listMyShifts = (params: { from?: string; to?: string } = {}) => request<StaffShift[]>(`${base}/shifts/me${query(params)}`);
export const createShift = (input: CreateShiftInput) => request<StaffShift>(`${base}/shifts`, "POST", input);
export const cancelShift = (shiftId: string, reason: string) => request<StaffShift>(`${base}/shifts/${encodeURIComponent(shiftId)}/cancel`, "POST", { reason });
export const checkInShift = (shiftId: string) => request<StaffShift>(`${base}/shifts/${encodeURIComponent(shiftId)}/check-in`, "POST", {});
export const checkOutShift = (shiftId: string) => request<StaffShift>(`${base}/shifts/${encodeURIComponent(shiftId)}/check-out`, "POST", {});

// ---- Commissions ----

export const listCommissionRules = () => request<CommissionRule[]>(`${base}/commissions/rules`);
export const createCommissionRule = (input: { scope: RuleScope; targetId?: string | null; ratePercent: number; isActive?: boolean }) =>
  request<CommissionRule>(`${base}/commissions/rules`, "POST", input);
export const updateCommissionRule = (ruleId: string, input: { ratePercent?: number; isActive?: boolean }) =>
  request<CommissionRule>(`${base}/commissions/rules/${encodeURIComponent(ruleId)}`, "PATCH", input);
export const deleteCommissionRule = (ruleId: string) => request<void>(`${base}/commissions/rules/${encodeURIComponent(ruleId)}`, "DELETE");

export const listCommissionTiers = () => request<CommissionTier[]>(`${base}/commissions/tiers`);
export const createCommissionTier = (input: { minNetSalesBob: number; ratePercent: number }) => request<CommissionTier>(`${base}/commissions/tiers`, "POST", input);
export const updateCommissionTier = (tierId: string, input: { minNetSalesBob?: number; ratePercent?: number }) =>
  request<CommissionTier>(`${base}/commissions/tiers/${encodeURIComponent(tierId)}`, "PATCH", input);
export const deleteCommissionTier = (tierId: string) => request<void>(`${base}/commissions/tiers/${encodeURIComponent(tierId)}`, "DELETE");

export const getCommissionReport = (from: string, to: string) => request<CommissionReport>(`${base}/commissions/report${query({ from, to })}`);
export const getMyCommissions = (from: string, to: string) => request<CommissionReport>(`${base}/commissions/me${query({ from, to })}`);

// ---- Productivity ----

export const getProductivity = (from: string, to: string) => request<ProductivityReport>(`${base}/productivity${query({ from, to })}`);

export function formatBob(value: string | number): string {
  return `Bs ${Number(value).toFixed(2)}`;
}

export { planAllows } from "./plan";
