import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { InventoryService } from "../src/inventory/inventory.service.js";

const ownerUrl = process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia";
const appUrl = process.env.DATABASE_APP_URL ?? "postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia";
function databaseName(value: string, name: string): string {
  const url = new URL(value);
  url.pathname = `/${name}`;
  return url.toString();
}
const testOwnerUrl = process.env.DATABASE_TEST_URL ?? databaseName(ownerUrl, "farmaxia_test");
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? databaseName(appUrl, "farmaxia_test");
const tenantId = "00000000-0000-4000-8000-000000000901";
const otherTenantId = "00000000-0000-4000-8000-000000000902";
const branchOneId = "00000000-0000-4000-8000-000000000911";
const branchTwoId = "00000000-0000-4000-8000-000000000912";
const otherBranchId = "00000000-0000-4000-8000-000000000913";
const reportUserId = "00000000-0000-4000-8000-000000000921";
const branchUserId = "00000000-0000-4000-8000-000000000922";
const roleId = "00000000-0000-4000-8000-000000000931";
const branchRoleId = "00000000-0000-4000-8000-000000000932";
const branchOneWarehouseId = "00000000-0000-4000-8000-000000000941";
const branchTwoWarehouseId = "00000000-0000-4000-8000-000000000942";
const otherWarehouseId = "00000000-0000-4000-8000-000000000943";
const productId = "00000000-0000-4000-8000-000000000951";
const presentationId = "00000000-0000-4000-8000-000000000952";
const otherProductId = "00000000-0000-4000-8000-000000000953";
const otherPresentationId = "00000000-0000-4000-8000-000000000954";
const batchOneId = "00000000-0000-4000-8000-000000000961";
const batchTwoId = "00000000-0000-4000-8000-000000000962";
const otherBatchId = "00000000-0000-4000-8000-000000000963";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const inventory = new InventoryService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const reportScope: TenantScope = { tenantId, userId: reportUserId, branchId: branchOneId };
const branchScope: TenantScope = { tenantId, userId: branchUserId, branchId: branchOneId };

