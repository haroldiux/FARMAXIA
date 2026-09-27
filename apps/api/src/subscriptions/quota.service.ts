import { Inject, Injectable } from "@nestjs/common";
import type { TenantScope } from "../database/tenant-database.js";
import { TenantDatabase } from "../database/tenant-database.js";
import type { PoolClient } from "pg";
import type { SubscriptionStatus } from "./subscription-state.js";

export type QuotaResource =
  | "branches"
  | "users"
  | "cash_registers"
  | "storage_bytes";

export class QuotaExceededError extends Error {
  constructor(resource: QuotaResource) {
    super(`The quota for ${resource} has been exhausted.`);
  }
}

export class SubscriptionAccessError extends Error {
  constructor() {
    super("The tenant does not have an active subscription.");
  }
}

export interface SubscriptionAccessState {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
}

interface EffectiveQuota extends SubscriptionAccessState {
  planLimit: string | null;
  overrideSubscriptionId: string | null;
  overrideLimit: string | null;
}

@Injectable()
export class QuotaService {
  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async consume(scope: TenantScope, resource: QuotaResource, units: number): Promise<void> {
    if (!Number.isSafeInteger(units) || units <= 0) {
      throw new Error("Quota consumption must be a positive safe integer.");
    }

    await this.database.withScope(scope, (client) => consumeQuota(client, scope.tenantId, resource, units));
  }
}

/**
 * Consume cuota dentro de una transacción ya abierta (con RLS de la farmacia), para que
 * el recurso y su cuota se confirmen o reviertan juntos.
 */
export async function consumeQuota(client: PoolClient, tenantId: string, resource: QuotaResource, units: number): Promise<void> {
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error("Quota consumption must be a positive safe integer.");
  }
  const quota = await effectiveQuota(client, tenantId, resource);
  assertSubscriptionAccess(quota, new Date());

  await client.query(
    `insert into tenant_resource_usage (tenant_id, resource_code, used_units)
     values ($1, $2, 0)
     on conflict (tenant_id, resource_code) do nothing`,
    [tenantId, resource]
  );

  const limit = quota.overrideSubscriptionId ? quota.overrideLimit : quota.planLimit;
  const result = await client.query(
    `update tenant_resource_usage
     set used_units = used_units + $3, updated_at = now()
     where tenant_id = $1
       and resource_code = $2
       and ($4::bigint is null or used_units + $3 <= $4::bigint)
     returning used_units`,
    [tenantId, resource, units, limit]
  );
  if (result.rowCount !== 1) {
    throw new QuotaExceededError(resource);
  }
}

/** Devuelve cuota (por ejemplo, al desactivar un usuario). Nunca baja de cero. */
export async function releaseQuota(client: PoolClient, tenantId: string, resource: QuotaResource, units: number): Promise<void> {
  await client.query(
    `update tenant_resource_usage
     set used_units = greatest(used_units - $3, 0), updated_at = now()
     where tenant_id = $1 and resource_code = $2`,
    [tenantId, resource, units]
  );
}

async function effectiveQuota(
  client: PoolClient,
  tenantId: string,
  resource: QuotaResource
): Promise<EffectiveQuota> {
  const { rows } = await client.query<EffectiveQuota>(
    `select
       subscription.status,
       subscription.trial_ends_at as "trialEndsAt",
       subscription.grace_ends_at as "graceEndsAt",
       plan_quota.limit_units as "planLimit",
       override.subscription_id as "overrideSubscriptionId",
       override.limit_units as "overrideLimit"
     from tenant_subscriptions as subscription
     join plan_quotas as plan_quota
       on plan_quota.plan_id = subscription.plan_id
      and plan_quota.resource_code = $2
     left join subscription_quota_overrides as override
       on override.subscription_id = subscription.id
      and override.resource_code = $2
     where subscription.tenant_id = $1
       and subscription.status <> 'CANCELED'
     limit 1`,
    [tenantId, resource]
  );
  const quota = rows[0];
  if (!quota) {
    throw new SubscriptionAccessError();
  }
  return quota;
}

export function assertSubscriptionAccess(subscription: SubscriptionAccessState, now: Date): void {
  if (subscription.status === "ACTIVE") {
    return;
  }
  if (
    subscription.status === "TRIALING" &&
    subscription.trialEndsAt &&
    subscription.trialEndsAt > now
  ) {
    return;
  }
  if (
    subscription.status === "PAST_DUE" &&
    subscription.graceEndsAt &&
    subscription.graceEndsAt > now
  ) {
    return;
  }
  throw new SubscriptionAccessError();
}
