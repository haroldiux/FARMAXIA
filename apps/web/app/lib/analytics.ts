import { authenticatedFetch } from "./session";

// ---- Report shapes (API: api/v1/analytics). Quantities are BASE units unless noted. ----

export type AbcClass = "A" | "B" | "C";

export interface AbcItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  /** Net units in the presentation's own unit. */
  units: number;
  revenueBob: string;
  sharePercent: string;
  cumulativePercent: string;
  class: AbcClass;
}

export interface AbcReport {
  from: string;
  to: string;
  branchId: string | null;
  totalRevenueBob: string;
  summary: Record<AbcClass, number>;
  items: AbcItem[];
}

export interface RotationItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  soldBase: number;
  avgDailyBase: string | number;
  availableBase: number;
  daysOfInventory: string | number | null;
  cogsBob: string;
  stockValueBob: string | null;
  turnover: string | number | null;
  flags?: string[];
}

export interface RotationReport {
  from: string;
  to: string;
  days: number;
  branchId: string | null;
  items: RotationItem[];
}

export type ProfitabilityGroup = "product" | "laboratory" | "branch";

export interface ProfitabilityRow {
  key: string;
  name: string;
  units: number;
  revenueBob: string;
  costBob: string;
  marginBob: string | null;
  marginPercent: string | null;
  estimatedShare: string;
  uncostedRevenueBob: string;
}

export interface ProfitabilityReport {
  from: string;
  to: string;
  groupBy: ProfitabilityGroup;
  branchId: string | null;
  totals: Omit<ProfitabilityRow, "key" | "name">;
  rows: ProfitabilityRow[];
}

export type StockoutKind = "OUT_OF_STOCK" | "LOW_COVERAGE";

export interface StockoutItem {
  branchId: string;
  branchName: string;
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  kind: StockoutKind;
  availableBase: number;
  avgDailyBase: string | number;
  daysOfInventory: string | number | null;
  suggestedBase: number;
}

export interface StockoutsReport {
  branchId: string | null;
  velocityDays: number;
  lowCoverageDays: number;
  items: StockoutItem[];
}

export interface StockAlert {
  id: string;
  branchId: string;
  branchName: string;
  presentationId: string;
  productName: string;
  presentationName: string;
  kind: StockoutKind;
  daysOfStock: string | number | null;
  availableBase: number;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface StockAlertList {
  items: StockAlert[];
  unacknowledged: number;
}

export interface DashboardReport {
  from: string;
  to: string;
  branchId: string | null;
  netSalesBob: string;
  tickets: number;
  averageTicketBob: string;
  units: number;
  topProducts: Array<{ productId: string; productName: string; units: number; revenueBob: string; sharePercent: string }>;
  outOfStockCount: number;
  nearExpiry: { days: number; units: number; valueBob: string; uncostedUnits: number };
  marginAvailable: boolean;
  marginBob: string | null;
  marginPercent: string | null;
}

export interface WeekUnits {
  weekStart: string;
  units: number;
}

export interface ForecastItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  revenueBob: string;
  history: WeekUnits[];
  forecast: WeekUnits[];
  movingAverage: number;
  trendPerWeek: number;
  projectedDemandBase: number;
  availableBase: number;
  daysUntilStockout: number | null;
  stockoutDate: string | null;
}

export interface ForecastReport {
  branchId: string | null;
  horizonDays: number;
  historyFrom: string;
  historyTo: string;
  weekStarts: string[];
  items: ForecastItem[];
}

// ---- HTTP ----

/** API error with its stable code (for example PLAN_FEATURE_RESTRICTED). */
export class AnalyticsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly field?: string) {
    super(message);
  }
}

export function isPlanRestricted(reason: unknown): boolean {
  return reason instanceof AnalyticsApiError && reason.code === "PLAN_FEATURE_RESTRICTED";
}

export function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

async function parseError(response: Response): Promise<AnalyticsApiError> {
  let message = "No pudimos completar la operación de analítica.";
  let body: { message?: string; code?: string; field?: string } = {};
  try {
    body = (await response.json()) as typeof body;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Non-JSON body: keep the generic message.
  }
  return new AnalyticsApiError(message, response.status, body.code, body.field);
}

async function request<T>(path: string, method = "GET"): Promise<T> {
  const response = await authenticatedFetch(path, method === "GET" ? undefined : { method, headers: { "content-type": "application/json" }, body: "{}" });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) search.set(name, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

const base = "/api/v1/analytics";

export interface PeriodQuery {
  from: string;
  to: string;
  branchId?: string;
}

export const getDashboard = (params: PeriodQuery) => request<DashboardReport>(`${base}/dashboard${query({ ...params })}`);
export const getAbc = (params: PeriodQuery) => request<AbcReport>(`${base}/abc${query({ ...params })}`);
export const getRotation = (params: PeriodQuery) => request<RotationReport>(`${base}/rotation${query({ ...params })}`);
export const getProfitability = (params: PeriodQuery & { groupBy: ProfitabilityGroup }) => request<ProfitabilityReport>(`${base}/profitability${query({ ...params })}`);
export const getStockouts = (branchId?: string) => request<StockoutsReport>(`${base}/stockouts${query({ branchId })}`);
export const listStockAlerts = (status: "open" | "all", branchId?: string) => request<StockAlertList>(`${base}/stock-alerts${query({ status, branchId })}`);
export const acknowledgeStockAlert = (id: string) => request<{ id: string; acknowledgedAt: string }>(`${base}/stock-alerts/${encodeURIComponent(id)}/acknowledge`, "POST");
export const getForecast = (branchId?: string, horizonDays = 30) => request<ForecastReport>(`${base}/forecast${query({ branchId, horizonDays: String(horizonDays) })}`);

/** The export needs the bearer token, so it is fetched through the API and saved as a blob. */
export async function downloadProfitabilityCsv(params: PeriodQuery & { groupBy: ProfitabilityGroup }): Promise<void> {
  const response = await authenticatedFetch(`${base}/profitability${query({ ...params, format: "csv" })}`);
  if (!response.ok) throw await parseError(response);
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `rentabilidad-${params.groupBy}-${params.from}-${params.to}.csv`;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- Display helpers ----

export function money(value: string | number): string {
  return `Bs ${Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function percent(value: string | number | null): string {
  return value === null ? "—" : `${Number(value).toFixed(1)} %`;
}

/** Base-unit quantity; with a multi-unit presentation it also shows the equivalent in presentations. */
export function baseQty(base: number, factor: number): { main: string; sub: string | null } {
  const main = `${Number(base.toFixed(1)).toLocaleString("es-BO")} u.`;
  return { main, sub: factor > 1 ? `≈ ${Number((base / factor).toFixed(1)).toLocaleString("es-BO")} pres.` : null };
}

export function dayCount(value: string | number | null): string {
  return value === null ? "—" : Number(value).toFixed(1);
}

export const kindLabels: Record<StockoutKind, string> = { OUT_OF_STOCK: "Agotado", LOW_COVERAGE: "Poca cobertura" };

export const groupLabels: Record<ProfitabilityGroup, string> = { product: "Producto", laboratory: "Laboratorio", branch: "Sucursal" };

// ---- Dates (the API validates the real period) ----

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthStartIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
}

export function shortDay(value: string): string {
  const [, month, date] = value.slice(0, 10).split("-");
  return month && date ? `${date}/${month}` : value;
}