describe("tenant-wide inventory report (F9)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        inventory_reconciliations, inventory_reservations, inventory_operation_events,
        payables, supplier_invoices, inventory_movements, inventory_balances,
        goods_receipt_items, goods_receipts, inventory_batches,
        purchase_order_items, purchase_orders, suppliers,
        product_homologations, presentation_prices, product_barcodes, price_lists,
        product_presentations, products, product_categories,
        audit_events, idempotency_records, outbox_events, document_sequences,
        subscription_quota_overrides, tenant_resource_usage, tenant_subscriptions,
        background_jobs, tenant_files, auth_sessions,
        role_permissions, user_roles, permissions, roles,
        user_branch_memberships, cash_shift_controls, cash_shift_users, cash_shifts,
        cash_registers, warehouses, branches, legal_entities, users, tenants
      cascade
    `);
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, $2, $3), ($4, $5, $6)", [
      tenantId, "report-tenant", "Report tenant", otherTenantId, "other-tenant", "Other tenant"
    ]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4), ($5, $6, $7, $8)",
      ["00000000-0000-4000-8000-000000000971", tenantId, "Report SRL", "9000001", "00000000-0000-4000-8000-000000000972", otherTenantId, "Other SRL", "9000002"]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5), ($6, $2, $3, $7, $8), ($9, $10, $11, $12, $13)",
      [branchOneId, tenantId, "00000000-0000-4000-8000-000000000971", "NORTH", "North branch", branchTwoId, "EAST", "East branch", otherBranchId, otherTenantId, "00000000-0000-4000-8000-000000000972", "OTHER", "Other branch"]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name) values ($1, $2, $3, $4), ($5, $2, $6, $7), ($8, $9, $10, $11)",
      [branchOneWarehouseId, tenantId, branchOneId, "North warehouse", branchTwoWarehouseId, branchTwoId, "East warehouse", otherWarehouseId, otherTenantId, otherBranchId, "Other warehouse"]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4), ($5, $6, $7, $8)",
      [reportUserId, "global-report@example.test", "Global report", "not-a-password", branchUserId, "branch-user@example.test", "Branch user", "not-a-password"]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3), ($4, $2, $5)",
      [reportUserId, tenantId, branchOneId, branchUserId, branchOneId]
    );
    await ownerPool.query("insert into permissions (code, description) values ($1, $2), ($3, $4)", [
      "inventory.report.global", "Read tenant-wide inventory reports", "inventory.manage", "Manage branch inventory"
    ]);
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, $3), ($4, $2, $5)", [roleId, tenantId, "global-report", branchRoleId, "branch-inventory"]);
    await ownerPool.query("insert into role_permissions (role_id, permission_code) values ($1, $2), ($3, $4)", [roleId, "inventory.report.global", branchRoleId, "inventory.manage"]);
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3), ($4, $2, $5)", [reportUserId, tenantId, roleId, branchUserId, branchRoleId]);
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, $3), ($4, $2, $5), ($6, $7, $8)", [productId, tenantId, "Amoxicilina", otherProductId, "Paracetamol", "00000000-0000-4000-8000-000000000955", otherTenantId, "Otro producto"]);
    await ownerPool.query("insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, $4, 1), ($5, $2, $6, $7, 1), ($8, $9, $10, $11, 1)", [presentationId, tenantId, productId, "Caja 10", otherPresentationId, otherProductId, "Caja 20", "00000000-0000-4000-8000-000000000956", otherTenantId, "00000000-0000-4000-8000-000000000955", "Caja"]);
    await ownerPool.query("insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'NORTH-01', '2027-01-01', 1.2500), ($4, $2, $3, 'EAST-01', '2027-02-01', 1.2500), ($5, $6, $7, 'OTHER-01', '2027-03-01', 1.2500)", [batchOneId, tenantId, presentationId, batchTwoId, otherBatchId, otherTenantId, "00000000-0000-4000-8000-000000000956"]);
    await ownerPool.query("insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 10, 3), ($1, $4, $5, 7, 2), ($6, $7, $8, 99, 9)", [tenantId, branchOneWarehouseId, batchOneId, branchTwoWarehouseId, batchTwoId, otherTenantId, otherWarehouseId, otherBatchId]);
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("denies a branch-only user and aggregates every tenant branch with exact strings", async () => {
    await expect(inventory.listTenantStockReport(branchScope, { limit: 20, offset: 0 })).rejects.toThrow();

    const report = await inventory.listTenantStockReport(reportScope, { limit: 20, offset: 0 });
    expect(report.items).toHaveLength(2);
    expect(report.items.map((item) => item.branchCode)).toEqual(["EAST", "NORTH"]);
    expect(report.items[0]).toMatchObject({ physical: "7", reserved: "2", available: "5" });
    expect(report.items[1]).toMatchObject({ physical: "10", reserved: "3", available: "7" });
    expect(report.branchSubtotals).toEqual(expect.arrayContaining([
      expect.objectContaining({ branchCode: "EAST", physical: "7", reserved: "2", available: "5" }),
      expect.objectContaining({ branchCode: "NORTH", physical: "10", reserved: "3", available: "7" })
    ]));
    expect(report.tenantTotal).toEqual({ physical: "17", reserved: "5", available: "12" });
  });

  it("keeps search and pagination deterministic without crossing tenant RLS", async () => {
    const page = await inventory.listTenantStockReport(reportScope, { search: "east", limit: 1, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.branchCode).toBe("EAST");
    expect(page.items[0]?.physical).toBe("7");
    await expect(database.withScope(reportScope, async (client) => {
      const result = await client.query("select count(*)::text as count from inventory_balances where tenant_id = $1", [otherTenantId]);
      return result.rows[0]?.count;
    })).resolves.toBe("0");
  });
});
