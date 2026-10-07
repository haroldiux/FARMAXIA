import { ConflictException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
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

const tenantId = "00000000-0000-4000-8000-000000005001";
const legalEntityId = "00000000-0000-4000-8000-000000005002";
const branchId = "00000000-0000-4000-8000-000000005011";
const userId = "00000000-0000-4000-8000-000000005021";
const warehouseId = "00000000-0000-4000-8000-000000005031";
const productId = "00000000-0000-4000-8000-000000005041";
const presentationId = "00000000-0000-4000-8000-000000005042";
const batchSoonId = "00000000-0000-4000-8000-000000005051";
const batchLaterId = "00000000-0000-4000-8000-000000005052";
const registerId = "00000000-0000-4000-8000-000000005061";
const shiftId = "00000000-0000-4000-8000-000000005071";
const controlId = "00000000-0000-4000-8000-000000005081";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId, branchId };

/**
 * Confirma una venta real contra PostgreSQL. Cubre el error "inconsistent types deduced
 * for parameter $5" que impedía guardar las líneas de venta (cantidad bigint vs numeric).
 */
describe("F11 cash sale confirmation against the database", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'sales-pharmacy', 'Farmacia Ventas')", [tenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Ventas SRL', '7000501')", [legalEntityId, tenantId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [branchId, tenantId, legalEntityId]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'cajero-ventas@example.test', 'Cajero', 'x')", [userId]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [userId, tenantId, branchId]);
    await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')", [warehouseId, tenantId, branchId]);
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Paracetamol 500 mg')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 10', 10)",
      [presentationId, tenantId, productId]
    );
    await ownerPool.query("insert into price_lists (id, tenant_id, name, currency) values ($1, $2, 'General', 'BOB')", ["00000000-0000-4000-8000-000000000f01", tenantId]);
    await ownerPool.query(
      "insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values ($1, $2, $3, 12.5000, now() - interval '1 day')",
      [tenantId, "00000000-0000-4000-8000-000000000f01", presentationId]
    );
    await ownerPool.query(
      `insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values
         ($1, $3, $4, 'LOT-SOON', current_date + 60, 5.0000),
         ($2, $3, $4, 'LOT-LATER', current_date + 400, 5.0000)`,
      [batchSoonId, batchLaterId, tenantId, presentationId]
    );
    await ownerPool.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base)
       values ($1, $2, $3, 20, 0), ($1, $2, $4, 50, 0)`,
      [tenantId, warehouseId, batchSoonId, batchLaterId]
    );
    await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)", [registerId, tenantId, branchId]);
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
      [shiftId, tenantId, branchId, registerId, userId]
    );
    await ownerPool.query("insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)", [tenantId, branchId, shiftId, userId]);
    await ownerPool.query(
      `insert into cash_shift_controls (id, tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
       values ($1, $2, $3, $4, '100.0000', '100.0000', 'OPEN', $5, now())`,
      [controlId, tenantId, branchId, shiftId, userId]
    );
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("stores the sale lines, consumes stock FEFO and updates the expected cash", async () => {
    const sale = await sales.confirm(scope, {
      idempotencyKey: "sale-db-001",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "37.5000",
      lines: [{ presentationId, quantity: 3, unitPriceBob: "12.5000" }]
    });

    expect(sale.status).toBe("CONFIRMED");
    expect(Number(sale.totalBob)).toBe(37.5);
    expect(sale.items[0]).toMatchObject({ quantity: 3, quantityBase: 30 });
    expect(Number(sale.items[0]!.lineTotalBob)).toBe(37.5);
    // FEFO: primero se vacía el lote que vence antes (20) y el resto sale del siguiente (10).
    expect(sale.items[0]!.allocations.map((allocation) => [allocation.lotCode, allocation.quantityBase])).toEqual([
      ["LOT-SOON", 20],
      ["LOT-LATER", 10]
    ]);

    const balances = await ownerPool.query<{ lot: string; quantity: string }>(
      `select b.lot_code as lot, ib.quantity_base::text as quantity from inventory_balances ib
       join inventory_batches b on b.id = ib.batch_id where ib.warehouse_id = $1 order by b.expires_on`,
      [warehouseId]
    );
    expect(balances.rows).toEqual([{ lot: "LOT-SOON", quantity: "0" }, { lot: "LOT-LATER", quantity: "40" }]);
    const control = await ownerPool.query<{ expected: string }>("select expected_amount_bob::text as expected from cash_shift_controls where id = $1", [controlId]);
    expect(Number(control.rows[0]!.expected)).toBe(137.5);
  });

  it("snapshots the presentation average cost per base unit on each sale line (null when it has no cost)", async () => {
    await ownerPool.query(
      "insert into presentation_costs (tenant_id, presentation_id, average_unit_cost, last_unit_cost) values ($1, $2, 0.625, 0.625)",
      [tenantId, presentationId]
    );
    await sales.confirm(scope, {
      idempotencyKey: "sale-db-cost-snapshot",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "25.0000",
      lines: [{ presentationId, quantity: 2, unitPriceBob: "12.5000" }]
    });
    // A later cost change must not rewrite the snapshot of the already confirmed sale.
    await ownerPool.query("update presentation_costs set average_unit_cost = 9 where tenant_id = $1 and presentation_id = $2", [tenantId, presentationId]);
    const withCost = await ownerPool.query<{ cost: string }>("select unit_cost_base_bob::text as cost from sale_items where tenant_id = $1", [tenantId]);
    expect(withCost.rows.map((row) => Number(row.cost))).toEqual([0.625]);

    await ownerPool.query("delete from presentation_costs where tenant_id = $1", [tenantId]);
    await sales.confirm(scope, {
      idempotencyKey: "sale-db-no-cost",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "12.5000",
      lines: [{ presentationId, quantity: 1, unitPriceBob: "12.5000" }]
    });
    const all = await ownerPool.query<{ cost: string | null }>("select unit_cost_base_bob::text as cost from sale_items where tenant_id = $1 order by created_at", [tenantId]);
    expect(all.rows.map((row) => (row.cost === null ? null : Number(row.cost)))).toEqual([0.625, null]);
  });

  it("summarizes today, the month, the charts and the recent sales of the branch", async () => {
    const empty = await sales.summary(scope, { viewAll: true });
    expect(empty.today).toEqual({ totalBob: "0", count: 0 });
    expect(empty.monthly).toHaveLength(8);
    expect(empty.daily).toHaveLength(14);

    await sales.confirm(scope, {
      idempotencyKey: "sale-db-summary",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "37.5000",
      lines: [{ presentationId, quantity: 3, unitPriceBob: "12.5000" }]
    });
    const summary = await sales.summary(scope, { viewAll: true });
    expect(summary.today.count).toBe(1);
    expect(Number(summary.today.totalBob)).toBe(37.5);
    expect(summary.month).toMatchObject({ count: 1, units: 3, averageTicketBob: "37.50" });
    expect(Number(summary.monthly.at(-1)!.totalBob)).toBe(37.5);
    expect(summary.daily.at(-1)!.count).toBe(1);
    expect(summary.recent).toHaveLength(1);
    expect(summary.recent[0]).toMatchObject({ items: 1, cashierName: "Cajero" });
  });

  it("rejects a payment that does not match the exact total without moving stock", async () => {
    await expect(
      sales.confirm(scope, {
        idempotencyKey: "sale-db-002",
        cashShiftId: shiftId,
        warehouseId,
        paymentMethod: "CASH",
        paidAmountBob: "30.0000",
        lines: [{ presentationId, quantity: 3, unitPriceBob: "12.5000" }]
      })
    ).rejects.toThrow(/cover the sale total/);
    const total = await ownerPool.query<{ sum: string }>("select sum(quantity_base)::text as sum from inventory_balances where warehouse_id = $1", [warehouseId]);
    expect(total.rows[0]!.sum).toBe("70");
  });

  it("records mixed CASH, CARD and QR payments and counts only net cash in the shift", async () => {
    const sale = await sales.confirm(scope, {
      idempotencyKey: "sale-db-mixed",
      cashShiftId: shiftId,
      warehouseId,
      payments: [
        { method: "CARD", amountBob: "10.0000", reference: "AUTH-123" },
        { method: "QR", amountBob: "7.5000", reference: "QR-9" },
        { method: "CASH", amountBob: "30.0000" }
      ],
      lines: [{ presentationId, quantity: 3, unitPriceBob: "12.5000" }]
    });
    expect(sale.totalBob).toBe("37.5000");
    expect(sale.paidAmountBob).toBe("47.5000");
    expect(sale.changeAmountBob).toBe("10.0000");
    expect(sale.payments.map((payment) => payment.method)).toEqual(["CARD", "QR", "CASH"]);

    const rows = await ownerPool.query<{ method: string; amount: string; reference: string | null }>(
      "select method, amount_bob::text as amount, reference from sale_payments where sale_id = $1 order by method",
      [sale.id]
    );
    expect(rows.rows).toEqual([
      { method: "CARD", amount: "10.0000", reference: "AUTH-123" },
      { method: "CASH", amount: "30.0000", reference: null },
      { method: "QR", amount: "7.5000", reference: "QR-9" }
    ]);
    const saleRow = await ownerPool.query<{ change: string }>("select change_amount_bob::text as change from sales where id = $1", [sale.id]);
    expect(saleRow.rows[0]!.change).toBe("10.0000");
    // Opening 100 + cash received 30 - change 10 = 120 (card/QR never enter the drawer).
    const control = await ownerPool.query<{ expected: string }>("select expected_amount_bob::text as expected from cash_shift_controls where id = $1", [controlId]);
    expect(Number(control.rows[0]!.expected)).toBe(120);
  });

  it("rejects underpayment and card overpayment without moving stock", async () => {
    await expect(
      sales.confirm(scope, {
        idempotencyKey: "sale-db-under",
        cashShiftId: shiftId,
        warehouseId,
        payments: [{ method: "QR", amountBob: "30.0000", reference: "Q" }],
        lines: [{ presentationId, quantity: 3, unitPriceBob: "12.5000" }]
      })
    ).rejects.toThrow(/cover the sale total/);
    await expect(
      sales.confirm(scope, {
        idempotencyKey: "sale-db-over",
        cashShiftId: shiftId,
        warehouseId,
        payments: [{ method: "CARD", amountBob: "40.0000", reference: "A" }],
        lines: [{ presentationId, quantity: 3, unitPriceBob: "12.5000" }]
      })
    ).rejects.toThrow(/card or qr/i);
    const total = await ownerPool.query<{ sum: string }>("select sum(quantity_base)::text as sum from inventory_balances where warehouse_id = $1", [warehouseId]);
    expect(total.rows[0]!.sum).toBe("70");
  });

  it("charges the list price when the client omits the unit price", async () => {
    const sale = await sales.confirm(scope, {
      idempotencyKey: "sale-price-omitted",
      cashShiftId: shiftId,
      warehouseId,
      payments: [{ method: "CASH", amountBob: "25.0000" }],
      lines: [{ presentationId, quantity: 2 }]
    });
    expect(sale.totalBob).toBe("25.0000");
    expect(sale.items[0]).toMatchObject({ unitPriceBob: "12.5000", lineTotalBob: "25.0000" });
    const stored = await ownerPool.query<{ price: string }>("select unit_price_bob::text as price from sale_items where sale_id = $1", [sale.id]);
    expect(stored.rows[0]!.price).toBe("12.5000");
  });

  it("rejects a tampered unit price with PRICE_CHANGED and moves nothing", async () => {
    const error = await sales
      .confirm(scope, {
        idempotencyKey: "sale-price-tampered",
        cashShiftId: shiftId,
        warehouseId,
        payments: [{ method: "CASH", amountBob: "1.0000" }],
        lines: [{ presentationId, quantity: 2, unitPriceBob: "0.5000" }]
      })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "PRICE_CHANGED",
      presentationId,
      currentPriceBob: "12.5000"
    });
    const count = await ownerPool.query<{ n: string }>("select count(*)::text as n from sales");
    expect(count.rows[0]!.n).toBe("0");
    const stock = await ownerPool.query<{ sum: string }>("select sum(quantity_base)::text as sum from inventory_balances where warehouse_id = $1", [warehouseId]);
    expect(stock.rows[0]!.sum).toBe("70");
  });

  it("rejects a sale of a presentation without a current price with PRICE_NOT_FOUND", async () => {
    await ownerPool.query("delete from presentation_prices where presentation_id = $1", [presentationId]);
    const error = await sales
      .confirm(scope, {
        idempotencyKey: "sale-price-missing",
        cashShiftId: shiftId,
        warehouseId,
        payments: [{ method: "CASH", amountBob: "25.0000" }],
        lines: [{ presentationId, quantity: 2, unitPriceBob: "12.5000" }]
      })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: "PRICE_NOT_FOUND", presentationId });
  });
});
