import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CashController } from "../src/cash/cash.controller.js";
import { CashService } from "../src/cash/cash.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";

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
  process.env.DATABASE_TEST_URL ?? withDatabaseName(developmentDatabaseUrl, "farmaxia_test");
const testAppDatabaseUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName(developmentAppDatabaseUrl, "farmaxia_test");

const tenantId = "00000000-0000-4000-8000-000000000801";
const legalEntityId = "00000000-0000-4000-8000-000000000802";
const branchId = "00000000-0000-4000-8000-000000000803";
const otherBranchId = "00000000-0000-4000-8000-000000000804";
const actorId = "00000000-0000-4000-8000-000000000805";
const planId = "00000000-0000-4000-8000-000000000806";
const subscriptionId = "00000000-0000-4000-8000-000000000807";

const scope: TenantScope = { tenantId, branchId, userId: actorId };
const otherBranchScope: TenantScope = { tenantId, branchId: otherBranchId, userId: actorId };

const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const database = new TenantDatabase(testAppDatabaseUrl);
const cash = new CashService(database);
const controller = new CashController(cash);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("cash registers administration", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        cash_shift_controls,
        cash_shift_users,
        cash_shifts,
        cash_registers,
        user_branch_memberships,
        tenant_resource_usage,
        subscription_quota_overrides,
        tenant_subscriptions,
        audit_events,
        outbox_events,
        users,
        branches,
        legal_entities,
        tenants
      cascade
    `);

    // Setup base tenant, branches and user
    await ownerPool.query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'Farmacia Test', 'farmacia-test')", [tenantId]);
    await ownerPool.query("INSERT INTO legal_entities (id, tenant_id, legal_name, tax_id) VALUES ($1, $2, 'Razón Test', '102030')", [legalEntityId, tenantId]);
    await ownerPool.query("INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES ($1, $2, $3, 'SUC-01', 'Central')", [branchId, tenantId, legalEntityId]);
    await ownerPool.query("INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES ($1, $2, $3, 'SUC-02', 'Sucursal 2')", [otherBranchId, tenantId, legalEntityId]);
    await ownerPool.query("INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, 'owner@test.com', 'Owner', 'hash')", [actorId]);
    await ownerPool.query("INSERT INTO user_branch_memberships (tenant_id, branch_id, user_id) VALUES ($1, $2, $3)", [tenantId, branchId, actorId]);
    await ownerPool.query("INSERT INTO user_branch_memberships (tenant_id, branch_id, user_id) VALUES ($1, $2, $3)", [tenantId, otherBranchId, actorId]);

    // Use seeded BASICO plan with override limit of 2 cash_registers
    const basicoPlan = await ownerPool.query<{ id: string }>("SELECT id FROM subscription_plans WHERE code = 'BASICO'");
    const effectivePlanId = basicoPlan.rows[0]!.id;
    await ownerPool.query("INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, starts_at) VALUES ($1, $2, $3, 'ACTIVE', now())", [subscriptionId, tenantId, effectivePlanId]);
    await ownerPool.query("INSERT INTO subscription_quota_overrides (subscription_id, resource_code, limit_units) VALUES ($1, 'cash_registers', 2)", [subscriptionId]);
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it("creates a cash register and consumes quota", async () => {
    const created = await cash.createRegister(scope, { code: "CAJA-01" });
    expect(created.id).toBeDefined();
    expect(created.code).toBe("CAJA-01");
    expect(created.isActive).toBe(true);

    const listed = await cash.listRegisters(scope);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.code).toBe("CAJA-01");

    // Check usage in database
    const usage = await ownerPool.query(
      "SELECT used_units FROM tenant_resource_usage WHERE tenant_id = $1 AND resource_code = 'cash_registers'",
      [tenantId]
    );
    expect(Number(usage.rows[0]?.used_units)).toBe(1);
  });

  it("rejects duplicate register code in the same branch", async () => {
    await cash.createRegister(scope, { code: "CAJA-01" });
    await expect(cash.createRegister(scope, { code: "CAJA-01" })).rejects.toThrow(
      /Ya existe una caja con el código CAJA-01/
    );
  });

  it("allows same register code in a different branch", async () => {
    await cash.createRegister(scope, { code: "CAJA-01" });
    const other = await cash.createRegister(otherBranchScope, { code: "CAJA-01" });
    expect(other.id).toBeDefined();
    expect(other.code).toBe("CAJA-01");
  });

  it("enforces plan quota limit when creating cash registers", async () => {
    await cash.createRegister(scope, { code: "CAJA-01" });
    await cash.createRegister(scope, { code: "CAJA-02" });

    // 3rd register exceeds limit of 2
    await expect(cash.createRegister(scope, { code: "CAJA-03" })).rejects.toThrow(
      /Tu plan no permite registrar más cajas activas/
    );
  });

  it("deactivates a register, releases quota, and hides it from default listing", async () => {
    const reg = await cash.createRegister(scope, { code: "CAJA-01" });
    const updated = await cash.updateRegister(scope, reg.id, { isActive: false });
    expect(updated.isActive).toBe(false);

    // Active listing should be empty
    const activeList = await cash.listRegisters(scope, false);
    expect(activeList.items).toHaveLength(0);

    // All listing should include it
    const allList = await cash.listRegisters(scope, true);
    expect(allList.items).toHaveLength(1);
    expect(allList.items[0]!.isActive).toBe(false);

    // Quota should be released
    const usage = await ownerPool.query(
      "SELECT used_units FROM tenant_resource_usage WHERE tenant_id = $1 AND resource_code = 'cash_registers'",
      [tenantId]
    );
    expect(Number(usage.rows[0]?.used_units)).toBe(0);

    // Now we should be able to create 2 more registers because quota was released
    await cash.createRegister(scope, { code: "CAJA-02" });
    await cash.createRegister(scope, { code: "CAJA-03" });
  });

  it("rejects deactivating a cash register with an open shift", async () => {
    const reg = await cash.createRegister(scope, { code: "CAJA-01" });
    const shift = await cash.createShift(scope, {
      idempotencyKey: "test-shift-1",
      cashRegisterId: reg.id,
      scheduledStartAt: "2026-10-10T08:00:00.000Z",
      scheduledEndAt: "2026-10-10T16:00:00.000Z",
      userIds: [actorId]
    });
    await cash.openShift(scope, shift.id, {
      idempotencyKey: "test-open-1",
      openingAmountBob: "100.0000"
    });

    await expect(cash.updateRegister(scope, reg.id, { isActive: false })).rejects.toThrow(
      /No puedes desactivar una caja que tiene un turno abierto/
    );
  });
});
