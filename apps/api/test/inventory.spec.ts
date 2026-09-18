import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { InventoryService } from "../src/inventory/inventory.service.js";
import { ProcurementService } from "../src/procurement/procurement.service.js";

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
const tenantId = "00000000-0000-4000-8000-000000000601";
const branchId = "00000000-0000-4000-8000-000000000611";
const userId = "00000000-0000-4000-8000-000000000621";
const legalEntityId = "00000000-0000-4000-8000-000000000631";
const warehouseId = "00000000-0000-4000-8000-000000000641";

const scope: TenantScope = { tenantId, userId, branchId };
const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);
const catalog = new CatalogService(tenantDatabase);
const procurement = new ProcurementService(tenantDatabase);
const inventory = new InventoryService(tenantDatabase);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("inventory adjustments and reconciliation (C03)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        inventory_reconciliations,
        payables,
        supplier_invoices,
        inventory_movements,
        inventory_balances,
        goods_receipt_items,
        goods_receipts,
        inventory_batches,
        purchase_order_items,
        purchase_orders,
        suppliers,
        product_homologations,
        presentation_prices,
        product_barcodes,
        price_lists,
        product_presentations,
        products,
        product_categories,
        audit_events,
        idempotency_records,
        outbox_events,
        document_sequences,
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
      "inventory-tenant",
      "Inventory tenant"
    ]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4)",
      [legalEntityId, tenantId, "Inventory SRL", "6000001"]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [branchId, tenantId, legalEntityId, "INVENTORY", "Inventory branch"]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name) values ($1, $2, $3, $4)",
      [warehouseId, tenantId, branchId, "Inventory warehouse"]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)",
      [userId, "inventory@example.test", "Inventory user", "not-a-password"]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
      [userId, tenantId, branchId]
    );
  });

  afterAll(async () => {
    await tenantDatabase.close();
    await ownerPool.end();
  });

  async function seedBatch(): Promise<string> {
    const category = await catalog.createCategory(scope, {
      name: "Inventario general",
      isControlled: false
    });
    const product = await catalog.createProduct(scope, {
      categoryId: category.id,
      name: "Producto de conteo"
    });
    const presentation = await catalog.createPresentation(scope, {
      productId: product.id,
      name: "Unidad",
      baseUnitFactor: 1,
      isSellable: true
    });
    const supplier = await procurement.createSupplier(scope, { name: "Proveedor de conteo" });
    const order = await procurement.createPurchaseOrder(scope, {
      supplierId: supplier.id,
      warehouseId,
      lines: [{ presentationId: presentation.id, quantityBase: 10, unitCost: "1.0000" }]
    });
    await procurement.receive(scope, {
      idempotencyKey: "seed-receipt",
      supplierId: supplier.id,
      purchaseOrderId: order.id,
      warehouseId,
      receivedAt: "2026-09-18T10:00:00.000Z",
      lines: [
        {
          presentationId: presentation.id,
          lotCode: "COUNT-001",
          expiresOn: "2027-12-31",
          quantityBase: 10,
          unitCost: "1.0000"
        }
      ]
    });
    const batch = await ownerPool.query<{ id: string }>(
      "select id from inventory_batches where tenant_id = $1 limit 1",
      [tenantId]
    );
    const id = batch.rows[0]?.id;
    if (!id) {
      throw new Error("Seed batch was not created.");
    }
    return id;
  }

  it("reconciles a count once and records an OUT movement plus audit", async () => {
    const batchId = await seedBatch();
    const first = await inventory.reconcile(scope, {
      idempotencyKey: "count-001",
      warehouseId,
      batchId,
      countedQuantity: 7,
      reason: "Conteo físico de apertura"
    });
    const replay = await inventory.reconcile(scope, {
      idempotencyKey: "count-001",
      warehouseId,
      batchId,
      countedQuantity: 7,
      reason: "Conteo físico de apertura"
    });

    expect(replay).toEqual(first);
    expect(first.deltaQuantity).toBe(-3);
    expect(first.quantityBase).toBe(7);
    const balance = await ownerPool.query<{ quantity_base: string }>(
      "select quantity_base from inventory_balances where tenant_id = $1 and warehouse_id = $2 and batch_id = $3",
      [tenantId, warehouseId, batchId]
    );
    const movement = await ownerPool.query<{ movement_type: string; movement_direction: string; quantity_base: string }>(
      "select movement_type, movement_direction, quantity_base from inventory_movements where tenant_id = $1 and movement_type = 'ADJUSTMENT'",
      [tenantId]
    );
    const auditRows = await ownerPool.query<{ action: string }>(
      "select action from audit_events where tenant_id = $1 and action = 'inventory.reconciled'",
      [tenantId]
    );
    expect(balance.rows).toEqual([{ quantity_base: "7" }]);
    expect(movement.rows).toEqual([
      { movement_type: "ADJUSTMENT", movement_direction: "OUT", quantity_base: "3" }
    ]);
    expect(auditRows.rows).toEqual([{ action: "inventory.reconciled" }]);
  });

  it("refuses to adjust below reserved stock and supports an IN correction", async () => {
    const batchId = await seedBatch();
    await inventory.reconcile(scope, {
      idempotencyKey: "count-002",
      warehouseId,
      batchId,
      countedQuantity: 7,
      reason: "Conteo con faltante"
    });
    await ownerPool.query(
      "update inventory_balances set reserved_base = 5 where tenant_id = $1 and warehouse_id = $2 and batch_id = $3",
      [tenantId, warehouseId, batchId]
    );
    await expect(
      inventory.reconcile(scope, {
        idempotencyKey: "count-003",
        warehouseId,
        batchId,
        countedQuantity: 1,
        reason: "Conteo inválido bajo reserva"
      })
    ).rejects.toThrow();
    const correction = await inventory.reconcile(scope, {
      idempotencyKey: "count-004",
      warehouseId,
      batchId,
      countedQuantity: 9,
      reason: "Corrección de conteo"
    });
    expect(correction.deltaQuantity).toBe(2);
    expect(correction.quantityBase).toBe(9);
  });
});
