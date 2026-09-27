import { apiUrl, authenticatedFetch, storeAccessToken } from "./session";

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";

export interface PublicPlan {
  code: string;
  name: string;
  description: string;
  priceMonthlyBob: string;
  auditRetentionDays: number | null;
  quotas: Record<string, number | null>;
  features: string[];
}

export interface SubscriptionSummary {
  status: SubscriptionStatus;
  hasAccess: boolean;
  plan: { code: string; name: string; priceMonthlyBob: string; auditRetentionDays: number | null };
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  currentPeriodEnd: string | null;
  usage: Array<{ resource: string; used: number; limit: number | null }>;
  features: Array<{ code: string; name: string; module: string; enabled: boolean; addOn: boolean }>;
  openInvoices: number;
}

export interface InvoicePayment {
  id: string;
  method: string;
  reference: string;
  amountBob: string;
  paidOn: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewNote: string | null;
  hasAttachment: boolean;
}

export interface TenantInvoice {
  id: string;
  number: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  amountBob: string;
  status: "OPEN" | "PAID" | "VOID";
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  payments: InvoicePayment[];
}

export interface InvoiceDocument extends TenantInvoice {
  customer: { pharmacyName: string; legalName: string | null; taxId: string | null };
}

export interface RegisterInput {
  pharmacyName: string;
  legalName: string;
  taxId: string;
  branchName: string;
  ownerName: string;
  email: string;
  password: string;
  planCode: string;
}

export interface RegisterResult {
  tenantId: string;
  tenantSlug: string;
  branchId: string;
  trialEndsAt: string;
}

export interface SubmitPaymentInput {
  method: "QR" | "TRANSFER";
  reference: string;
  amountBob: string;
  paidOn: string;
  attachment?: { mediaType: string; base64: string };
}

export interface AuditLogPage {
  retentionDays: number | null;
  visibleSince: string | null;
  total: number;
  limit: number;
  offset: number;
  items: Array<{
    id: string;
    occurredAt: string;
    action: string;
    entityType: string;
    entityId: string;
    actorName: string | null;
    payload: Record<string, unknown>;
  }>;
}

export const resourceLabels: Record<string, string> = {
  branches: "Sucursales",
  cash_registers: "Cajas",
  users: "Usuarios"
};

export const statusLabels: Record<SubscriptionStatus, string> = {
  TRIALING: "En prueba",
  ACTIVE: "Activa",
  PAST_DUE: "Pago vencido",
  SUSPENDED: "Suspendida",
  CANCELED: "Cancelada"
};

/** Mensaje del API (`message`) o uno por defecto. */
export async function apiError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) {
      return new Error(body.message);
    }
  } catch {
    // Respuesta sin JSON: se usa el mensaje por defecto.
  }
  return new Error(fallback);
}

export async function listPublicPlans(): Promise<PublicPlan[]> {
  const response = await fetch(`${apiUrl}/api/v1/onboarding/plans`, { cache: "no-store" });
  if (!response.ok) {
    throw await apiError(response, "No pudimos cargar los planes.");
  }
  return (await response.json()) as PublicPlan[];
}

export async function registerPharmacy(input: RegisterInput): Promise<RegisterResult> {
  const response = await fetch(`${apiUrl}/api/v1/onboarding/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw await apiError(response, "No pudimos registrar la farmacia.");
  }
  const result = (await response.json()) as RegisterResult & { accessToken: string };
  storeAccessToken(result.accessToken);
  return result;
}

export async function subscriptionSummary(): Promise<SubscriptionSummary> {
  const response = await authenticatedFetch("/api/v1/subscription");
  if (!response.ok) {
    throw await apiError(response, "No pudimos cargar la suscripción.");
  }
  return (await response.json()) as SubscriptionSummary;
}

export async function listInvoices(): Promise<TenantInvoice[]> {
  const response = await authenticatedFetch("/api/v1/billing/invoices");
  if (!response.ok) {
    throw await apiError(response, response.status === 403 ? "Tu usuario no puede ver los cobros." : "No pudimos cargar los comprobantes.");
  }
  return (await response.json()) as TenantInvoice[];
}

export async function invoiceDocument(invoiceId: string): Promise<InvoiceDocument> {
  const response = await authenticatedFetch(`/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}`);
  if (!response.ok) {
    throw await apiError(response, "No pudimos cargar el comprobante.");
  }
  return (await response.json()) as InvoiceDocument;
}

export async function submitPayment(invoiceId: string, input: SubmitPaymentInput): Promise<void> {
  const response = await authenticatedFetch(`/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw await apiError(response, "No pudimos registrar el pago.");
  }
}

export async function listAuditEvents(query: { action?: string; from?: string; to?: string; offset: number; limit: number }): Promise<AuditLogPage> {
  const params = new URLSearchParams({ offset: String(query.offset), limit: String(query.limit) });
  if (query.action) params.set("action", query.action);
  if (query.from) params.set("from", new Date(`${query.from}T00:00:00`).toISOString());
  if (query.to) params.set("to", new Date(`${query.to}T23:59:59`).toISOString());
  const response = await authenticatedFetch(`/api/v1/audit/events?${params.toString()}`);
  if (!response.ok) {
    throw await apiError(response, "No pudimos cargar la bitácora.");
  }
  return (await response.json()) as AuditLogPage;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("No pudimos leer el archivo."));
    reader.readAsDataURL(file);
  });
}

export function formatDate(value: string | null, withTime = false): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-BO", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

export function formatBob(value: string): string {
  return `Bs ${Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function daysUntil(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - now) / (24 * 60 * 60 * 1000));
}
