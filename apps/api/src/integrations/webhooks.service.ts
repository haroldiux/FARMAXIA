import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";

/** D80: webhook events are the existing outbox event types; `*` subscribes to all of them. */
export const WEBHOOK_EVENT_TYPES = [
  { type: "sales.cash_sale_confirmed", label: "Venta al contado confirmada" },
  { type: "sales.sale_voided", label: "Venta anulada" },
  { type: "sales.sale_returned", label: "Devolución de venta" },
  { type: "sales.quote_created", label: "Cotización creada" },
  { type: "sales.quote_converted", label: "Cotización convertida en venta" },
  { type: "sales.quote_canceled", label: "Cotización cancelada" },
  { type: "cash.movement_registered", label: "Movimiento de caja registrado" },
  { type: "transfers.requested", label: "Transferencia solicitada" },
  { type: "transfers.approved", label: "Transferencia aprobada" },
  { type: "transfers.rejected", label: "Transferencia rechazada" },
  { type: "transfers.dispatched", label: "Transferencia despachada" },
  { type: "transfers.received", label: "Transferencia recibida" },
  { type: "transfers.partially_received", label: "Transferencia recibida parcialmente" }
] as const;
export const WEBHOOK_WILDCARD = "*";
const allowedEventTypes = new Set<string>([WEBHOOK_WILDCARD, ...WEBHOOK_EVENT_TYPES.map((item) => item.type)]);

export const WEBHOOK_SECRET_PREFIX = "whsec_";
const URL_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = 200;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DELIVERY_STATUSES = new Set(["PENDING", "SUCCEEDED", "FAILED"]);
const DELIVERIES_DEFAULT_LIMIT = 50;
const DELIVERIES_MAX_LIMIT = 200;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Management view of an endpoint. Never carries the secret, only a masked hint. */
export interface WebhookEndpointSummary {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  isActive: boolean;
  secretHint: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Returned only by create and rotate-secret: `secret` is shown once. */
export interface WebhookEndpointWithSecret extends WebhookEndpointSummary {
  secret: string;
}

export interface WebhookDeliverySummary {
  id: string;
  outboxEventId: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface WebhookEndpointInput {
  url?: unknown;
  description?: unknown;
  eventTypes?: unknown;
  isActive?: unknown;
}

const summaryColumns = `id, url, description, event_types as "eventTypes", is_active as "isActive",
  '${WEBHOOK_SECRET_PREFIX}…' || right(secret, 4) as "secretHint", created_by_user_id as "createdByUserId",
  created_at as "createdAt", updated_at as "updatedAt"`;

const deliveryColumns = `id, outbox_event_id as "outboxEventId", event_type as "eventType", status, attempts,
  next_attempt_at as "nextAttemptAt", last_attempt_at as "lastAttemptAt", last_status_code as "lastStatusCode",
  last_error as "lastError", delivered_at as "deliveredAt", created_at as "createdAt"`;

function invalid(code: string, message: string, field: string): BadRequestException {
  return new BadRequestException({ code, message, field });
}

/** D79: HTTPS only; plain http is accepted for local development receivers (localhost / 127.0.0.1). */
function parseUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const error = invalid(
    "INVALID_WEBHOOK_URL",
    `La URL debe ser https (http solo para localhost) y tener como máximo ${URL_MAX_LENGTH} caracteres.`,
    "url"
  );
  if (raw.length < 1 || raw.length > URL_MAX_LENGTH) throw error;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw error;
  }
  const secure = parsed.protocol === "https:" || (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname));
  if (!secure || parsed.username || parsed.password) throw error;
  return raw;
}

function parseDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length > DESCRIPTION_MAX_LENGTH) {
    throw invalid("INVALID_WEBHOOK_DESCRIPTION", `La descripción debe tener como máximo ${DESCRIPTION_MAX_LENGTH} caracteres.`, "description");
  }
  return value.trim() || null;
}

function parseEventTypes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !allowedEventTypes.has(item))) {
    throw invalid("INVALID_WEBHOOK_EVENT_TYPES", "Indique al menos un tipo de evento del catálogo.", "eventTypes");
  }
  return [...new Set(value as string[])];
}

function requireEndpointId(value: string): string {
  if (!uuidPattern.test(value)) {
    throw invalid("INVALID_WEBHOOK_ID", "El webhook no es válido.", "id");
  }
  return value;
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: "WEBHOOK_NOT_FOUND", message: "Webhook no encontrado." });
}

/**
 * F19 (D79/D80): tenant-wide webhook endpoints. The secret signs the payloads (HMAC-SHA256), so it is stored
 * to sign and returned only on creation and rotation; lists show a masked hint.
 */
@Injectable()
export class WebhooksService {
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  eventTypes(): { items: Array<{ type: string; label: string }> } {
    return { items: [{ type: WEBHOOK_WILDCARD, label: "Todos los eventos" }, ...WEBHOOK_EVENT_TYPES] };
  }

