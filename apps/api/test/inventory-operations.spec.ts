import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { InventoryAlertsService } from "../src/inventory/inventory-alerts.service.js";
import { InventoryCountsService } from "../src/inventory/inventory-counts.service.js";
import { InventoryRecordsService } from "../src/inventory/inventory-records.service.js";
import { InventoryService } from "../src/inventory/inventory.service.js";
import { WarehousesService } from "../src/inventory/warehouses.service.js";
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
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? role("farmaxia_app");
const testPlatformUrl = process.env.DATABASE_PLATFORM_TEST_URL ?? role("farmaxia_platform");

const tenantId = "00000000-0000-4000-8000-000000003001";
const legalEntityId = "00000000-0000-4000-8000-000000003002";
const branchId = "00000000-0000-4000-8000-000000003011";
const otherBranchId = "00000000-0000-4000-8000-000000003012";
const userId = "00000000-0000-4000-8000-000000003021";
const otherUserId = "00000000-0000-4000-8000-000000003022";
const warehouseId = "00000000-0000-4000-8000-000000003031";
const otherWarehouseId = "00000000-0000-4000-8000-000000003032";
const productId = "00000000-0000-4000-8000-000000003041";
const presentationId = "00000000-0000-4000-8000-000000003042";
const batchLongId = "00000000-0000-4000-8000-000000003051";
const batchSoonId = "00000000-0000-4000-8000-000000003052";
const batchExpiredId = "00000000-0000-4000-8000-000000003053";
const batchOtherId = "00000000-0000-4000-8000-000000003054";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const platform = new PlatformDatabase(testPlatformUrl);
const inventory = new InventoryService(database);
const warehouses = new WarehousesService(database);
const counts = new InventoryCountsService(database, inventory);
const records = new InventoryRecordsService(database);
const alerts = new InventoryAlertsService(database, platform);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId, branchId };
const otherScope: TenantScope = { tenantId, userId: otherUserId, branchId: otherBranchId };

async function balance(batchId: string, warehouse = warehouseId): Promise<{ quantity: number; reserved: number }> {
  const result = await ownerPool.query<{ quantity: string; reserved: string }>(
    "select quantity_base as quantity, reserved_base as reserved from inventory_balances where warehouse_id = $1 and batch_id = $2",
    [warehouse, batchId]
  );
  return { quantity: Number(result.rows[0]?.quantity ?? 0), reserved: Number(result.rows[0]?.reserved ?? 0) };
}

