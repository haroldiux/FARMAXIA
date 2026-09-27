import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";

export interface AuditLogQuery {
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: string | number;
  offset?: string | number;
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

/**
 * La bitácora es inmutable y nunca se borra: la retención del plan limita qué tan atrás
 * puede consultar la farmacia (7 días, 30 días o todo), no lo que se conserva.
 * RLS ya restringe la lectura a la sucursal de la sesión.
 */
@Injectable()
export class AuditLogService {
  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async list(scope: TenantScope, query: AuditLogQuery, now = new Date()): Promise<AuditLogPage> {
    const limit = clampInteger(query.limit, 25, 1, 100);
    const offset = clampInteger(query.offset, 0, 0, 100_000);
    const from = optionalDate(query.from, "from");
    const to = optionalDate(query.to, "to");

    return this.database.withScope(scope, async (client) => {
      const retention = await client.query<{ days: number | null }>(
        `select plan.audit_retention_days as days
         from tenant_subscriptions as subscription
         join subscription_plans as plan on plan.id = subscription.plan_id
         where subscription.tenant_id = $1 and subscription.status <> 'CANCELED'
         limit 1`,
        [scope.tenantId]
      );
      const retentionDays = retention.rows[0]?.days ?? null;
      const visibleSince = retentionDays === null ? null : new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      const effectiveFrom = latest(visibleSince, from);

      const conditions = ["event.tenant_id = $1"];
      const params: unknown[] = [scope.tenantId];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        conditions.push(sql.replace("?", `$${params.length}`));
      };
      if (effectiveFrom) add("event.occurred_at >= ?", effectiveFrom);
      if (to) add("event.occurred_at <= ?", to);
      if (query.action?.trim()) add("event.action ilike ?", `%${escapeLike(query.action.trim())}%`);
      if (query.entityType?.trim()) add("event.entity_type = ?", query.entityType.trim());
      const where = conditions.join(" and ");

      const total = await client.query<{ count: string }>(
        `select count(*)::text as count from audit_events as event where ${where}`,
        params
      );
      const items = await client.query<AuditLogPage["items"][number]>(
        `select event.id, event.occurred_at as "occurredAt", event.action,
                event.entity_type as "entityType", event.entity_id as "entityId",
                actor.display_name as "actorName", event.payload
         from audit_events as event
         left join users as actor on actor.id = event.actor_user_id
         where ${where}
         order by event.occurred_at desc, event.id desc
         limit ${limit} offset ${offset}`,
        params
      );

      return {
        retentionDays,
        visibleSince: visibleSince?.toISOString() ?? null,
        total: Number(total.rows[0]?.count ?? 0),
        limit,
        offset,
        items: items.rows
      };
    });
  }
}

function clampInteger(value: string | number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function optionalDate(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ code: "INVALID_INPUT", field, message: "La fecha no es válida." });
  }
  return date;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
