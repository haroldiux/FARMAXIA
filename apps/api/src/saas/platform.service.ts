import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PasswordHasher } from "../auth/password-hasher.js";
import { recordPlatformAudit } from "./billing.service.js";
import { PlatformDatabase } from "./platform-database.js";
import { PlatformTokenService, platformTokenLifetimeSeconds } from "./platform-auth.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlatformOverview {
  tenantsByStatus: Record<string, number>;
  monthlyRecurringBob: string;
  pendingPayments: number;
  openInvoices: { count: number; amountBob: string };
  recentRegistrations: Array<{ tenantId: string; name: string; planName: string; createdAt: string }>;
}

export interface PlatformTenantRow {
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

@Injectable()
export class PlatformService {
  constructor(
    @Inject(PlatformDatabase) private readonly database: PlatformDatabase,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(PlatformTokenService) private readonly tokens: PlatformTokenService
  ) {}

  async login(email: unknown, password: unknown): Promise<{ accessToken: string; expiresInSeconds: number; displayName: string }> {
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      throw new UnauthorizedException("Invalid credentials.");
    }
    const operator = await this.database.withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; passwordHash: string; isActive: boolean; displayName: string }>(
        `select id, password_hash as "passwordHash", is_active as "isActive", display_name as "displayName"
         from platform_operators where email = $1`,
        [email.trim().toLowerCase()]
      );
      return rows[0];
    });
    if (!operator || !operator.isActive || !(await this.passwordHasher.verify(operator.passwordHash, password))) {
      throw new UnauthorizedException("Invalid credentials.");
    }
    return {
      accessToken: await this.tokens.issue(operator.id),
      expiresInSeconds: platformTokenLifetimeSeconds,
      displayName: operator.displayName
    };
  }

  async me(operatorId: string): Promise<{ operatorId: string; email: string; displayName: string }> {
    return this.database.withTransaction(async (client) => {
      const { rows } = await client.query<{ email: string; displayName: string; isActive: boolean }>(
        `select email, display_name as "displayName", is_active as "isActive" from platform_operators where id = $1`,
        [operatorId]
      );
      const operator = rows[0];
      if (!operator?.isActive) {
        throw new UnauthorizedException();
      }
      return { operatorId, email: operator.email, displayName: operator.displayName };
    });
  }

  async overview(): Promise<PlatformOverview> {
    return this.database.withTransaction(async (client) => {
      const statuses = await client.query<{ status: string; count: string }>(
        `select status, count(*)::text as count from tenant_subscriptions where status <> 'CANCELED' group by status`
      );
      const mrr = await client.query<{ total: string }>(
        `select coalesce(sum(plan.price_monthly_bob), 0)::text as total
         from tenant_subscriptions as subscription
         join subscription_plans as plan on plan.id = subscription.plan_id
         where subscription.status in ('ACTIVE', 'PAST_DUE')`
      );
      const pending = await client.query<{ count: string }>(
        "select count(*)::text as count from saas_payments where status = 'PENDING'"
      );
      const open = await client.query<{ count: string; total: string }>(
        "select count(*)::text as count, coalesce(sum(amount_bob), 0)::text as total from saas_invoices where status = 'OPEN'"
      );
      const recent = await client.query<PlatformOverview["recentRegistrations"][number]>(
        `select tenant.id as "tenantId", tenant.name, plan.name as "planName", tenant.created_at as "createdAt"
         from tenants as tenant
         join tenant_subscriptions as subscription on subscription.tenant_id = tenant.id and subscription.status <> 'CANCELED'
         join subscription_plans as plan on plan.id = subscription.plan_id
         order by tenant.created_at desc
         limit 5`
      );
      return {
        tenantsByStatus: Object.fromEntries(statuses.rows.map((row) => [row.status, Number(row.count)])),
        monthlyRecurringBob: mrr.rows[0]?.total ?? "0",
        pendingPayments: Number(pending.rows[0]?.count ?? 0),
        openInvoices: { count: Number(open.rows[0]?.count ?? 0), amountBob: open.rows[0]?.total ?? "0" },
        recentRegistrations: recent.rows
      };
    });
  }

  async listTenants(search?: string, status?: string): Promise<PlatformTenantRow[]> {
    return this.database.withTransaction(async (client) => {
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (search?.trim()) {
        params.push(`%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        conditions.push(`(tenant.name ilike $${params.length} or tenant.slug ilike $${params.length})`);
      }
      if (status?.trim()) {
        params.push(status.trim().toUpperCase());
        conditions.push(`subscription.status = $${params.length}`);
      }
      const { rows } = await client.query<PlatformTenantRow>(
        `select tenant.id as "tenantId", tenant.name, tenant.slug, tenant.created_at as "createdAt",
                plan.code as "planCode", plan.name as "planName", subscription.status,
                subscription.trial_ends_at as "trialEndsAt", subscription.grace_ends_at as "graceEndsAt",
                subscription.current_period_end as "currentPeriodEnd",
                (select count(*)::int from saas_invoices where tenant_id = tenant.id and status = 'OPEN') as "openInvoices",
                (select count(*)::int from saas_payments where tenant_id = tenant.id and status = 'PENDING') as "pendingPayments"
         from tenants as tenant
         left join lateral (
           select * from tenant_subscriptions
           where tenant_id = tenant.id
           order by (status = 'CANCELED'), created_at desc
           limit 1
         ) as subscription on true
         left join subscription_plans as plan on plan.id = subscription.plan_id
         ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
         order by tenant.created_at desc
         limit 200`,
        params
      );
      return rows;
    });
  }

  async tenantDetail(tenantId: string): Promise<Record<string, unknown>> {
    assertUuid(tenantId);
    return this.database.withTransaction(async (client) => {
      const tenants = await this.listTenantsById(client, tenantId);
      const tenant = tenants[0];
      if (!tenant) {
        throw new NotFoundException({ code: "TENANT_NOT_FOUND", message: "La farmacia no existe." });
      }
      const legal = await client.query(
        `select legal_name as "legalName", tax_id as "taxId" from legal_entities where tenant_id = $1 order by created_at limit 1`,
        [tenantId]
      );
      const owner = await client.query(
        `select app_user.display_name as "displayName", app_user.email
         from user_roles
         join roles on roles.id = user_roles.role_id and roles.code = 'owner'
         join users as app_user on app_user.id = user_roles.user_id
         where user_roles.tenant_id = $1
         limit 1`,
        [tenantId]
      );
      const usage = await client.query(
        `select quota.resource_code as resource, coalesce(usage.used_units, 0)::int as used, quota.limit_units::int as limit
         from tenant_subscriptions as subscription
         join plan_quotas as quota on quota.plan_id = subscription.plan_id and quota.resource_code <> 'storage_bytes'
         left join tenant_resource_usage as usage on usage.tenant_id = subscription.tenant_id and usage.resource_code = quota.resource_code
         where subscription.tenant_id = $1 and subscription.status <> 'CANCELED'
         order by quota.resource_code`,
        [tenantId]
      );
      const overrides = await client.query(
        `select override.feature_code as "featureCode", override.is_enabled as "isEnabled", feature.name
         from subscription_feature_overrides as override
         join tenant_subscriptions as subscription on subscription.id = override.subscription_id
         join saas_features as feature on feature.code = override.feature_code
         where subscription.tenant_id = $1 and subscription.status <> 'CANCELED'
         order by feature.sort_order`,
        [tenantId]
      );
      const invoices = await client.query(
        `select id, number, plan_name as "planName", period_start as "periodStart", period_end as "periodEnd",
                amount_bob::text as "amountBob", status, issued_at as "issuedAt", paid_at as "paidAt"
         from saas_invoices where tenant_id = $1 order by issued_at desc limit 24`,
        [tenantId]
      );
      const history = await client.query(
        `select event.action, event.payload, event.occurred_at as "occurredAt", operator.display_name as "operatorName"
         from platform_audit_events as event
         left join platform_operators as operator on operator.id = event.operator_id
         where event.tenant_id = $1
         order by event.occurred_at desc limit 20`,
        [tenantId]
      );
      return {
        ...tenant,
        legalName: legal.rows[0]?.legalName ?? null,
        taxId: legal.rows[0]?.taxId ?? null,
        owner: owner.rows[0] ?? null,
        usage: usage.rows,
        featureOverrides: overrides.rows,
        invoices: invoices.rows,
        history: history.rows
      };
    });
  }

  async listPayments(status = "PENDING"): Promise<unknown[]> {
    const normalized = status.toUpperCase();
    if (!["PENDING", "APPROVED", "REJECTED", "ALL"].includes(normalized)) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "status", message: "Estado no válido." });
    }
    return this.database.withTransaction(async (client) => {
      const { rows } = await client.query(
        `select payment.id, payment.method, payment.reference, payment.amount_bob::text as "amountBob",
                to_char(payment.paid_on, 'YYYY-MM-DD') as "paidOn", payment.status,
                payment.submitted_at as "submittedAt", payment.reviewed_at as "reviewedAt",
                payment.review_note as "reviewNote", payment.attachment_media_type as "attachmentMediaType",
                invoice.id as "invoiceId", invoice.number as "invoiceNumber", invoice.amount_bob::text as "invoiceAmountBob",
                invoice.status as "invoiceStatus", tenant.id as "tenantId", tenant.name as "tenantName",
                submitter.display_name as "submittedBy"
         from saas_payments as payment
         join saas_invoices as invoice on invoice.id = payment.invoice_id
         join tenants as tenant on tenant.id = payment.tenant_id
         join users as submitter on submitter.id = payment.submitted_by_user_id
         ${normalized === "ALL" ? "" : "where payment.status = $1"}
         order by payment.submitted_at ${normalized === "PENDING" ? "asc" : "desc"}
         limit 200`,
        normalized === "ALL" ? [] : [normalized]
      );
      return rows;
    });
  }

  async paymentAttachment(paymentId: string): Promise<{ mediaType: string; data: Buffer }> {
    assertUuid(paymentId);
    return this.database.withTransaction(async (client) => {
      const { rows } = await client.query<{ mediaType: string | null; data: Buffer | null }>(
        `select attachment_media_type as "mediaType", attachment_data as data from saas_payments where id = $1`,
        [paymentId]
      );
      const found = rows[0];
      if (!found?.mediaType || !found.data) {
        throw new NotFoundException({ code: "ATTACHMENT_NOT_FOUND", message: "Este pago no tiene comprobante adjunto." });
      }
      return { mediaType: found.mediaType, data: found.data };
    });
  }

  async listPlans(): Promise<unknown[]> {
    return this.database.withTransaction(async (client) => {
      const { rows } = await client.query(
        `select plan.code, plan.name, plan.description, plan.price_monthly_bob::text as "priceMonthlyBob",
                plan.audit_retention_days as "auditRetentionDays", plan.is_public as "isPublic",
                plan.is_active as "isActive", plan.allows_all_features as "allowsAllFeatures",
                (select count(*)::int from tenant_subscriptions
                   where plan_id = plan.id and status <> 'CANCELED') as "subscriptions",
                coalesce((select json_object_agg(resource_code, limit_units) from plan_quotas
                   where plan_id = plan.id and resource_code <> 'storage_bytes'), '{}'::json) as quotas,
                coalesce((select json_agg(feature_code order by feature_code) from plan_features
                   where plan_id = plan.id and is_enabled), '[]'::json) as features
         from subscription_plans as plan
         order by plan.sort_order`
      );
      return rows;
    });
  }

  async listFeatures(): Promise<unknown[]> {
    return this.database.withTransaction(async (client) => {
      const { rows } = await client.query("select code, name, module from saas_features order by sort_order");
      return rows;
    });
  }

  async updatePlan(operatorId: string, code: string, input: { priceMonthlyBob?: unknown; isPublic?: unknown }): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [code.toUpperCase()];
    if (input.priceMonthlyBob !== undefined) {
      const price = String(input.priceMonthlyBob).trim();
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(price)) {
        throw new BadRequestException({ code: "INVALID_INPUT", field: "priceMonthlyBob", message: "El precio debe ser un número con hasta 2 decimales." });
      }
      params.push(price);
      updates.push(`price_monthly_bob = $${params.length}`);
    }
    if (input.isPublic !== undefined) {
      if (typeof input.isPublic !== "boolean") {
        throw new BadRequestException({ code: "INVALID_INPUT", field: "isPublic", message: "Valor no válido." });
      }
      params.push(input.isPublic);
      updates.push(`is_public = $${params.length}`);
    }
    if (!updates.length) {
      return;
    }
    await this.database.withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `update subscription_plans set ${updates.join(", ")} where code = $1`,
        params
      );
      if (!rowCount) {
        throw new NotFoundException({ code: "PLAN_NOT_FOUND", message: "El plan no existe." });
      }
      await recordPlatformAudit(client, operatorId, null, "saas.plan.updated", "subscription_plan", code.toUpperCase(), {
        priceMonthlyBob: input.priceMonthlyBob,
        isPublic: input.isPublic
      });
    });
  }

  private async listTenantsById(client: import("pg").PoolClient, tenantId: string): Promise<PlatformTenantRow[]> {
    const { rows } = await client.query<PlatformTenantRow>(
      `select tenant.id as "tenantId", tenant.name, tenant.slug, tenant.created_at as "createdAt",
              plan.code as "planCode", plan.name as "planName", subscription.status,
              subscription.trial_ends_at as "trialEndsAt", subscription.grace_ends_at as "graceEndsAt",
              subscription.current_period_end as "currentPeriodEnd",
              (select count(*)::int from saas_invoices where tenant_id = tenant.id and status = 'OPEN') as "openInvoices",
              (select count(*)::int from saas_payments where tenant_id = tenant.id and status = 'PENDING') as "pendingPayments"
       from tenants as tenant
       left join lateral (
         select * from tenant_subscriptions where tenant_id = tenant.id
         order by (status = 'CANCELED'), created_at desc limit 1
       ) as subscription on true
       left join subscription_plans as plan on plan.id = subscription.plan_id
       where tenant.id = $1`,
      [tenantId]
    );
    return rows;
  }
}

function assertUuid(value: string): void {
  if (!uuidPattern.test(value)) {
    throw new NotFoundException();
  }
}
