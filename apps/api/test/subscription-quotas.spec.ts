import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase } from "../src/database/tenant-database.js";
import { FeatureService } from "../src/subscriptions/feature.service.js";
import { QuotaExceededError, QuotaService } from "../src/subscriptions/quota.service.js";

const developmentDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia";
const developmentAppDatabaseUrl =
  process.env.DATABASE_APP_URL ??
  "postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(developmentDatabaseUrl, "farmaxia_test");
const testAppDatabaseUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName(developmentAppDatabaseUrl, "farmaxia_test");
const tenantId = "00000000-0000-4000-8000-000000000201";
const branchId = "00000000-0000-4000-8000-000000000211";
const userId = "00000000-0000-4000-8000-000000000221";
const legalEntityId = "00000000-0000-4000-8000-000000000231";

const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);
const quotas = new QuotaService(tenantDatabase);
const features = new FeatureService(tenantDatabase);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("subscription quotas", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        subscription_quota_overrides,
        tenant_resource_usage,
        tenant_subscriptions,
        background_jobs,
        tenant_files,
        auth_sessions,
        user_roles,
        role_permissions,
        permissions,
        roles,
        user_branch_memberships,
        cash_registers,
        warehouses,
        branches,
        legal_entities,
        users,
        tenants
    `);
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [
      tenantId,
      "quota-tenant",
      "Quota tenant"
    ]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4)",
      [legalEntityId, tenantId, "Quota SRL", "2000001"]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [branchId, tenantId, legalEntityId, "QUOTA", "Quota branch"]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)",
      [userId, "quota@example.test", "Quota user", "not-a-password"]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
      [userId, tenantId, branchId]
    );
    const plan = await ownerPool.query<{ id: string }>(
      "select id from subscription_plans where code = 'COMPLETO'"
    );
    const planId = plan.rows[0]?.id;
    if (!planId) {
      throw new Error("COMPLETO plan must be seeded.");
    }
    const subscription = await ownerPool.query<{ id: string }>(
      `insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at, trial_ends_at)
       values ($1, $2, 'TRIALING', now(), now() + interval '7 days') returning id`,
      [tenantId, planId]
    );
    const subscriptionId = subscription.rows[0]?.id;
    if (!subscriptionId) {
      throw new Error("Trial subscription must be created.");
    }
    await ownerPool.query(
      "insert into subscription_quota_overrides (subscription_id, resource_code, limit_units) values ($1, $2, $3)",
      [subscriptionId, "branches", 1]
    );
  });

  afterAll(async () => {
    await tenantDatabase.close();
    await ownerPool.end();
  });

  it("atomically rejects a trial quota while keeping unlimited plan limits unbounded", async () => {
    const scope = { tenantId, userId, branchId };
    await quotas.consume(scope, "branches", 1);
    await expect(quotas.consume(scope, "branches", 1)).rejects.toBeInstanceOf(
      QuotaExceededError
    );
    await quotas.consume(scope, "cash_registers", 500);
    await expect(features.isEnabled(scope, "sales.confirm")).resolves.toBe(true);
  });
});
