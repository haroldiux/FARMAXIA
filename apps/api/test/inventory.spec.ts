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
        inventory_reservations,
        inventory_operation_events,
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

  async function seedFefoInventory(): Promise<{
    presentationId: string;
    batchIds: string[];
  }> {
    const category = await catalog.createCategory(scope, {
      name: "Inventario FEFO",
      isControlled: false
    });
    const product = await catalog.createProduct(scope, {
      categoryId: category.id,
      name: "Producto FEFO"
    });
    const presentation = await catalog.createPresentation(scope, {
      productId: product.id,
      name: "Caja de dos unidades",
      baseUnitFactor: 2,
      isSellable: true
    });
    const supplier = await procurement.createSupplier(scope, { name: "Proveedor FEFO" });
    const order = await procurement.createPurchaseOrder(scope, {
      supplierId: supplier.id,
      warehouseId,
      lines: [{ presentationId: presentation.id, quantityBase: 30, unitCost: "1.0000" }]
    });
    const today = new Date();
    const dateAfter = (days: number) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    await procurement.receive(scope, {
      idempotencyKey: "fefo-seed-receipt",
      supplierId: supplier.id,
      purchaseOrderId: order.id,
      warehouseId,
      receivedAt: new Date().toISOString(),
      lines: [
        {
          presentationId: presentation.id,
          lotCode: "FEFO-EARLY",
          expiresOn: dateAfter(30),
          quantityBase: 10,
          unitCost: "1.0000"
        },
        {
          presentationId: presentation.id,
          lotCode: "FEFO-LATE",
          expiresOn: dateAfter(120),
          quantityBase: 20,
          unitCost: "1.0000"
        }
      ]
    });
    const batches = await ownerPool.query<{ id: string }>(
      `select id
       from inventory_batches
       where tenant_id = $1 and presentation_id = $2
       order by expires_on asc, id asc`,
      [tenantId, presentation.id]
    );
    return { presentationId: presentation.id, batchIds: batches.rows.map((row) => row.id) };
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

  it("reserves across batches in FEFO order and replays the same payload", async () => {
    const seeded = await seedFefoInventory();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const first = await inventory.reserveFefo(scope, {
      idempotencyKey: "reserve-fefo-001",
      warehouseId,
      presentationId: seeded.presentationId,
      quantityRequested: 8,
      expiresAt
    });
    const replay = await inventory.reserveFefo(scope, {
      idempotencyKey: "reserve-fefo-001",
      warehouseId,
      presentationId: seeded.presentationId,
      quantityRequested: 8,
      expiresAt
    });

    expect(replay).toEqual(first);
    expect(first.totalBaseUnits).toBe(16);
    expect(first.allocations.map((allocation) => allocation.batchId)).toEqual(seeded.batchIds);
    expect(first.allocations.map((allocation) => allocation.quantityBase)).toEqual([10, 6]);
    const balances = await ownerPool.query<{ batch_id: string; quantity_base: string; reserved_base: string }>(
      `select batch_id, quantity_base, reserved_base
       from inventory_balances
       where tenant_id = $1 and warehouse_id = $2
       order by batch_id`,
      [tenantId, warehouseId]
    );
    const balancesByBatch = new Map(
      balances.rows.map((row) => [row.batch_id, [row.quantity_base, row.reserved_base]])
    );
    const earlyBatchId = seeded.batchIds[0];
    const lateBatchId = seeded.batchIds[1];
    if (!earlyBatchId || !lateBatchId) {
      throw new Error("Expected two FEFO batches.");
    }
    expect(balancesByBatch.get(earlyBatchId)).toEqual(["10", "10"]);
    expect(balancesByBatch.get(lateBatchId)).toEqual(["20", "6"]);

    await expect(
      inventory.reserveFefo(scope, {
        idempotencyKey: "reserve-fefo-001",
        warehouseId,
        presentationId: seeded.presentationId,
        quantityRequested: 7,
        expiresAt
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("does not partially reserve insufficient stock and skips quarantined batches", async () => {
    const seeded = await seedFefoInventory();
    await ownerPool.query(
      "update inventory_batches set status = 'QUARANTINED' where tenant_id = $1 and id = $2",
      [tenantId, seeded.batchIds[0]]
    );
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await expect(
      inventory.reserveFefo(scope, {
        idempotencyKey: "reserve-fefo-insufficient",
        warehouseId,
        presentationId: seeded.presentationId,
        quantityRequested: 11,
        expiresAt
      })
    ).rejects.toThrow(/insufficient/i);
    const balances = await ownerPool.query<{ quantity_base: string; reserved_base: string }>(
      `select quantity_base, reserved_base
       from inventory_balances
       where tenant_id = $1 and warehouse_id = $2
       order by batch_id`,
      [tenantId, warehouseId]
    );
    expect(balances.rows.every((row) => row.reserved_base === "0")).toBe(true);
  });

  it("releases, consumes and expires reservations without double decrement", async () => {
    const seeded = await seedFefoInventory();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const reservation = await inventory.reserveFefo(scope, {
      idempotencyKey: "reserve-lifecycle-001",
      warehouseId,
      presentationId: seeded.presentationId,
      quantityRequested: 2,
      expiresAt
    });
    const reservationId = reservation.allocations[0]?.reservationId;
    if (!reservationId) {
      throw new Error("Expected a reservation allocation.");
    }
    const released = await inventory.releaseReservation(scope, {
      reservationId,
      idempotencyKey: "release-lifecycle-001"
    });
    const releasedReplay = await inventory.releaseReservation(scope, {
      reservationId,
      idempotencyKey: "release-lifecycle-001"
    });
    expect(releasedReplay).toEqual(released);
    expect(released.status).toBe("RELEASED");

    const consumedReservation = await inventory.reserveFefo(scope, {
      idempotencyKey: "reserve-consume-001",
      warehouseId,
      presentationId: seeded.presentationId,
      quantityRequested: 1,
      expiresAt
    });
    const consumedId = consumedReservation.allocations[0]?.reservationId;
    if (!consumedId) {
      throw new Error("Expected a consumable reservation allocation.");
    }
    const consumed = await inventory.consumeReservation(scope, {
      reservationId: consumedId,
      idempotencyKey: "consume-lifecycle-001",
      referenceType: "TEST_CONSUMPTION",
      referenceId: "00000000-0000-4000-8000-000000000699"
    });
    expect(consumed.status).toBe("CONSUMED");
    expect(consumed.quantityBase).toBe(2);

    const expiring = await inventory.reserveFefo(scope, {
      idempotencyKey: "reserve-expire-001",
      warehouseId,
      presentationId: seeded.presentationId,
      quantityRequested: 1,
      expiresAt
    });
    const expiringId = expiring.allocations[0]?.reservationId;
    if (!expiringId) {
      throw new Error("Expected an expiring reservation allocation.");
    }
    await ownerPool.query(
      "update inventory_reservations set expires_at = now() - interval '1 minute' where tenant_id = $1 and id = $2",
      [tenantId, expiringId]
    );
    const expired = await inventory.expireReservations(scope);
    expect(expired.reservationIds).toContain(expiringId);
    expect(expired.expiredCount).toBe(1);
  });

  it("serializes concurrent reservations so the last units cannot be oversold", async () => {
    const seeded = await seedFefoInventory();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const attempts = await Promise.allSettled([
      inventory.reserveFefo(scope, {
        idempotencyKey: "reserve-concurrent-001",
        warehouseId,
        presentationId: seeded.presentationId,
        quantityRequested: 8,
        expiresAt
      }),
      inventory.reserveFefo(scope, {
        idempotencyKey: "reserve-concurrent-002",
        warehouseId,
        presentationId: seeded.presentationId,
        quantityRequested: 8,
        expiresAt
      })
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const balance = await ownerPool.query<{ quantity_base: string; reserved_base: string }>(
      `select coalesce(sum(quantity_base), 0)::text as quantity_base,
              coalesce(sum(reserved_base), 0)::text as reserved_base
       from inventory_balances
       where tenant_id = $1 and warehouse_id = $2`,
      [tenantId, warehouseId]
    );
    expect(balance.rows[0]).toEqual({ quantity_base: "30", reserved_base: "16" });
  });

  it("lists expiry alerts by scoped warehouse and inclusive horizon", async () => {
    const seeded = await seedFefoInventory();

    const alerts = await inventory.listExpiryAlerts(scope, {
      warehouseId,
      horizonDays: 45
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      batchId: seeded.batchIds[0],
      status: "DUE_SOON",
      quantityBase: 10,
      reservedBase: 0,
      availableQuantity: 10
    });
  });

  it("quarantines and releases a cold-chain batch idempotently", async () => {
    const batchId = await seedBatch();

    const quarantined = await inventory.quarantineBatch(scope, {
      idempotencyKey: "quarantine-cold-001",
      warehouseId,
      batchId,
      reasonCode: "COLD_CHAIN",
      reason: "Refrigerator excursion",
      temperatureCelsius: 12.5
    });
    expect(quarantined.status).toBe("QUARANTINED");

    const replay = await inventory.quarantineBatch(scope, {
      idempotencyKey: "quarantine-cold-001",
      warehouseId,
      batchId,
      reasonCode: "COLD_CHAIN",
      reason: "Refrigerator excursion",
      temperatureCelsius: 12.5
    });
    expect(replay).toEqual(quarantined);

    const released = await inventory.releaseQuarantine(scope, {
      idempotencyKey: "quarantine-release-001",
      warehouseId,
      batchId,
      reason: "Quality review passed"
    });
    expect(released.status).toBe("AVAILABLE");

    const row = await ownerPool.query<{ status: string }>(
      "select status from inventory_batches where tenant_id = $1 and id = $2",
      [tenantId, batchId]
    );
    expect(row.rows[0]?.status).toBe("AVAILABLE");
  });

  it("rejects quarantine while the batch has active reservations", async () => {
    const seeded = await seedFefoInventory();
    const reservedBatchId = seeded.batchIds[0];
    if (!reservedBatchId) {
      throw new Error("Expected a reserved batch.");
    }
    await inventory.reserveFefo(scope, {
      idempotencyKey: "quarantine-reservation-seed",
      warehouseId,
      presentationId: seeded.presentationId,
      quantityRequested: 1,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    await expect(
      inventory.quarantineBatch(scope, {
        idempotencyKey: "quarantine-reserved-001",
        warehouseId,
        batchId: reservedBatchId,
        reasonCode: "QUALITY",
        reason: "Packaging review"
      })
    ).rejects.toThrow();
  });

  it("records waste against free stock and never decrements reservations", async () => {
    const batchId = await seedBatch();

    const waste = await inventory.recordWaste(scope, {
      idempotencyKey: "waste-001",
      warehouseId,
      batchId,
      quantityBase: 3,
      reason: "Broken packaging"
    });
    expect(waste.quantityBase).toBe(7);
    expect(waste.reservedBase).toBe(0);

    const replay = await inventory.recordWaste(scope, {
      idempotencyKey: "waste-001",
      warehouseId,
      batchId,
      quantityBase: 3,
      reason: "Broken packaging"
    });
    expect(replay).toEqual(waste);

    await expect(
      inventory.recordWaste(scope, {
        idempotencyKey: "waste-002",
        warehouseId,
        batchId,
        quantityBase: 8,
        reason: "Over disposal"
      })
    ).rejects.toThrow();

    const movement = await ownerPool.query<{ movementType: string; quantityBase: string }>(
      `select movement_type as "movementType", quantity_base as "quantityBase"
       from inventory_movements
       where tenant_id = $1 and batch_id = $2 and movement_type = 'WASTE'`,
      [tenantId, batchId]
    );
    expect(movement.rows).toHaveLength(1);
    expect(movement.rows[0]).toEqual({ movementType: "WASTE", quantityBase: "3" });
  });
});
