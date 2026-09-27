import { apiError } from "./saas";
import { apiUrl } from "./session";

// Sesión de operador separada de la de farmacia: otra clave y otro token.
const platformTokenKey = "farmaxia.platform_token";

export interface PlatformOverview {
  tenantsByStatus: Record<string, number>;
  monthlyRecurringBob: string;
  pendingPayments: number;
  openInvoices: { count: number; amountBob: string };
  recentRegistrations: Array<{ tenantId: string; name: string; planName: string; createdAt: string }>;
}

export interface PlatformTenant {
  tenantId: string;
  name: string;
  slug: string;
  createdAt: string;
  planCode: string | null;
  planName: string | null;
  status: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  currentPeriodEnd: string | null;
  openInvoices: number;
  pendingPayments: number;
}

export interface PlatformTenantDetail extends PlatformTenant {
  legalName: string | null;
  taxId: string | null;
  owner: { displayName: string; email: string } | null;
  usage: Array<{ resource: string; used: number; limit: number | null }>;
  featureOverrides: Array<{ featureCode: string; isEnabled: boolean; name: string }>;
  invoices: Array<{ id: string; number: string; planName: string; periodStart: string; periodEnd: string; amountBob: string; status: string; issuedAt: string; paidAt: string | null }>;
  history: Array<{ action: string; payload: Record<string, unknown>; occurredAt: string; operatorName: string | null }>;
}

export interface PlatformPayment {
  id: string;
  method: string;
  reference: string;
  amountBob: string;
  paidOn: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  attachmentMediaType: string | null;
  invoiceId: string;
  invoiceNumber: string;
  invoiceAmountBob: string;
  invoiceStatus: string;
  tenantId: string;
  tenantName: string;
  submittedBy: string;
}

export interface PlatformPlan {
  code: string;
  name: string;
  description: string;
  priceMonthlyBob: string;
  auditRetentionDays: number | null;
  isPublic: boolean;
  isActive: boolean;
  allowsAllFeatures: boolean;
  subscriptions: number;
  quotas: Record<string, number | null>;
  features: string[];
}

export interface PlatformFeature {
  code: string;
  name: string;
  module: string;
}

function token(): string | null {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem(platformTokenKey);
}

export function hasPlatformSession(): boolean {
  return Boolean(token());
}

export function platformLogout(): void {
  window.sessionStorage.removeItem(platformTokenKey);
  window.location.assign("/platform/login");
}

export async function platformLogin(email: string, password: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/platform/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    throw new Error("Correo o contraseña incorrectos.");
  }
  const result = (await response.json()) as { accessToken: string };
  window.sessionStorage.setItem(platformTokenKey, result.accessToken);
}

async function platformFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const value = token();
  if (!value) {
    window.location.assign("/platform/login");
    throw new Error("PLATFORM_SESSION_REQUIRED");
  }
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${value}` },
    cache: "no-store"
  });
  if (response.status === 401) {
    platformLogout();
    throw new Error("PLATFORM_SESSION_EXPIRED");
  }
  return response;
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await platformFetch(path);
  if (!response.ok) {
    throw await apiError(response, fallback);
  }
  return (await response.json()) as T;
}

async function send(path: string, body: unknown, fallback: string, method = "POST"): Promise<void> {
  const response = await platformFetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw await apiError(response, fallback);
  }
}

export const platformMe = () => getJson<{ operatorId: string; email: string; displayName: string }>("/api/v1/platform/auth/me", "No pudimos validar tu sesión.");
export const platformOverview = () => getJson<PlatformOverview>("/api/v1/platform/overview", "No pudimos cargar el resumen.");
export const platformPlans = () => getJson<PlatformPlan[]>("/api/v1/platform/plans", "No pudimos cargar los planes.");
export const platformFeatures = () => getJson<PlatformFeature[]>("/api/v1/platform/features", "No pudimos cargar las funcionalidades.");

export function platformTenants(search = "", status = ""): Promise<PlatformTenant[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  return getJson(`/api/v1/platform/tenants?${params.toString()}`, "No pudimos cargar las farmacias.");
}

export const platformTenant = (tenantId: string) =>
  getJson<PlatformTenantDetail>(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`, "No pudimos cargar la farmacia.");

export const platformPayments = (status: string) =>
  getJson<PlatformPayment[]>(`/api/v1/platform/payments?status=${encodeURIComponent(status)}`, "No pudimos cargar los pagos.");

export const changeTenantPlan = (tenantId: string, planCode: string) =>
  send(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/plan`, { planCode }, "No pudimos cambiar el plan.");
export const setTenantStatus = (tenantId: string, action: "SUSPEND" | "REACTIVATE" | "CANCEL") =>
  send(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/status`, { action }, "No pudimos cambiar el estado.");
export const setTenantFeature = (tenantId: string, featureCode: string, enabled: boolean | null) =>
  send(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/features`, { featureCode, enabled }, "No pudimos actualizar la funcionalidad.");
export const approvePayment = (paymentId: string, note: string) =>
  send(`/api/v1/platform/payments/${encodeURIComponent(paymentId)}/approve`, { note }, "No pudimos aprobar el pago.");
export const rejectPayment = (paymentId: string, note: string) =>
  send(`/api/v1/platform/payments/${encodeURIComponent(paymentId)}/reject`, { note }, "No pudimos rechazar el pago.");
export const updatePlan = (code: string, input: { priceMonthlyBob?: string; isPublic?: boolean }) =>
  send(`/api/v1/platform/plans/${encodeURIComponent(code)}`, input, "No pudimos actualizar el plan.", "PATCH");

export async function runBillingCycle(): Promise<{ invoicesIssued: number; movedToPastDue: number; suspended: number }> {
  const response = await platformFetch("/api/v1/platform/billing/run-cycle", { method: "POST" });
  if (!response.ok) {
    throw await apiError(response, "No pudimos ejecutar el ciclo de cobro.");
  }
  return (await response.json()) as { invoicesIssued: number; movedToPastDue: number; suspended: number };
}

/** El adjunto requiere el token, así que se descarga y se abre como blob. */
export async function openPaymentAttachment(paymentId: string): Promise<void> {
  const response = await platformFetch(`/api/v1/platform/payments/${encodeURIComponent(paymentId)}/attachment`);
  if (!response.ok) {
    throw await apiError(response, "No pudimos abrir el comprobante.");
  }
  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
