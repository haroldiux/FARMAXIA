import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { SalesService, resolveSalesAccess } from "../src/sales/sales.service.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAppUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName("postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia", "farmaxia_test");

const id = (n: number) => `00000000-0000-4000-8000-0000000061${String(n).padStart(2, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchId = id(3);
const branch2Id = id(4);
const userId = id(10);
const user2Id = id(11);
const user3Id = id(12);
const warehouseId = id(20);
const warehouse2Id = id(21);
const productId = id(30);
const presentationId = id(31);
const batchSoonId = id(40);
const batchLaterId = id(41);
const registerId = id(50);
const register2Id = id(51);
const shiftId = id(60);
const shift2Id = id(61);
const otherTenantId = id(70);
const otherLegalEntityId = id(71);
const otherBranchId = id(72);
const otherUserId = id(73);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const cashierScope: TenantScope = { tenantId, userId, branchId };
const cashier2Scope: TenantScope = { tenantId, userId: user2Id, branchId };
const branch2Scope: TenantScope = { tenantId, userId: user3Id, branchId: branch2Id };
const otherTenantScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };
const viewAll = { viewAll: true };
const ownOnly = { viewAll: false };

let counter = 0;
async function sell(
  scope: TenantScope,
  shift: string,
  warehouse: string,
  quantity = 1,
  payments?: Array<{ method: string; amountBob: string; reference?: string }>
) {
  counter += 1;
  const total = (quantity * 12.5).toFixed(4);
  return sales.confirm(scope, {
    idempotencyKey: `history-${counter}`,
    cashShiftId: shift,
    warehouseId: warehouse,
    payments: payments ?? [{ method: "CASH", amountBob: total }],
    lines: [{ presentationId, quantity, unitPriceBob: "12.5000" }]
  });
}

describe("Module 5 T2 sales history, detail and numbering", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    counter = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, 'hist-pharmacy', 'Farmacia Historia'), ($2, 'other-pharmacy', 'Otra Farmacia')",
      [tenantId, otherTenantId]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Historia SRL', '7000601'), ($3, $4, 'Otra SRL', '7000602')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name) values
         ($1, $2, $3, 'MAIN', 'Central'), ($4, $2, $3, 'NORTH', 'Norte'), ($5, $6, $7, 'MAIN', 'Otra Central')`,
      [branchId, tenantId, legalEntityId, branch2Id, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash) values
         ($1, 'hist1@example.test', 'Cajero Uno', 'x'), ($2, 'hist2@example.test', 'Cajero Dos', 'x'),
         ($3, 'hist3@example.test', 'Cajero Norte', 'x'), ($4, 'hist4@example.test', 'Otro', 'x')`,
      [userId, user2Id, user3Id, otherUserId]
    );
    await ownerPool.query(
      `insert into user_branch_memberships (user_id, tenant_id, branch_id)
       values ($1, $5, $6), ($2, $5, $6), ($3, $5, $7), ($4, $8, $9)`,
      [userId, user2Id, user3Id, otherUserId, tenantId, branchId, branch2Id, otherTenantId, otherBranchId]
    );
    await ownerPool.query(
      `insert into warehouses (id, tenant_id, branch_id, name, warehouse_type)
       values ($1, $3, $4, 'Central', 'CENTRAL'), ($2, $3, $5, 'Norte', 'CENTRAL')`,
      [warehouseId, warehouse2Id, tenantId, branchId, branch2Id]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Paracetamol 500 mg')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 10', 10)",
      [presentationId, tenantId, productId]
    );
    await ownerPool.query("insert into price_lists (id, tenant_id, name, currency) values ($1, $2, 'General', 'BOB')", [id(90), tenantId]);
    await ownerPool.query(
      "insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values ($1, $2, $3, 12.5000, now() - interval '1 day')",
      [tenantId, id(90), presentationId]
    );
    await ownerPool.query(
      `insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values
         ($1, $3, $4, 'LOT-SOON', current_date + 60, 5.0000), ($2, $3, $4, 'LOT-LATER', current_date + 400, 5.0000)`,
      [batchSoonId, batchLaterId, tenantId, presentationId]
    );
    await ownerPool.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base)
       values ($1, $2, $3, 20, 0), ($1, $2, $4, 50, 0), ($1, $5, $4, 50, 0)`,
      [tenantId, warehouseId, batchSoonId, batchLaterId, warehouse2Id]
    );
    await ownerPool.query(
      "insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $3, $4, 'CAJA-1', true), ($2, $3, $5, 'CAJA-N', true)",
      [registerId, register2Id, tenantId, branchId, branch2Id]
    );
    const shifts = [
      [shiftId, registerId, branchId, userId],
      [shift2Id, register2Id, branch2Id, user3Id]
    ] as const;
    for (const [shift, register, branch, user] of shifts) {
      await ownerPool.query(
        `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
         values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
        [shift, tenantId, branch, register, user]
      );
      await ownerPool.query(
        "insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)",
        [tenantId, branch, shift, user]
      );
      await ownerPool.query(
        `insert into cash_shift_controls (tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
         values ($1, $2, $3, '100.0000', '100.0000', 'OPEN', $4, now())`,
        [tenantId, branch, shift, user]
      );
    }
    await ownerPool.query(
      "insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)",
      [tenantId, branchId, shiftId, user2Id]
    );
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("numbers sales per branch as V-<branchCode>-000001 and returns the number from confirm", async () => {
    const first = await sell(cashierScope, shiftId, warehouseId);
    const second = await sell(cashier2Scope, shiftId, warehouseId);
    const north = await sell(branch2Scope, shift2Id, warehouse2Id);
    expect(first.saleNumber).toBe("V-MAIN-000001");
    expect(second.saleNumber).toBe("V-MAIN-000002");
    expect(north.saleNumber).toBe("V-NORTH-000001");
  });

  it("lists branch sales newest first with cashier, totals and payment method summary", async () => {
    await sell(cashierScope, shiftId, warehouseId, 1);
    await sell(cashier2Scope, shiftId, warehouseId, 2, [
      { method: "CARD", amountBob: "10.0000", reference: "A-1" },
      { method: "CASH", amountBob: "20.0000" }
    ]);
    await sell(branch2Scope, shift2Id, warehouse2Id, 1);

    const list = await sales.list(cashierScope, {}, viewAll);
    expect(list.total).toBe(2);
    expect(list.items.map((item) => item.number)).toEqual(["V-MAIN-000002", "V-MAIN-000001"]);
    expect(list.items[0]).toMatchObject({
      cashierName: "Cajero Dos",
      cashShiftId: shiftId,
      status: "CONFIRMED",
      totalBob: "25.0000",
      paidAmountBob: "30.0000",
      changeAmountBob: "5.0000",
      paymentMethods: ["CARD", "CASH"]
    });
  });

  it("paginates with limit and offset", async () => {
    for (let i = 0; i < 3; i += 1) await sell(cashierScope, shiftId, warehouseId);
    const page = await sales.list(cashierScope, { limit: 2, offset: 2 }, viewAll);
    expect(page.total).toBe(3);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(2);
    expect(page.items.map((item) => item.number)).toEqual(["V-MAIN-000001"]);
  });

  it("filters by cashier, shift, status and date range", async () => {
    const first = await sell(cashierScope, shiftId, warehouseId);
    await sell(cashier2Scope, shiftId, warehouseId);
    const numbers = async (query: Parameters<SalesService["list"]>[1]) =>
      (await sales.list(cashierScope, query, viewAll)).items.map((item) => item.number);

    expect(await numbers({ cashierId: user2Id })).toEqual(["V-MAIN-000002"]);
    expect(await numbers({ cashShiftId: shiftId })).toHaveLength(2);
    expect(await numbers({ cashShiftId: shift2Id })).toHaveLength(0);
    expect(await numbers({ status: "CONFIRMED" })).toHaveLength(2);
    expect(await numbers({ status: "VOIDED" })).toHaveLength(0);

    await ownerPool.query("update sales set created_at = '2026-01-10T15:00:00Z' where id = $1", [first.id]);
    expect(await numbers({ from: "2026-01-10", to: "2026-01-10" })).toEqual(["V-MAIN-000001"]);
    expect(await numbers({ from: "2026-01-11" })).toEqual(["V-MAIN-000002"]);
    expect(await numbers({ to: "2026-01-09" })).toHaveLength(0);
    await expect(sales.list(cashierScope, { from: "not-a-date" }, viewAll)).rejects.toThrow(/date/i);
    await expect(sales.list(cashierScope, { status: "BOGUS" }, viewAll)).rejects.toThrow(/status/i);
  });

  it("restricts users without broad access to the sales they created", async () => {
    const mine = await sell(cashierScope, shiftId, warehouseId);
    const theirs = await sell(cashier2Scope, shiftId, warehouseId);
    expect((await sales.list(cashierScope, { cashierId: user2Id }, ownOnly)).items).toEqual([]);
    expect((await sales.list(cashierScope, {}, ownOnly)).items.map((item) => item.id)).toEqual([mine.id]);
    await expect(sales.detail(cashierScope, theirs.id, ownOnly)).rejects.toThrow(/not found/i);
    await expect(sales.detail(cashierScope, mine.id, ownOnly)).resolves.toMatchObject({ id: mine.id });
    await expect(sales.detail(cashierScope, theirs.id, viewAll)).resolves.toMatchObject({ id: theirs.id });
  });

  it("limits the dashboard summary to own sales unless the user has branch-wide access", async () => {
    await sell(cashierScope, shiftId, warehouseId, 1);
    await sell(cashier2Scope, shiftId, warehouseId, 2);
    const all = await sales.summary(cashierScope, viewAll);
    expect(all.today.count).toBe(2);
    expect(all.recent).toHaveLength(2);
    const own = await sales.summary(cashierScope, ownOnly);
    expect(own.today).toEqual({ totalBob: "12.5000", count: 1 });
    expect(own.month.count).toBe(1);
    expect(own.month.units).toBe(1);
    expect(own.monthly.at(-1)!.count).toBe(1);
    expect(own.daily.at(-1)!.count).toBe(1);
    expect(own.recent.map((sale) => sale.cashierName)).toEqual(["Cajero Uno"]);
  });

  it("derives the access level from the granted permissions", () => {
    expect(resolveSalesAccess(["sales.confirm", "sales.read", "cash.manage"])).toEqual({ viewAll: false });
    expect(resolveSalesAccess(["sales.confirm"])).toEqual({ viewAll: false });
    expect(resolveSalesAccess(["sales.read", "cash.shift.approve"])).toEqual({ viewAll: true });
    expect(resolveSalesAccess(["sales.read", "catalog.manage"])).toEqual({ viewAll: true });
    expect(resolveSalesAccess(["cash.shift.approve"])).toEqual({ viewAll: false });
  });

  it("isolates branches and tenants with a 404", async () => {
    const sale = await sell(cashierScope, shiftId, warehouseId);
    await expect(sales.detail(branch2Scope, sale.id, viewAll)).rejects.toThrow(/not found/i);
    await expect(sales.detail(otherTenantScope, sale.id, viewAll)).rejects.toThrow(/not found/i);
    await expect(sales.detail(cashierScope, "not-a-uuid", viewAll)).rejects.toThrow(/not found/i);
    expect((await sales.list(branch2Scope, {}, viewAll)).total).toBe(0);
    expect((await sales.list(otherTenantScope, {}, viewAll)).total).toBe(0);
  });

  it("returns the full detail needed for a receipt", async () => {
    const sale = await sell(cashierScope, shiftId, warehouseId, 3, [
      { method: "QR", amountBob: "7.5000", reference: "QR-9" },
      { method: "CASH", amountBob: "40.0000" }
    ]);
    const detail = await sales.detail(cashierScope, sale.id, viewAll);
    expect(detail).toMatchObject({
      id: sale.id,
      number: "V-MAIN-000001",
      status: "CONFIRMED",
      totalBob: "37.5000",
      paidAmountBob: "47.5000",
      changeAmountBob: "10.0000",
      cashier: { id: userId, name: "Cajero Uno" },
      shift: { id: shiftId, registerCode: "CAJA-1" },
      branch: { id: branchId, code: "MAIN", name: "Central" },
      pharmacy: { name: "Farmacia Historia", legalName: "Farmacia Historia SRL", taxId: "7000601" },
      warehouse: { id: warehouseId, name: "Central" }
    });
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({
      productName: "Paracetamol 500 mg",
      presentationName: "Caja x 10",
      quantity: 3,
      quantityBase: 30,
      unitPriceBob: "12.5000",
      lineTotalBob: "37.5000"
    });
    expect(detail.items[0]!.allocations.map((a) => [a.lotCode, a.quantityBase, a.expiresOn.length])).toEqual([
      ["LOT-SOON", 20, 10],
      ["LOT-LATER", 10, 10]
    ]);
    // Payments come back ordered by method (CARD, CASH, QR).
    expect(detail.payments).toEqual([
      { method: "CASH", amountBob: "40.0000", reference: null, reversed: false },
      { method: "QR", amountBob: "7.5000", reference: "QR-9", reversed: false }
    ]);
  });
});