  list(scope: TenantScope): Promise<{ items: WebhookEndpointSummary[] }> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<WebhookEndpointSummary>(
        `select ${summaryColumns} from webhook_endpoints where tenant_id = $1 order by created_at desc, id desc`,
        [scope.tenantId]
      );
      return { items: result.rows };
    });
  }

  create(scope: TenantScope, input: WebhookEndpointInput): Promise<WebhookEndpointWithSecret> {
    const url = parseUrl(input?.url);
    const description = parseDescription(input?.description);
    const eventTypes = parseEventTypes(input?.eventTypes);
    const secret = generateWebhookSecret();
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<WebhookEndpointSummary>(
        `insert into webhook_endpoints (tenant_id, url, description, secret, event_types, created_by_user_id)
         values ($1, $2, $3, $4, $5, $6)
         returning ${summaryColumns}`,
        [scope.tenantId, url, description, secret, eventTypes, scope.userId]
      );
      const created = result.rows[0]!;
      await this.audit.recordInTransaction(client, scope, {
        action: "integrations.webhook.created",
        entityType: "webhook_endpoint",
        entityId: created.id,
        payload: { url, eventTypes }
      });
      return { ...created, secret };
    });
  }

  update(scope: TenantScope, endpointId: string, input: WebhookEndpointInput): Promise<WebhookEndpointSummary> {
    requireEndpointId(endpointId);
    const changes: Record<string, unknown> = {};
    if (input?.url !== undefined) changes.url = parseUrl(input.url);
    if (input?.description !== undefined) changes.description = parseDescription(input.description);
    if (input?.eventTypes !== undefined) changes.event_types = parseEventTypes(input.eventTypes);
    if (input?.isActive !== undefined) {
      if (typeof input.isActive !== "boolean") {
        throw invalid("INVALID_WEBHOOK_STATUS", "El estado del webhook no es válido.", "isActive");
      }
      changes.is_active = input.isActive;
    }
    return this.database.withScope(scope, async (client) => {
      const columns = Object.keys(changes);
      if (columns.length === 0) {
        return this.load(client, scope, endpointId);
      }
      const assignments = columns.map((column, index) => `${column} = $${index + 3}`).join(", ");
      const result = await client.query<WebhookEndpointSummary>(
        `update webhook_endpoints set ${assignments}, updated_at = now()
         where tenant_id = $1 and id = $2
         returning ${summaryColumns}`,
        [scope.tenantId, endpointId, ...Object.values(changes)]
      );
      if (!result.rows[0]) throw notFound();
      await this.audit.recordInTransaction(client, scope, {
        action: "integrations.webhook.updated",
        entityType: "webhook_endpoint",
        entityId: endpointId,
        payload: changes
      });
      return result.rows[0];
    });
  }

  rotateSecret(scope: TenantScope, endpointId: string): Promise<WebhookEndpointWithSecret> {
    requireEndpointId(endpointId);
    const secret = generateWebhookSecret();
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<WebhookEndpointSummary>(
        `update webhook_endpoints set secret = $3, updated_at = now()
         where tenant_id = $1 and id = $2
         returning ${summaryColumns}`,
        [scope.tenantId, endpointId, secret]
      );
      if (!result.rows[0]) throw notFound();
      await this.audit.recordInTransaction(client, scope, {
        action: "integrations.webhook.secret_rotated",
        entityType: "webhook_endpoint",
        entityId: endpointId,
        payload: {}
      });
      return { ...result.rows[0], secret };
    });
  }

  listDeliveries(
    scope: TenantScope,
    endpointId: string,
    query: { status?: string; limit?: string; offset?: string }
  ): Promise<{ items: WebhookDeliverySummary[]; limit: number; offset: number }> {
    requireEndpointId(endpointId);
    const status = query.status ? query.status.toUpperCase() : null;
    if (status !== null && !DELIVERY_STATUSES.has(status)) {
      throw invalid("INVALID_DELIVERY_STATUS", "El estado de entrega no es válido.", "status");
    }
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "", 10) || DELIVERIES_DEFAULT_LIMIT, 1), DELIVERIES_MAX_LIMIT);
    const offset = Math.max(Number.parseInt(query.offset ?? "", 10) || 0, 0);
    return this.database.withScope(scope, async (client) => {
      await this.load(client, scope, endpointId);
      const result = await client.query<WebhookDeliverySummary>(
        `select ${deliveryColumns} from webhook_deliveries
         where tenant_id = $1 and endpoint_id = $2 and ($3::text is null or status = $3)
         order by created_at desc, id desc
         limit $4 offset $5`,
        [scope.tenantId, endpointId, status, limit, offset]
      );
      return { items: result.rows, limit, offset };
    });
  }

  private async load(client: PoolClient, scope: TenantScope, endpointId: string): Promise<WebhookEndpointSummary> {
    const result = await client.query<WebhookEndpointSummary>(`select ${summaryColumns} from webhook_endpoints where tenant_id = $1 and id = $2`, [
      scope.tenantId,
      endpointId
    ]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
}
