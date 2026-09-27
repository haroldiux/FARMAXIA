import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { PasswordHasher } from "../auth/password-hasher.js";
import { assertStrongPassword } from "../auth/password-policy.js";
import { ownerRoleCode, systemRoles, tenantPermissions } from "../identity/role-templates.js";
import { createTrialSubscription } from "../subscriptions/subscription-state.js";
import { BillingService } from "./billing.service.js";
import { PlatformDatabase } from "./platform-database.js";

export interface RegisterPharmacyInput {
  pharmacyName: string;
  legalName: string;
  taxId: string;
  branchName?: string;
  ownerName: string;
  email: string;
  password: string;
  planCode: string;
}

export interface RegisteredPharmacy {
  tenantId: string;
  tenantSlug: string;
  branchId: string;
  userId: string;
  trialEndsAt: Date;
}

export interface PublicPlan {
  code: string;
  name: string;
  description: string;
  priceMonthlyBob: string;
  auditRetentionDays: number | null;
  quotas: Record<string, number | null>;
  features: string[];
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(PlatformDatabase) private readonly database: PlatformDatabase,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(BillingService) private readonly billing: BillingService
  ) {}

  async listPublicPlans(): Promise<PublicPlan[]> {
    return this.database.withTransaction(async (client) => {
      const plans = await client.query<Omit<PublicPlan, "quotas" | "features"> & { id: string }>(
        `select id, code, name, description, price_monthly_bob::text as "priceMonthlyBob",
                audit_retention_days as "auditRetentionDays"
         from subscription_plans
         where is_public and is_active
         order by sort_order`
      );
      const quotas = await client.query<{ planId: string; resource: string; limit: string | null }>(
        `select plan_id as "planId", resource_code as resource, limit_units::text as limit from plan_quotas`
      );
      const features = await client.query<{ planId: string; code: string }>(
        `select plan_feature.plan_id as "planId", plan_feature.feature_code as code
         from plan_features as plan_feature
         join saas_features as feature on feature.code = plan_feature.feature_code
         where plan_feature.is_enabled
         order by feature.sort_order`
      );
      return plans.rows.map(({ id, ...plan }) => ({
        ...plan,
        quotas: Object.fromEntries(
          quotas.rows.filter((row) => row.planId === id).map((row) => [row.resource, row.limit === null ? null : Number(row.limit)])
        ),
        features: features.rows.filter((row) => row.planId === id).map((row) => row.code)
      }));
    });
  }

  async register(rawInput: RegisterPharmacyInput, now = new Date()): Promise<RegisteredPharmacy> {
    const input = normalize(rawInput);
    const passwordHash = await this.passwordHasher.hash(input.password);

    try {
      return await this.database.withTransaction(async (client) => {
        const plan = await client.query<{ id: string }>(
          "select id from subscription_plans where code = $1 and is_public and is_active",
          [input.planCode]
        );
        const planId = plan.rows[0]?.id;
        if (!planId) {
          throw new BadRequestException({ code: "PLAN_NOT_FOUND", message: "Elige un plan disponible." });
        }

        const emailTaken = await client.query("select 1 from users where email = $1", [input.email]);
        if (emailTaken.rowCount) {
          throw emailTakenError();
        }

        const tenantSlug = await availableSlug(client, input.pharmacyName);
        const tenant = await insertReturningId(client,
          "insert into tenants (slug, name) values ($1, $2) returning id", [tenantSlug, input.pharmacyName]);
        const legalEntity = await insertReturningId(client,
          "insert into legal_entities (tenant_id, legal_name, tax_id) values ($1, $2, $3) returning id",
          [tenant, input.legalName, input.taxId]);
        const branch = await insertReturningId(client,
          `insert into branches (tenant_id, legal_entity_id, code, name) values ($1, $2, 'SUC-001', $3) returning id`,
          [tenant, legalEntity, input.branchName]);
        await client.query(
          "insert into warehouses (tenant_id, branch_id, name, is_dispatch_enabled) values ($1, $2, 'Almacén Central', true)",
          [tenant, branch]
        );
        await client.query(
          "insert into cash_registers (tenant_id, branch_id, code) values ($1, $2, 'CAJA-01')",
          [tenant, branch]
        );

        const user = await insertReturningId(client,
          `insert into users (email, display_name, password_hash, home_tenant_id, password_changed_at)
           values ($1, $2, $3, $4, $5) returning id`,
          [input.email, input.ownerName, passwordHash, tenant, now]);
        await client.query(
          "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
          [user, tenant, branch]
        );
        for (const permission of tenantPermissions) {
          await client.query(
            `insert into permissions (code, description, label, module, sort_order)
             values ($1, $2, $3, $4, $5) on conflict (code) do nothing`,
            [permission.code, permission.description, permission.label, permission.module, permission.sortOrder]
          );
        }
        // Roles predefinidos de la farmacia; el dueño recibe "Propietario".
        for (const template of systemRoles) {
          const role = await insertReturningId(client,
            `insert into roles (tenant_id, code, name, description, is_system)
             values ($1, $2, $3, $4, true) returning id`,
            [tenant, template.code, template.name, template.description]);
          for (const permissionCode of template.permissions) {
            await client.query("insert into role_permissions (role_id, permission_code) values ($1, $2)", [role, permissionCode]);
          }
          if (template.code === ownerRoleCode) {
            await client.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [user, tenant, role]);
          }
        }

        const trial = createTrialSubscription(now);
        const trialEndsAt = trial.trialEndsAt ?? now;
        const subscription = await insertReturningId(client,
          `insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at, trial_ends_at)
           values ($1, $2, $3, $4, $5) returning id`,
          [tenant, planId, trial.status, trial.startsAt, trialEndsAt]);

        // El alta consume la primera sucursal, el primer usuario y la primera caja del plan.
        for (const resource of ["branches", "users", "cash_registers"]) {
          await client.query(
            "insert into tenant_resource_usage (tenant_id, resource_code, used_units) values ($1, $2, 1)",
            [tenant, resource]
          );
        }

        await client.query(
          `insert into audit_events (tenant_id, branch_id, actor_user_id, action, entity_type, entity_id, payload)
           values ($1, $2, $3, 'tenant.registered', 'tenant', $4, $5)`,
          [tenant, branch, user, tenant, JSON.stringify({ planCode: input.planCode, slug: tenantSlug })]
        );
        await client.query(
          `insert into platform_audit_events (tenant_id, action, entity_type, entity_id, payload)
           values ($1, 'tenant.registered', 'tenant', $2, $3)`,
          [tenant, tenant, JSON.stringify({ planCode: input.planCode, pharmacyName: input.pharmacyName })]
        );

        // Con 7 días de prueba el primer comprobante ya cae en la ventana de emisión.
        await this.billing.ensureNextInvoice(client, subscription, now);

        return { tenantId: tenant, tenantSlug, branchId: branch, userId: user, trialEndsAt };
      });
    } catch (error) {
      if (isUniqueViolation(error, "users_email_unique")) {
        throw emailTakenError();
      }
      throw error;
    }
  }
}