describe("module 3: warehouses, physical counts, waste acts and alerts", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'm3-pharmacy', 'Farmacia M3')", [tenantId]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia M3 SRL', '7000301')",
      [legalEntityId, tenantId]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $3, $4, 'NORTH', 'Norte'), ($2, $3, $4, 'SOUTH', 'Sur')",
      [branchId, otherBranchId, tenantId, legalEntityId]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, 'm3-user@example.test', 'Ana Almacén', 'x'), ($2, 'm3-other@example.test', 'Otro', 'x')",
      [userId, otherUserId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $3, $5)",
      [userId, otherUserId, tenantId, branchId, otherBranchId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $3, $4, 'Central Norte', 'CENTRAL'), ($2, $3, $5, 'Central Sur', 'CENTRAL')",
      [warehouseId, otherWarehouseId, tenantId, branchId, otherBranchId]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Amoxicilina 500 mg')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Cápsula', 1)",
      [presentationId, tenantId, productId]
    );
    await ownerPool.query(
      `insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values
         ($1, $5, $6, 'LOT-LONG', current_date + 400, 1.5000),
         ($2, $5, $6, 'LOT-SOON', current_date + 10, 2.0000),
         ($3, $5, $6, 'LOT-OLD', current_date - 5, 2.5000),
         ($4, $5, $6, 'LOT-SOUTH', current_date + 5, 1.0000)`,
      [batchLongId, batchSoonId, batchExpiredId, batchOtherId, tenantId, presentationId]
    );
    await ownerPool.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values
         ($1, $2, $4, 100, 10), ($1, $2, $5, 20, 0), ($1, $2, $6, 5, 0), ($1, $3, $7, 8, 0)`,
      [tenantId, warehouseId, otherWarehouseId, batchLongId, batchSoonId, batchExpiredId, batchOtherId]
    );
  });

  afterAll(async () => {
    await database.close();
    await platform.close();
    await ownerPool.end();
  });

  it("creates and configures central, cold and quarantine warehouses", async () => {
    const cold = await warehouses.create(scope, { name: "Refrigerador", warehouseType: "COLD" });
    expect(cold).toMatchObject({ warehouseType: "COLD", isDispatchEnabled: true, isActive: true, stockBase: 0 });

    const quarantine = await warehouses.create(scope, { name: "Cuarentena", warehouseType: "QUARANTINE" });
    expect(quarantine.isDispatchEnabled).toBe(false);
    await expect(
      warehouses.create(scope, { name: "Otra cuarentena", warehouseType: "QUARANTINE", isDispatchEnabled: true })
    ).rejects.toThrow(/cuarentena/);
    await expect(warehouses.update(scope, cold.id, { warehouseType: "QUARANTINE", isDispatchEnabled: true })).rejects.toThrow();
    await expect(warehouses.create(scope, { name: "refrigerador" })).rejects.toThrow(/Ya existe/);

    // Con stock no se desactiva; vacío sí, y deja de aparecer en la lista operativa.
    await expect(warehouses.update(scope, warehouseId, { isActive: false })).rejects.toThrow(/stock/);
    await warehouses.update(scope, cold.id, { isActive: false });
    const operative = await inventory.listWarehouses(scope);
    expect(operative.items.map((item) => item.name).sort()).toEqual(["Central Norte", "Cuarentena"]);
    const all = await warehouses.list(scope, true);
    expect(all.items).toHaveLength(3);
    expect(all.items.find((item) => item.id === warehouseId)).toMatchObject({ stockBase: 125, reservedBase: 10, batchCount: 3 });

    // Otra sucursal no ve estos almacenes.
    const other = await warehouses.list(otherScope, true);
    expect(other.items.map((item) => item.name)).toEqual(["Central Sur"]);

    const audit = await ownerPool.query("select action from audit_events where tenant_id = $1 and action like 'inventory.warehouse%'", [tenantId]);
    expect(audit.rowCount).toBe(3);
  });

  it("runs a blind physical count and posts the differences only after approval", async () => {
    const opened = await counts.create(scope, { warehouseId, notes: "Cierre de mes" });
    expect(opened.number).toBe("INV-NORTH-000001");
    expect(opened.status).toBe("OPEN");
    expect(opened.lines).toHaveLength(3);
    expect(opened.lines.every((line) => line.expectedQuantity === null)).toBe(true);
    await expect(counts.create(scope, { warehouseId })).rejects.toThrow(/en curso/);
    await expect(counts.submit(scope, opened.id)).rejects.toThrow(/Faltan 3/);

    await counts.recordLines(scope, opened.id, {
      lines: [
        { batchId: batchLongId, countedQuantity: 98 },
        { batchId: batchSoonId, countedQuantity: 20 },
        { batchId: batchExpiredId, countedQuantity: 7 }
      ]
    });
    await expect(
      counts.recordLines(scope, opened.id, { lines: [{ batchId: batchOtherId, countedQuantity: 1 }] })
    ).rejects.toThrow(/no pertenece/);

    const submitted = await counts.submit(scope, opened.id);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.differenceLines).toBe(2);
    expect(submitted.lines.find((line) => line.batchId === batchLongId)).toMatchObject({ expectedQuantity: 100, difference: -2 });
    await expect(counts.recordLines(scope, opened.id, { lines: [{ batchId: batchLongId, countedQuantity: 1 }] })).rejects.toThrow();

    // Nada se movió todavía.
    expect(await balance(batchLongId)).toEqual({ quantity: 100, reserved: 10 });

    const approved = await counts.approve(scope, opened.id);
    expect(approved.status).toBe("APPROVED");
    expect(await balance(batchLongId)).toEqual({ quantity: 98, reserved: 10 });
    expect(await balance(batchSoonId)).toEqual({ quantity: 20, reserved: 0 });
    expect(await balance(batchExpiredId)).toEqual({ quantity: 7, reserved: 0 });
    const reconciliations = await ownerPool.query(
      "select delta_quantity::int as delta from inventory_reconciliations where count_id = $1 order by delta_quantity",
      [opened.id]
    );
    expect(reconciliations.rows.map((row) => row.delta)).toEqual([-2, 0, 2]);
    await expect(counts.approve(scope, opened.id)).rejects.toThrow();

    // Con el conteo cerrado se puede abrir otro.
    const next = await counts.create(scope, { warehouseId });
    expect(next.number).toBe("INV-NORTH-000002");
    await counts.cancel(scope, next.id);
    expect((await counts.list(scope)).items.map((item) => item.status)).toEqual(["CANCELED", "APPROVED"]);
    expect((await counts.list(otherScope)).items).toHaveLength(0);
  });

  it("refuses an approval that would leave stock below active reservations", async () => {
    const opened = await counts.create(scope, { warehouseId });
    await counts.recordLines(scope, opened.id, {
      lines: [
        { batchId: batchLongId, countedQuantity: 4 },
        { batchId: batchSoonId, countedQuantity: 20 },
        { batchId: batchExpiredId, countedQuantity: 5 }
      ]
    });
    await counts.submit(scope, opened.id);
    await expect(counts.approve(scope, opened.id)).rejects.toThrow(/reservas/);
    expect(await balance(batchLongId)).toEqual({ quantity: 100, reserved: 10 });
    expect((await counts.get(scope, opened.id)).status).toBe("SUBMITTED");
  });

  it("numbers waste acts per branch and exposes the printable act", async () => {
    const first = await inventory.recordWaste(scope, {
      idempotencyKey: "m3-waste-1",
      warehouseId,
      batchId: batchExpiredId,
      quantityBase: 2,
      reason: "Vencido en estante",
      disposalMethod: "DESTRUCTION"
    });
    expect(first.actNumber).toBe("AB-NORTH-000001");
    const second = await inventory.recordWaste(scope, {
      idempotencyKey: "m3-waste-2",
      warehouseId,
      batchId: batchSoonId,
      quantityBase: 1,
      reason: "Envase roto"
    });
    expect(second.actNumber).toBe("AB-NORTH-000002");
    // Reintentar la misma merma no consume otro número.
    const retried = await inventory.recordWaste(scope, {
      idempotencyKey: "m3-waste-1",
      warehouseId,
      batchId: batchExpiredId,
      quantityBase: 2,
      reason: "Vencido en estante",
      disposalMethod: "DESTRUCTION"
    });
    expect(retried.actNumber).toBe("AB-NORTH-000001");
    await expect(
      inventory.recordWaste(scope, {
        idempotencyKey: "m3-waste-3",
        warehouseId,
        batchId: batchSoonId,
        quantityBase: 1,
        reason: "x",
        disposalMethod: "BURN" as never
      })
    ).rejects.toThrow(/Disposal/);

    const list = await records.listWasteActs(scope);
    expect(list.items.map((item) => item.actNumber)).toEqual(["AB-NORTH-000002", "AB-NORTH-000001"]);
    const act = await records.getWasteAct(scope, first.wasteEventId);
    expect(act).toMatchObject({
      actNumber: "AB-NORTH-000001",
      legalName: "Farmacia M3 SRL",
      taxId: "7000301",
      branchCode: "NORTH",
      lotCode: "LOT-OLD",
      quantityBase: 2,
      disposalMethod: "DESTRUCTION",
      unitCost: "2.50",
      totalCost: "5.00",
      createdByName: "Ana Almacén"
    });
    await expect(records.getWasteAct(otherScope, first.wasteEventId)).rejects.toThrow(/no encontrada/);
  });

  it("scans expiry alerts idempotently, per branch, and resolves them when stock is gone", async () => {
    const firstScan = await alerts.scan(30);
    expect(firstScan.created).toBe(3);
    expect((await alerts.scan(30)).created).toBe(0);

    const north = await alerts.list(scope);
    expect(north.items.map((item) => [item.lotCode, item.alertType])).toEqual([
      ["LOT-OLD", "EXPIRED"],
      ["LOT-SOON", "EXPIRING"]
    ]);
    expect(north.unacknowledged).toBe(2);
    expect(north.items[1]!.daysToExpiry).toBe(10);
    const south = await alerts.list(otherScope);
    expect(south.items.map((item) => item.lotCode)).toEqual(["LOT-SOUTH"]);

    await alerts.acknowledge(scope, north.items[1]!.id);
    expect((await alerts.list(scope, false)).items.map((item) => item.lotCode)).toEqual(["LOT-OLD"]);
    await expect(alerts.acknowledge(otherScope, north.items[0]!.id)).rejects.toThrow(/no encontrada/);

    await inventory.recordWaste(scope, {
      idempotencyKey: "m3-waste-all",
      warehouseId,
      batchId: batchExpiredId,
      quantityBase: 5,
      reason: "Baja total del lote vencido",
      disposalMethod: "DESTRUCTION"
    });
    const rescan = await alerts.scan(30);
    expect(rescan).toEqual({ created: 0, resolved: 1 });
    expect((await alerts.list(scope)).items.map((item) => item.lotCode)).toEqual(["LOT-SOON"]);
  });

  it("lists branch reservations and keeps inactive warehouses out of FEFO", async () => {
    await ownerPool.query(
      `insert into inventory_reservations (tenant_id, warehouse_id, batch_id, quantity_base, idempotency_key, expires_at)
       values ($1, $2, $3, 10, 'm3-res', now() + interval '1 hour')`,
      [tenantId, warehouseId, batchLongId]
    );
    const reservations = await records.listReservations(scope, "ACTIVE");
    expect(reservations.items).toHaveLength(1);
    expect(reservations.items[0]).toMatchObject({ lotCode: "LOT-LONG", quantityBase: 10, status: "ACTIVE" });
    expect((await records.listReservations(otherScope)).items).toHaveLength(0);

    await ownerPool.query("update warehouses set is_active = false where id = $1", [warehouseId]);
    await expect(
      inventory.reserveFefo(scope, {
        idempotencyKey: "m3-fefo",
        warehouseId,
        presentationId,
        quantityRequested: 1,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      })
    ).rejects.toThrow();
  });
});
