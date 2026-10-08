import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS_KEY } from "../src/auth/auth.decorators.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { systemRoles } from "../src/identity/role-templates.js";
import { SalesController } from "../src/sales/sales.controller.js";
import { SalesService } from "../src/sales/sales.service.js";

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

const id = (n: number) => `00000000-0000-4000-8000-0000000071${String(n).padStart(2, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchId = id(3);
const branch2Id = id(4);
const cashierId = id(10);
const supervisorId = id(11);
const branch2UserId = id(12);
const warehouseId = id(20);
const productId = id(30);
const presentationId = id(31);
const batchSoonId = id(40);
const batchLaterId = id(41);
const registerId = id(50);
const shiftId = id(60);
const otherTenantId = id(70);
const otherLegalEntityId = id(71);
const otherBranchId = id(72);
const otherUserId = id(73);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const cashierScope: TenantScope = { tenantId, userId: cashierId, branchId };
const supervisorScope: TenantScope = { tenantId, userId: supervisorId, branchId };
const branch2Scope: TenantScope = { tenantId, userId: branch2UserId, branchId: branch2Id };
const otherTenantScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };
const viewAll = { viewAll: true };
const ownOnly = { viewAll: false };

let counter = 0;
const key = () => `returns-${++counter}`;

async function sell(
  quantity = 3,
  payments?: Array<{ method: string; amountBob: string; reference?: string }>
) {
  const total = (quantity * 12.5).toFixed(4);
  return sales.confirm(cashierScope, {
    idempotencyKey: key(),
    cashShiftId: shiftId,
    warehouseId,
    payments: payments ?? [{ method: "CASH", amountBob: total }],
    lines: [{ presentationId, quantity, unitPriceBob: "12.5000" }]
  });
}

async function expectedCash(): Promise<string> {
  const result = await ownerPool.query<{ v: string }>(
    "select expected_amount_bob::text as v from cash_shift_controls where cash_shift_id = $1",
    [shiftId]
  );
  return result.rows[0]!.v;
}

async function stock(): Promise<Record<string, number>> {
  const result = await ownerPool.query<{ lot: string; q: string }>(
    `select b.lot_code as lot, ib.quantity_base::text as q from inventory_balances ib
     join inventory_batches b on b.id = ib.batch_id order by b.lot_code`
  );
  return Object.fromEntries(result.rows.map((row) => [row.lot, Number(row.q)]));
}

async function itemId(saleId: string): Promise<string> {
  const detail = await sales.detail(cashierScope, saleId, viewAll);
  return detail.items[0]!.id;
}

function returnInput(saleItemId: string, quantity: number, overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: key(),
    reason: "Cliente se arrepintio",
    refundMethod: "CASH",
    restock: true,
    lines: [{ saleItemId, quantity }],
    ...overrides
  } as Parameters<SalesService["registerReturn"]>[2];
}

describe("Module 5 T5 voids and returns", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    counter = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, 'ret-pharmacy', 'Farmacia Devoluciones'), ($2, 'ret-other', 'Otra')",
      [tenantId, otherTenantId]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Devoluciones SRL', '7000701'), ($3, $4, 'Otra SRL', '7000702')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name) values
         ($1, $2, $3, 'MAIN', 'Central'), ($4, $2, $3, 'NORTH', 'Norte'), ($5, $6, $7, 'MAIN', 'Otra Central')`,
      [branchId, tenantId, legalEntityId, branch2Id, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash) values
         ($1, 'ret1@example.test', 'Cajero Uno', 'x'), ($2, 'ret2@example.test', 'Supervisor', 'x'),
         ($3, 'ret3@example.test', 'Norte', 'x'), ($4, 'ret4@example.test', 'Otro', 'x')`,
      [cashierId, supervisorId, branch2UserId, otherUserId]
    );
    await ownerPool.query(
      `insert into user_branch_memberships (user_id, tenant_id, branch_id)
       values ($1, $5, $6), ($2, $5, $6), ($3, $5, $7), ($4, $8, $9)`,
      [cashierId, supervisorId, branch2UserId, otherUserId, tenantId, branchId, branch2Id, otherTenantId, otherBranchId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')",
      [warehouseId, tenantId, branchId]
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
       values ($1, $2, $3, 20, 0), ($1, $2, $4, 50, 0)`,
      [tenantId, warehouseId, batchSoonId, batchLaterId]
    );
    await ownerPool.query(
      "insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)",
      [registerId, tenantId, branchId]
    );
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
      [shiftId, tenantId, branchId, registerId, cashierId]
    );
    await ownerPool.query(
      "insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)",
      [tenantId, branchId, shiftId, cashierId]
    );
    await ownerPool.query(
      `insert into cash_shift_controls (tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
       values ($1, $2, $3, '100.0000', '100.0000', 'OPEN', $4, now())`,
      [tenantId, branchId, shiftId, cashierId]
    );
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("voids a sale: exact batches and drawer cash restored, card payment marked reversed", async () => {
    const sale = await sell(3, [
      { method: "CARD", amountBob: "10.0000", reference: "POS-1" },
      { method: "CASH", amountBob: "30.0000" }
    ]);
    expect(await stock()).toEqual({ "LOT-LATER": 40, "LOT-SOON": 0 });
    expect(await expectedCash()).toBe("127.5000");

    const voided = await sales.voidSale(supervisorScope, sale.id, { idempotencyKey: key(), reason: "  Error de digitacion " }, viewAll);
    expect(voided).toMatchObject({ id: sale.id, status: "VOIDED", reason: "Error de digitacion" });

    expect(await stock()).toEqual({ "LOT-LATER": 50, "LOT-SOON": 20 });
    expect(await expectedCash()).toBe("100.0000");
    const movements = await ownerPool.query(
      "select movement_direction, quantity_base::int as q, reference_id from inventory_movements where movement_type = 'SALE_VOID' order by quantity_base"
    );
    expect(movements.rows.map((row) => [row.movement_direction, row.q, row.reference_id])).toEqual([
      ["IN", 10, sale.id],
      ["IN", 20, sale.id]
    ]);

    const detail = await sales.detail(cashierScope, sale.id, viewAll);
    expect(detail.status).toBe("VOIDED");
    expect(detail.void).toMatchObject({ reason: "Error de digitacion", byUserId: supervisorId, byName: "Supervisor" });
    expect(detail.payments.map((p) => [p.method, p.reversed])).toEqual([["CARD", true], ["CASH", false]]);
    expect((await sales.list(cashierScope, { status: "VOIDED" }, viewAll)).items.map((item) => item.id)).toEqual([sale.id]);

    const audit = await ownerPool.query("select payload from audit_events where action = 'sales.sale_voided'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload).toMatchObject({ reason: "Error de digitacion" });
    const outbox = await ownerPool.query("select 1 from outbox_events where event_type = 'sales.sale_voided'");
    expect(outbox.rows).toHaveLength(1);
  });

  it("rejects voids when the shift is closed, the sale was already voided or already has returns", async () => {
    const closedSale = await sell(1);
    const returned = await sell(2);
    const twice = await sell(1);
    await sales.registerReturn(
      supervisorScope,
      returned.id,
      returnInput(await itemId(returned.id), 1, { refundMethod: "CARD", refundReference: "R-1" }),
      viewAll
    );
    await expect(sales.voidSale(supervisorScope, returned.id, { idempotencyKey: key(), reason: "x" }, viewAll)).rejects.toThrow(/cannot be voided/i);

    await sales.voidSale(supervisorScope, twice.id, { idempotencyKey: key(), reason: "x" }, viewAll);
    await expect(sales.voidSale(supervisorScope, twice.id, { idempotencyKey: key(), reason: "x" }, viewAll)).rejects.toThrow(/cannot be voided/i);

    await expect(sales.voidSale(supervisorScope, closedSale.id, { idempotencyKey: key(), reason: "" }, viewAll)).rejects.toThrow(/reason/i);
    await expect(
      sales.voidSale(supervisorScope, closedSale.id, { idempotencyKey: key(), reason: "x".repeat(201) }, viewAll)
    ).rejects.toThrow(/reason/i);

    await ownerPool.query("update cash_shift_controls set status = 'PENDING_APPROVAL' where cash_shift_id = $1", [shiftId]);
    await expect(sales.voidSale(supervisorScope, closedSale.id, { idempotencyKey: key(), reason: "late" }, viewAll)).rejects.toThrow(/open cash shift/i);
    expect((await sales.detail(cashierScope, closedSale.id, viewAll)).status).toBe("CONFIRMED");
  });

  it("protects voids and returns with sales.void, granted to owner, regente and encargado but not cajero", () => {
    const perms = (name: "voidSale" | "registerReturn") =>
      Reflect.getMetadata(PERMISSIONS_KEY, SalesController.prototype[name] as object) as string[];
    expect(perms("voidSale")).toEqual(["sales.void"]);
    expect(perms("registerReturn")).toEqual(["sales.void"]);
    const withVoid = systemRoles
      .filter((role) => (role.permissions as readonly string[]).includes("sales.void"))
      .map((role) => role.code)
      .sort();
    expect(withVoid).toEqual(["encargado", "owner", "regente"]);
  });

  it("replays a void idempotently without restoring stock twice", async () => {
    const sale = await sell(3);
    const input = { idempotencyKey: "void-replay", reason: "Duplicada" };
    const first = await sales.voidSale(supervisorScope, sale.id, input, viewAll);
    const replay = await sales.voidSale(supervisorScope, sale.id, input, viewAll);
    expect(replay).toEqual(first);
    expect(await stock()).toEqual({ "LOT-LATER": 50, "LOT-SOON": 20 });
    await expect(
      sales.voidSale(supervisorScope, sale.id, { idempotencyKey: "void-replay", reason: "Otra" }, viewAll)
    ).rejects.toMatchObject({ response: { code: "IDEMPOTENCY_KEY_REUSED" } });
  });

  it("registers a partial then a full return restoring original batches, refund cash and numbering", async () => {
    const sale = await sell(3);
    const item = await itemId(sale.id);
    expect(await expectedCash()).toBe("137.5000");

    const first = await sales.registerReturn(cashierScope, sale.id, returnInput(item, 1), viewAll);
    expect(first).toMatchObject({
      returnNumber: "D-MAIN-000001",
      saleStatus: "PARTIALLY_RETURNED",
      refundMethod: "CASH",
      refundAmountBob: "12.5000",
      restock: true
    });
    // Latest-consumed batch first: the unit goes back to LOT-LATER.
    expect(await stock()).toEqual({ "LOT-LATER": 50, "LOT-SOON": 0 });
    expect(await expectedCash()).toBe("125.0000");

    const second = await sales.registerReturn(cashierScope, sale.id, returnInput(item, 2), viewAll);
    expect(second).toMatchObject({ returnNumber: "D-MAIN-000002", saleStatus: "RETURNED", refundAmountBob: "25.0000" });
    expect(await stock()).toEqual({ "LOT-LATER": 50, "LOT-SOON": 20 });
    expect(await expectedCash()).toBe("100.0000");

    const detail = await sales.detail(cashierScope, sale.id, viewAll);
    expect(detail.status).toBe("RETURNED");
    expect(detail.returns.map((r) => [r.number, r.refundAmountBob, r.restock])).toEqual([
      ["D-MAIN-000001", "12.5000", true],
      ["D-MAIN-000002", "25.0000", true]
    ]);
    expect(detail.items[0]).toMatchObject({ quantity: 3, returnedQuantity: 3 });
    await expect(sales.voidSale(supervisorScope, sale.id, { idempotencyKey: key(), reason: "x" }, viewAll)).rejects.toThrow();
    const audit = await ownerPool.query("select 1 from audit_events where action = 'sales.sale_returned'");
    expect(audit.rows).toHaveLength(2);
    const outbox = await ownerPool.query("select 1 from outbox_events where event_type = 'sales.sale_returned'");
    expect(outbox.rows).toHaveLength(2);
  });

  it("rejects returning more than sold minus already returned", async () => {
    const sale = await sell(3);
    const item = await itemId(sale.id);
    await expect(sales.registerReturn(cashierScope, sale.id, returnInput(item, 4), viewAll)).rejects.toThrow(/exceeds/i);
    await sales.registerReturn(cashierScope, sale.id, returnInput(item, 2), viewAll);
    await expect(sales.registerReturn(cashierScope, sale.id, returnInput(item, 2), viewAll)).rejects.toThrow(/exceeds/i);
    await expect(sales.registerReturn(cashierScope, sale.id, returnInput(item, 0), viewAll)).rejects.toThrow(/quantity/i);
    expect(await expectedCash()).toBe("112.5000");
  });

  it("requires an open shift of the acting user and enough expected cash for CASH refunds", async () => {
    const sale = await sell(3);
    const item = await itemId(sale.id);
    await expect(sales.registerReturn(supervisorScope, sale.id, returnInput(item, 1), viewAll)).rejects.toThrow(/open cash shift/i);
    await ownerPool.query("update cash_shift_controls set expected_amount_bob = 5 where cash_shift_id = $1", [shiftId]);
    await expect(sales.registerReturn(cashierScope, sale.id, returnInput(item, 1), viewAll)).rejects.toMatchObject({
      response: { code: "CASH_REFUND_EXCEEDS_EXPECTED" }
    });
    expect(await stock()).toEqual({ "LOT-LATER": 40, "LOT-SOON": 0 });
    const none = await ownerPool.query("select 1 from sale_returns");
    expect(none.rows).toHaveLength(0);
  });

  it("refunds by CARD or QR without touching the drawer, requiring a reference", async () => {
    const sale = await sell(3);
    const item = await itemId(sale.id);
    await expect(
      sales.registerReturn(supervisorScope, sale.id, returnInput(item, 1, { refundMethod: "CARD" }), viewAll)
    ).rejects.toThrow(/reference/i);
    const done = await sales.registerReturn(
      supervisorScope,
      sale.id,
      returnInput(item, 1, { refundMethod: "QR", refundReference: "QR-77" }),
      viewAll
    );
    expect(done).toMatchObject({ refundMethod: "QR", refundReference: "QR-77", refundAmountBob: "12.5000" });
    expect(await expectedCash()).toBe("137.5000");
    await expect(
      sales.registerReturn(supervisorScope, sale.id, returnInput(item, 1, { refundMethod: "CRYPTO" }), viewAll)
    ).rejects.toThrow(/refund method/i);
  });

  it("keeps stock unchanged with restock=false and records the audit", async () => {
    const sale = await sell(3);
    const item = await itemId(sale.id);
    const done = await sales.registerReturn(cashierScope, sale.id, returnInput(item, 2, { restock: false }), viewAll);
    expect(done).toMatchObject({ restock: false, saleStatus: "PARTIALLY_RETURNED" });
    expect(await stock()).toEqual({ "LOT-LATER": 40, "LOT-SOON": 0 });
    const movements = await ownerPool.query("select 1 from inventory_movements where movement_type = 'SALE_RETURN'");
    expect(movements.rows).toHaveLength(0);
    const audit = await ownerPool.query("select payload from audit_events where action = 'sales.sale_returned'");
    expect(audit.rows[0].payload).toMatchObject({ restock: false, reason: "Cliente se arrepintio" });
    await expect(
      sales.registerReturn(cashierScope, sale.id, returnInput(item, 1, { restock: undefined }), viewAll)
    ).rejects.toThrow(/restock/i);
  });

  it("rejects restocking into a quarantined or expired batch but allows restock=false", async () => {
    const sale = await sell(3);
    const item = await itemId(sale.id);
    await ownerPool.query("update inventory_batches set status = 'QUARANTINED' where id = $1", [batchLaterId]);
    await expect(sales.registerReturn(cashierScope, sale.id, returnInput(item, 1), viewAll)).rejects.toThrow(/restock/i);
    expect(await stock()).toEqual({ "LOT-LATER": 40, "LOT-SOON": 0 });
    expect(await expectedCash()).toBe("137.5000");
    await expect(
      sales.registerReturn(cashierScope, sale.id, returnInput(item, 1, { restock: false }), viewAll)
    ).resolves.toMatchObject({ restock: false });
    await ownerPool.query("update inventory_batches set status = 'AVAILABLE' where id = $1", [batchLaterId]);
    // LOT-SOON (20 base consumed) expires: returning the 2 remaining units reaches it after LOT-LATER.
    await ownerPool.query("update inventory_batches set expires_on = current_date - 1 where id = $1", [batchSoonId]);
    await expect(sales.registerReturn(cashierScope, sale.id, returnInput(item, 2), viewAll)).rejects.toThrow(/restock/i);
  });

  it("replays a return idempotently", async () => {
    const sale = await sell(3);
    const item = await itemId(sale.id);
    const input = returnInput(item, 1, { idempotencyKey: "ret-replay" });
    const first = await sales.registerReturn(cashierScope, sale.id, input, viewAll);
    const replay = await sales.registerReturn(cashierScope, sale.id, input, viewAll);
    expect(replay).toEqual(first);
    expect(await expectedCash()).toBe("125.0000");
    const rows = await ownerPool.query("select 1 from sale_returns");
    expect(rows.rows).toHaveLength(1);
  });

  it("nets voids and returns out of the dashboard summary", async () => {
    const keep = await sell(2);
    const voidMe = await sell(4);
    await sales.voidSale(supervisorScope, voidMe.id, { idempotencyKey: key(), reason: "x" }, viewAll);
    const partial = await sell(3);
    await sales.registerReturn(cashierScope, partial.id, returnInput(await itemId(partial.id), 1), viewAll);
    const full = await sell(1);
    await sales.registerReturn(cashierScope, full.id, returnInput(await itemId(full.id), 1), viewAll);

    const summary = await sales.summary(cashierScope, viewAll);
    // keep 25.0 + partial (37.5 - 12.5) = 50.0; voided and fully returned sales do not count.
    expect(summary.today).toEqual({ totalBob: "50.0000", count: 2 });
    expect(summary.month.totalBob).toBe("50.0000");
    expect(summary.month.units).toBe(4);
    expect(summary.daily.at(-1)).toMatchObject({ totalBob: "50.0000", count: 2 });
    expect(summary.monthly.at(-1)).toMatchObject({ totalBob: "50.0000", count: 2 });
    expect(summary.recent.map((sale) => sale.id).sort()).toEqual([keep.id, partial.id].sort());
    expect((await sales.summary(supervisorScope, ownOnly)).today.count).toBe(0);
  });

  it("isolates voids and returns by branch and tenant with a 404", async () => {
    const sale = await sell(1);
    const item = await itemId(sale.id);
    for (const scope of [branch2Scope, otherTenantScope]) {
      await expect(sales.voidSale(scope, sale.id, { idempotencyKey: key(), reason: "x" }, viewAll)).rejects.toThrow(/not found/i);
      await expect(sales.registerReturn(scope, sale.id, returnInput(item, 1), viewAll)).rejects.toThrow(/not found/i);
    }
    await expect(sales.voidSale(supervisorScope, sale.id, { idempotencyKey: key(), reason: "x" }, ownOnly)).rejects.toThrow(/not found/i);
    await expect(sales.voidSale(supervisorScope, "not-a-uuid", { idempotencyKey: key(), reason: "x" }, viewAll)).rejects.toThrow(/not found/i);
    expect((await sales.detail(cashierScope, sale.id, viewAll)).status).toBe("CONFIRMED");
  });

  it("keeps return rows immutable and voided sales terminal at the database level", async () => {
    const sale = await sell(2);
    await sales.registerReturn(cashierScope, sale.id, returnInput(await itemId(sale.id), 1), viewAll);
    await expect(ownerPool.query("update sale_returns set reason = 'tamper'")).rejects.toThrow(/immutable/i);
    await expect(ownerPool.query("delete from sale_return_items")).rejects.toThrow(/immutable/i);
    const voidable = await sell(1);
    await sales.voidSale(supervisorScope, voidable.id, { idempotencyKey: key(), reason: "x" }, viewAll);
    await expect(ownerPool.query("update sales set status = 'CONFIRMED' where id = $1", [voidable.id])).rejects.toThrow(/terminal/i);
  });
});