function normalize(input: RegisterPharmacyInput): Required<RegisterPharmacyInput> {
  const text = (value: unknown, field: string, min: number, max: number): string => {
    const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (trimmed.length < min || trimmed.length > max) {
      throw new BadRequestException({ code: "INVALID_INPUT", field, message: `Revisa el campo ${field}.` });
    }
    return trimmed;
  };

  const email = text(input?.email, "email", 5, 254).toLowerCase();
  if (!emailPattern.test(email)) {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "email", message: "El correo no es válido." });
  }
  const taxId = text(input?.taxId, "taxId", 5, 20);
  if (!/^\d+$/.test(taxId)) {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "taxId", message: "El NIT solo debe contener números." });
  }
  const password = assertStrongPassword(input?.password);

  return {
    pharmacyName: text(input?.pharmacyName, "pharmacyName", 2, 160),
    legalName: text(input?.legalName, "legalName", 2, 200),
    taxId,
    branchName: input?.branchName?.trim() ? text(input.branchName, "branchName", 2, 160) : "Casa Matriz",
    ownerName: text(input?.ownerName, "ownerName", 2, 160),
    email,
    password,
    planCode: text(input?.planCode, "planCode", 2, 80).toUpperCase()
  };
}

async function availableSlug(client: PoolClient, name: string): Promise<string> {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "farmacia";
  const { rows } = await client.query<{ slug: string }>(
    "select slug from tenants where slug = $1 or slug like $2",
    [base, `${base}-%`]
  );
  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

async function insertReturningId(client: PoolClient, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await client.query<{ id: string }>(sql, params);
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("Insert did not return an id.");
  }
  return id;
}

function emailTakenError(): ConflictException {
  return new ConflictException({ code: "EMAIL_TAKEN", field: "email", message: "Ya existe una cuenta con ese correo." });
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === "object" && error !== null
    && (error as { code?: string }).code === "23505"
    && (error as { constraint?: string }).constraint === constraint;
}
