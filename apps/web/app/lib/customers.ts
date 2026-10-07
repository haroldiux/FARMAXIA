import { authenticatedFetch } from "./session";

// ---- Customers (crm.customers) ----

export type DocType = "CI" | "NIT" | "PASSPORT" | "OTHER";

export const docTypeLabels: Record<DocType, string> = {
  CI: "CI",
  NIT: "NIT",
  PASSPORT: "Pasaporte",
  OTHER: "Otro"
};

export interface Customer {
  id: string;
  fullName: string;
  docType: DocType | null;
  docNumber: string | null;
  complement: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  /** Points balance; null when the plan has no crm.loyalty. */
  loyaltyBalance: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  fullName?: string;
  docType?: DocType | null;
  docNumber?: string | null;
  complement?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CustomerPurchase {
  id: string;
  number: string;
  createdAt: string;
  status: string;
  totalBob: string;
  refundedBob: string;
  netBob: string;
}

export interface PurchaseHistory extends Paged<CustomerPurchase> {
  customerId: string;
  summary: { salesCount: number; netTotalBob: string };
}

// ---- Loyalty (crm.loyalty) ----

export interface LoyaltySettings {
  enabled: boolean;
  bobPerPoint: string;
  pointValueBob: string;
}

export type LoyaltyKind = "EARN" | "REDEEM" | "REVERSAL" | "ADJUST";

export const loyaltyKindLabels: Record<LoyaltyKind, string> = {
  EARN: "Puntos ganados",
  REDEEM: "Canje",
  REVERSAL: "Reversión",
  ADJUST: "Ajuste manual"
};

export interface LoyaltyMovement {
  id: string;
  kind: LoyaltyKind;
  points: number;
  reason: string;
  saleId: string | null;
  saleNumber: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CustomerLoyalty {
  customerId: string;
  balance: number;
  settings: LoyaltySettings;
  movements: Paged<LoyaltyMovement>;
}

// ---- Agreements (crm.agreements) ----

export type AgreementKind = "INSURER" | "COMPANY" | "UNION";

export const agreementKindLabels: Record<AgreementKind, string> = {
  INSURER: "Aseguradora",
  COMPANY: "Empresa",
  UNION: "Sindicato"
};

export interface Agreement {
  id: string;
  name: string;
  kind: AgreementKind;
  payerName: string;
  payerTaxId: string | null;
  coveragePercent: string;
  monthlyLimitBob: string;
  notes: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgreementInput {
  name?: string;
  kind?: AgreementKind;
  payerName?: string;
  payerTaxId?: string | null;
  coveragePercent?: string;
  monthlyLimitBob?: string;
  notes?: string | null;
  isActive?: boolean;
}

export interface AgreementMember {
  id: string;
  agreementId: string;
  customerId: string;
  customerName: string;
  docType: string | null;
  docNumber: string | null;
  memberCode: string;
  monthlyLimitBob: string | null;
  effectiveLimitBob: string;
  usedBob: string;
  remainingBob: string;
  isActive: boolean;
  createdAt: string;
}

export interface AgreementMemberInput {
  customerId?: string;
  memberCode?: string;
  /** null clears the override (the agreement default applies). */
  monthlyLimitBob?: string | null;
  isActive?: boolean;
}

/** One active enrolment of a customer, as the POS needs it. */
export interface CustomerAgreement {
  agreementId: string;
  name: string;
  kind: AgreementKind;
  coveragePercent: string;
  memberId: string;
  memberCode: string;
  monthlyLimitBob: string;
  usedBob: string;
  remainingBob: string;
}

// ---- Statements (crm.agreements + agreements.billing) ----

export type StatementStatus = "ISSUED" | "PARTIAL" | "PAID";

export const statementStatusLabels: Record<StatementStatus, string> = {
  ISSUED: "Emitido",
  PARTIAL: "Pago parcial",
  PAID: "Pagado"
};

export type StatementPaymentMethod = "TRANSFER" | "CHECK" | "CASH" | "QR" | "OTHER";

export const statementPaymentMethodLabels: Record<StatementPaymentMethod, string> = {
  TRANSFER: "Transferencia",
  CHECK: "Cheque",
  CASH: "Efectivo",
  QR: "QR",
  OTHER: "Otro"
};

export interface StatementLine {
  chargeId: string;
  branchCode: string;
  saleNumber: string;
  saleDate: string;
  customerName: string;
  memberCode: string;
  amountBob: string;
}

export interface StatementPreview {
  agreementId: string;
  agreementName: string;
  period: string;
  lineCount: number;
  totalBob: string;
  lines: StatementLine[];
}

export interface StatementPayment {
  id: string;
  amountBob: string;
  method: StatementPaymentMethod;
  reference: string | null;
  paidOn: string;
  createdByName: string | null;
  createdAt: string;
}

export interface StatementSummary {
  id: string;
  agreementId: string;
  agreementName: string;
  period: string;
  number: string;
  totalBob: string;
  paidBob: string;
  balanceBob: string;
  status: StatementStatus;
  lineCount: number;
  issuedAt: string;
  issuedByName: string | null;
}

export interface StatementDetail extends StatementSummary {
  payerName: string;
  payerTaxId: string | null;
  coveragePercent: string;
  lines: StatementLine[];
  payments: StatementPayment[];
}

export interface StatementPaymentInput {
  amountBob: string;
  method: StatementPaymentMethod;
  paidOn: string;
  reference?: string;
}

export interface StatementPaymentResult {
  paymentId: string;
  statementId: string;
  amountBob: string;
  paidBob: string;
  balanceBob: string;
  status: StatementStatus;
}

// ---- Errors and transport ----

/** API error with its stable code (for example PLAN_FEATURE_RESTRICTED, INSUFFICIENT_POINTS or AGREEMENT_CHARGE_BILLED). */
export class CrmApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly field?: string) {
    super(message);
  }
}

export function isPlanRestricted(reason: unknown): boolean {
  return reason instanceof CrmApiError && reason.code === "PLAN_FEATURE_RESTRICTED";
}

export function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

async function parseError(response: Response): Promise<CrmApiError> {
  let message = "No pudimos completar la operación de clientes.";
  let body: { message?: string | string[]; code?: string; field?: string } = {};
  try {
    body = (await response.json()) as typeof body;
    if (typeof body.message === "string") message = body.message;
    else if (Array.isArray(body.message) && body.message.length) message = body.message.join(" ");
  } catch {
    // Non-JSON body: keep the generic message.
  }
  return new CrmApiError(message, response.status, body.code, body.field);
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await authenticatedFetch(
    path,
    method === "GET"
      ? undefined
      : { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }
  );
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(name, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

const enc = encodeURIComponent;

// ---- Customers ----

export const listCustomers = (params: { q?: string; active?: "true" | "false"; limit?: number; offset?: number } = {}, signal?: AbortSignal) =>
  authenticatedFetch(`/api/v1/customers${query(params)}`, { signal }).then(async (response) => {
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as Paged<Customer>;
  });
export const getCustomer = (customerId: string) => request<Customer>(`/api/v1/customers/${enc(customerId)}`);
export const createCustomer = (input: CustomerInput) => request<Customer>("/api/v1/customers", "POST", input);
export const updateCustomer = (customerId: string, input: CustomerInput) => request<Customer>(`/api/v1/customers/${enc(customerId)}`, "PATCH", input);
export const customerPurchases = (customerId: string, params: { limit?: number; offset?: number } = {}) =>
  request<PurchaseHistory>(`/api/v1/customers/${enc(customerId)}/purchases${query(params)}`);

// ---- Loyalty ----

export const getLoyaltySettings = () => request<LoyaltySettings>("/api/v1/loyalty/settings");
export const updateLoyaltySettings = (input: { enabled?: boolean; bobPerPoint?: string; pointValueBob?: string }) =>
  request<LoyaltySettings>("/api/v1/loyalty/settings", "PUT", input);
export const customerLoyalty = (customerId: string, params: { limit?: number; offset?: number } = {}) =>
  request<CustomerLoyalty>(`/api/v1/customers/${enc(customerId)}/loyalty${query(params)}`);
export const adjustLoyalty = (customerId: string, input: { points: number; reason: string }) =>
  request<LoyaltyMovement & { balance: number }>(`/api/v1/customers/${enc(customerId)}/loyalty/adjustments`, "POST", input);

// ---- Agreements ----

export const listAgreements = (params: { q?: string; active?: "true" | "false"; limit?: number; offset?: number } = {}) =>
  request<Paged<Agreement>>(`/api/v1/agreements${query(params)}`);
export const createAgreement = (input: AgreementInput) => request<Agreement>("/api/v1/agreements", "POST", input);
export const updateAgreement = (agreementId: string, input: AgreementInput) => request<Agreement>(`/api/v1/agreements/${enc(agreementId)}`, "PATCH", input);
export const listAgreementMembers = (agreementId: string) => request<{ items: AgreementMember[] }>(`/api/v1/agreements/${enc(agreementId)}/members`);
export const addAgreementMember = (agreementId: string, input: AgreementMemberInput) =>
  request<AgreementMember>(`/api/v1/agreements/${enc(agreementId)}/members`, "POST", input);
export const updateAgreementMember = (agreementId: string, memberId: string, input: AgreementMemberInput) =>
  request<AgreementMember>(`/api/v1/agreements/${enc(agreementId)}/members/${enc(memberId)}`, "PATCH", input);
export const customerAgreements = (customerId: string) => request<{ items: CustomerAgreement[] }>(`/api/v1/customers/${enc(customerId)}/agreements`);

// ---- Statements ----

export const previewStatement = (agreementId: string, period: string) =>
  request<StatementPreview>(`/api/v1/agreement-statements/preview${query({ agreementId, period })}`);
export const issueStatement = (agreementId: string, period: string) => request<StatementDetail>("/api/v1/agreement-statements", "POST", { agreementId, period });
export const listStatements = (params: { agreementId?: string; period?: string; status?: StatementStatus | ""; limit?: number; offset?: number } = {}) =>
  request<Paged<StatementSummary>>(`/api/v1/agreement-statements${query(params)}`);
export const getStatement = (statementId: string) => request<StatementDetail>(`/api/v1/agreement-statements/${enc(statementId)}`);

function paymentKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `stmt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** A fresh idempotency key per attempt: pass the same key to retry a payment whose answer was lost. */
export function newStatementPaymentKey(): string {
  return paymentKey();
}

export const registerStatementPayment = (statementId: string, input: StatementPaymentInput, idempotencyKey: string = paymentKey()) =>
  request<StatementPaymentResult>(`/api/v1/agreement-statements/${enc(statementId)}/payments`, "POST", { ...input, idempotencyKey });

/** The export needs the bearer token, so it is fetched and saved as a blob. */
export async function downloadStatementCsv(statementId: string, filename: string): Promise<void> {
  const response = await authenticatedFetch(`/api/v1/agreement-statements/${enc(statementId)}/export`);
  if (!response.ok) throw await parseError(response);
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

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

export function formatDay(value: string): string {
  return new Date(value).toLocaleDateString("es-BO", { timeZone: "America/La_Paz" });
}

export function formatPlainDay(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric" });
}

export function docLabel(docType: string | null, docNumber: string | null): string {
  if (!docNumber) return "Sin documento";
  const label = docType && docType in docTypeLabels ? docTypeLabels[docType as DocType] : docType;
  return `${label ? `${label} ` : ""}${docNumber}`;
}

/** Whether the plan snapshot shows the feature enabled; an unknown snapshot does not hide anything (the API still enforces it). */
export function planAllows(features: Array<{ code: string; enabled: boolean }> | undefined, code: string): boolean {
  if (!features) return true;
  return features.some((feature) => feature.code === code && feature.enabled);
}

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
