import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PasswordHasher } from "../src/auth/password-hasher.js";
import { TenantDatabase } from "../src/database/tenant-database.js";
import { BranchesService } from "../src/branches/branches.service.js";
import { BillingService } from "../src/saas/billing.service.js";
import { OnboardingService } from "../src/saas/onboarding.service.js";
import { PlatformDatabase } from "../src/saas/platform-database.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const role = (name: string) =>
  withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testPlatformUrl = process.env.DATABASE_PLATFORM_TEST_URL ?? role("farmaxia_platform");
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? role("farmaxia_app");

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const platformDatabase = new PlatformDatabase(testPlatformUrl);
const tenantDatabase = new TenantDatabase(testAppUrl);
const hasher = new PasswordHasher();
const onboarding = new OnboardingService(platformDatabase, hasher, new BillingService(platformDatabase));
const branchesService = new BranchesService(tenantDatabase);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const password = "ClaveSegura123";

interface Pharmacy {
  tenantId: string;
  branchId: string;
  userId: string;
  scope: { tenantId: string; branchId: string; userId: string };
}

async function registerPharmacy(name: string, planCode = "PROFESIONAL"): Promise<Pharmacy> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@farmacia.bo`;
  const registered = await onboarding.register({
    pharmacyName: name,
    legalName: `${name} S.R.L.`,
    taxId: "1234567019",
    ownerName: `Dueña ${name}`,
    email,
    password,
    planCode
  });
  return {
    tenantId: registered.tenantId,
    branchId: registered.branchId,
    userId: registered.userId,
    scope: { tenantId: registered.tenantId, branchId: registered.branchId, userId: registered.userId }
  };
}

describe("Branches administration (Sucursales)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
    await ownerPool.query("GRANT INSERT ON TABLE user_branch_memberships TO farmaxia_app;");
    await ownerPool.query(`
      DROP POLICY IF EXISTS cash_shift_controls_tenant_admin_select ON cash_shift_controls;
      CREATE POLICY cash_shift_controls_tenant_admin_select ON cash_shift_controls
        FOR SELECT TO farmaxia_app
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
      DROP POLICY IF EXISTS cash_shifts_tenant_admin_select ON cash_shifts;
      CREATE POLICY cash_shifts_tenant_admin_select ON cash_shifts
        FOR SELECT TO farmaxia_app
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
    `);
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        saas_payments, saas_invoices, subscription_feature_overrides, platform_audit_events,
        audit_events, idempotency_records, outbox_events, document_sequences,
        subscription_quota_overrides, tenant_resource_usage, tenant_subscriptions,
        background_jobs, tenant_files, auth_sessions, user_roles, role_permissions, roles,
        user_branch_memberships, cash_shift_controls, cash_shift_users, cash_shifts, cash_registers,
        warehouses, branches, legal_entities, users, tenants
      cascade
    `);
  });

  afterAll(async () => {
    await tenantDatabase.close();
    await ownerPool.end();
  });

  it("creates a branch, initializes its central warehouse, adds user membership, and consumes quota", async () => {
    const pharmacy = await registerPharmacy("Farmacia Central");

    const created = await branchesService.createBranch(pharmacy.scope, {
      code: "SUC-002",
      name: "Sucursal Miraflores"
    });

    expect(created.id).toBeDefined();
    expect(created.code).toBe("SUC-002");
    expect(created.name).toBe("Sucursal Miraflores");
    expect(created.isActive).toBe(true);

    // Verify warehouse created
    const warehouses = await ownerPool.query(
      "SELECT id, name, warehouse_type FROM warehouses WHERE tenant_id = $1 AND branch_id = $2",
      [pharmacy.tenantId, created.id]
    );
    expect(warehouses.rows).toHaveLength(1);
    expect(warehouses.rows[0]?.warehouse_type).toBe("CENTRAL");

    // Verify creator membership
    const memberships = await ownerPool.query(
      "SELECT branch_id FROM user_branch_memberships WHERE tenant_id = $1 AND user_id = $2 AND branch_id = $3",
      [pharmacy.tenantId, pharmacy.userId, created.id]
    );
    expect(memberships.rows).toHaveLength(1);

    // Verify quota consumption
    const usage = await ownerPool.query(
      "SELECT used_units FROM tenant_resource_usage WHERE tenant_id = $1 AND resource_code = 'branches'",
      [pharmacy.tenantId]
    );
    expect(Number(usage.rows[0]?.used_units)).toBe(2);

    // Verify listed in listBranches
    const branches = await branchesService.listBranches(pharmacy.scope);
    expect(branches).toHaveLength(2);
    expect(branches.map((b) => b.code)).toContain("SUC-002");
  });

  it("rejects duplicate branch code in the same tenant", async () => {
    const pharmacy = await registerPharmacy("Farmacia Unica");

    await expect(
      branchesService.createBranch(pharmacy.scope, {
        code: "SUC-001",
        name: "Otra con mismo código"
      })
    ).rejects.toThrow(/Ya existe una sucursal con el código SUC-001/);
  });

  it("enforces plan quota limit when creating branches", async () => {
    // BASICO only allows 1 branch, already used by onboarding
    const pharmacy = await registerPharmacy("Farmacia Basica", "BASICO");

    await expect(
      branchesService.createBranch(pharmacy.scope, {
        code: "SUC-002",
        name: "Segunda sucursal"
      })
    ).rejects.toThrow(/Tu plan no permite registrar más sucursales activas/);
  });

  it("updates branch name and code", async () => {
    const pharmacy = await registerPharmacy("Farmacia Edicion");
    const created = await branchesService.createBranch(pharmacy.scope, {
      code: "SUC-002",
      name: "Sucursal Original"
    });

    const updated = await branchesService.updateBranch(pharmacy.scope, created.id, {
      code: "SUC-SUR",
      name: "Sucursal Zona Sur"
    });

    expect(updated.code).toBe("SUC-SUR");
    expect(updated.name).toBe("Sucursal Zona Sur");

    // Reject duplicate when renaming to existing code SUC-001
    await expect(
      branchesService.updateBranch(pharmacy.scope, created.id, { code: "SUC-001" })
    ).rejects.toThrow(/Ya existe una sucursal con el código SUC-001/);
  });

  it("deactivates a branch, releases quota, and allows reactivation", async () => {
    const pharmacy = await registerPharmacy("Farmacia Desactivable");
    const created = await branchesService.createBranch(pharmacy.scope, {
      code: "SUC-002",
      name: "Sucursal Temporal"
    });

    // Deactivate branch
    const deactivated = await branchesService.updateBranch(pharmacy.scope, created.id, {
      isActive: false
    });
    expect(deactivated.isActive).toBe(false);

    // Quota should be released back to 1
    const usageAfterDeactivate = await ownerPool.query(
      "SELECT used_units FROM tenant_resource_usage WHERE tenant_id = $1 AND resource_code = 'branches'",
      [pharmacy.tenantId]
    );
    expect(Number(usageAfterDeactivate.rows[0]?.used_units)).toBe(1);

    // Reactivate branch
    const reactivated = await branchesService.updateBranch(pharmacy.scope, created.id, {
      isActive: true
    });
    expect(reactivated.isActive).toBe(true);

    const usageAfterReactivate = await ownerPool.query(
      "SELECT used_units FROM tenant_resource_usage WHERE tenant_id = $1 AND resource_code = 'branches'",
      [pharmacy.tenantId]
    );
    expect(Number(usageAfterReactivate.rows[0]?.used_units)).toBe(2);
  });

  it("rejects deactivating the last active branch of the tenant", async () => {
    const pharmacy = await registerPharmacy("Farmacia Monosucursal");

    await expect(
      branchesService.updateBranch(pharmacy.scope, pharmacy.branchId, { isActive: false })
    ).rejects.toThrow(/No puedes desactivar la única sucursal activa/);
  });

  it("rejects deactivating a branch with an open shift", async () => {
    const pharmacy = await registerPharmacy("Farmacia Turnos");
    const created = await branchesService.createBranch(pharmacy.scope, {
      code: "SUC-002",
      name: "Sucursal con Caja"
    });

    // Find the register in the new branch
    const regs = await ownerPool.query<{ id: string }>(
      "SELECT id FROM cash_registers WHERE tenant_id = $1 AND branch_id = $2",
      [pharmacy.tenantId, created.id]
    );
    const registerId = regs.rows[0]!.id;

    // Insert an open cash shift control in this branch
    const shiftResult = await ownerPool.query<{ id: string }>(
      `INSERT INTO cash_shifts (tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       VALUES ($1, $2, $3, now(), now() + interval '8 hours', 'SCHEDULED', $4)
       RETURNING id`,
      [pharmacy.tenantId, created.id, registerId, pharmacy.userId]
    );
    const shiftId = shiftResult.rows[0]!.id;

    await ownerPool.query(
      `INSERT INTO cash_shift_controls (tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id)
       VALUES ($1, $2, $3, '100.0000', '100.0000', 'OPEN', $4)`,
      [pharmacy.tenantId, created.id, shiftId, pharmacy.userId]
    );

    // Attempting to deactivate this branch must fail
    await expect(
      branchesService.updateBranch(pharmacy.scope, created.id, { isActive: false })
    ).rejects.toThrow(/turnos de caja abiertos/);
  });
});
