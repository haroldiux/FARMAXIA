import { apiUrl, authenticatedFetch } from "./session";

// ---- Shapes (API: api/v1/integrations). Dates arrive as ISO strings. ----

export interface ApiKey {
  id: string;
  name: string;
  /** Display prefix of the key (the full key is only returned on creation). */
  prefix: string;
  branchId: string;
  createdByUserId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKey extends ApiKey {
  /** Plaintext key, returned only once. */
  key: string;
}

export interface WebhookEventType {
  type: string;
  label: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  isActive: boolean;
  /** Masked secret, for example `whsec_…a1b2`. */
  secretHint: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /** Plaintext signing secret, returned only on creation and rotation. */
  secret: string;
}

export type DeliveryStatus = "PENDING" | "SUCCEEDED" | "FAILED";

export interface WebhookDelivery {
  id: string;
  outboxEventId: string;
  eventType: string;
  status: DeliveryStatus | string;
  attempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface WebhookInput {
  url?: string;
  description?: string;
  eventTypes?: string[];
  isActive?: boolean;
}

// ---- HTTP ----

/** API error with its stable code (for example PLAN_FEATURE_RESTRICTED). */
export class IntegrationsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly field?: string) {
    super(message);
  }
}

export function isPlanRestricted(reason: unknown): boolean {
  return reason instanceof IntegrationsApiError && reason.code === "PLAN_FEATURE_RESTRICTED";
}

export function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

async function parseError(response: Response): Promise<IntegrationsApiError> {
  let message = "No pudimos completar la operación de integraciones.";
  let body: { message?: string | string[]; code?: string; field?: string } = {};
  try {
    body = (await response.json()) as typeof body;
    if (typeof body.message === "string") message = body.message;
    else if (Array.isArray(body.message) && body.message.length) message = body.message.join(" ");
  } catch {
    // Non-JSON body: keep the generic message.
  }
  return new IntegrationsApiError(message, response.status, body.code, body.field);
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await authenticatedFetch(
    path,
    method === "GET"
      ? undefined
      : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }
  );
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) search.set(name, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

const base = "/api/v1/integrations";
const id = (value: string) => encodeURIComponent(value);

export const listApiKeys = () => request<{ items: ApiKey[] }>(`${base}/api-keys`).then((page) => page.items);
export const createApiKey = (name: string) => request<CreatedApiKey>(`${base}/api-keys`, "POST", { name });
export const revokeApiKey = (keyId: string) => request<ApiKey>(`${base}/api-keys/${id(keyId)}/revoke`, "POST");

export const listWebhookEventTypes = () => request<{ items: WebhookEventType[] }>(`${base}/webhooks/event-types`).then((page) => page.items);
export const listWebhooks = () => request<{ items: WebhookEndpoint[] }>(`${base}/webhooks`).then((page) => page.items);
export const createWebhook = (input: WebhookInput) => request<WebhookEndpointWithSecret>(`${base}/webhooks`, "POST", input);
export const updateWebhook = (endpointId: string, input: WebhookInput) => request<WebhookEndpoint>(`${base}/webhooks/${id(endpointId)}`, "PATCH", input);
export const rotateWebhookSecret = (endpointId: string) => request<WebhookEndpointWithSecret>(`${base}/webhooks/${id(endpointId)}/rotate-secret`, "POST");
export const listWebhookDeliveries = (endpointId: string, params: { status?: string; limit?: number; offset?: number } = {}) =>
  request<{ items: WebhookDelivery[]; limit: number; offset: number }>(
    `${base}/webhooks/${id(endpointId)}/deliveries${query({ status: params.status, limit: params.limit?.toString(), offset: params.offset?.toString() })}`
  );

/** Base URL of the public read-only API, shown in the usage panel. */
export const publicApiBaseUrl = `${apiUrl}/api/public/v1`;

export const deliveryStatusLabels: Record<DeliveryStatus, string> = { PENDING: "Pendiente", SUCCEEDED: "Entregado", FAILED: "Fallido" };
