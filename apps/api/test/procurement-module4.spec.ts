import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { PayablesService } from "../src/procurement/payables.service.js";
import { ProcurementService } from "../src/procurement/procurement.service.js";
import { ReorderService } from "../src/procurement/reorder.service.js";

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

const tenantId = "00000000-0000-4000-8000-000000006001";
const legalEntityId = "00000000-0000-4000-8000-000000006002";
const branchId = "00000000-0000-4000-8000-000000006011";
const userId = "00000000-0000-4000-8000-000000006021";
const warehouseId = "00000000-0000-4000-8000-000000006031";
const supplierId = "00000000-0000-4000-8000-000000006041";
const productId = "00000000-0000-4000-8000-000000006051";
const presentationId = "00000000-0000-4000-8000-000000006052";
const registerId = "00000000-0000-4000-8000-000000006061";
const shiftId = "00000000-0000-4000-8000-000000006071";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const procurement = new ProcurementService(database);
const payables = new PayablesService(database);
const reorder = new ReorderService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId, branchId };

async function createOrder(quantityBase: number, unitCost = "2.0000"): Promise<string> {
  const created = await procurement.createPurchaseOrder(scope, {
    supplierId,
    warehouseId,
    lines: [{ presentationId, quantityBase, unitCost }]
  });
  return created.id;
}

async function receive(orderId: string, key: string, lotCode: string, quantityBase: number, unitCost: string): Promise<string> {
  const result = await procurement.receive(scope, {
    idempotencyKey: key,
    supplierId,
    purchaseOrderId: orderId,
    warehouseId,
    receivedAt: new Date().toISOString(),
    lines: [{ presentationId, lotCode, expiresOn: "2030-12-31", quantityBase, unitCost }]
  });
  return result.receiptId;
}

async function status(orderId: string): Promise<string> {
  const result = await ownerPool.query<{ status: string }>("select status from purchase_orders where id = $1", [orderId]);
  return result.rows[0]!.status;
}

describe("módulo 4: compras, pagos, costo promedio y reposición", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'm4-pharmacy', 'Farmacia M4')", [tenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia M4 SRL', '7000601')", [legalEntityId, tenantId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [branchId, tenantId, legalEntityId]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'compras@example.test', 'Compras', 'x')", [userId]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [userId, tenantId, branchId]);
    await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')", [warehouseId, tenantId, branchId]);
    await ownerPool.query("insert into suppliers (id, tenant_id, name, tax_id) values ($1, $2, 'Droguería Sur', '123')", [supplierId, tenantId]);
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Ibuprofeno 400 mg')", [productId, tenantId]);
    await ownerPool.query("insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Tableta', 1)", [presentationId, tenantId, productId]);
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("cancela una orden sin recepciones y cierra el saldo de una recepción parcial", async () => {
    const pending = await createOrder(10);
    await expect(procurement.cancelPurchaseOrder(scope, pending, { reason: "x" })).rejects.toThrow(/motivo/);
    expect(await procurement.cancelPurchaseOrder(scope, pending, { reason: "El proveedor no tiene stock" })).toEqual({ id: pending, status: "CANCELED" });
    await expect(receive(pending, "m4-r-canceled", "L-X", 1, "2.0000")).rejects.toThrow(/Canceled or closed/);
    await expect(procurement.cancelPurchaseOrder(scope, pending, { reason: "Otra vez" })).rejects.toThrow(/ya está/);

    const partial = await createOrder(10);
    await receive(partial, "m4-r-partial", "L-1", 4, "2.0000");
    expect(await status(partial)).toBe("PARTIALLY_RECEIVED");
    expect(await procurement.cancelPurchaseOrder(scope, partial, { reason: "No enviarán el resto" })).toEqual({ id: partial, status: "CLOSED" });
    await expect(receive(partial, "m4-r-after-close", "L-2", 1, "2.0000")).rejects.toThrow(/Canceled or closed/);

    const orders = await procurement.listPurchaseOrders(scope);
    const closed = orders.items.find((order) => order.id === partial)!;
    expect(closed).toMatchObject({ status: "CLOSED", closeReason: "No enviarán el resto" });
    expect(closed.lines[0]).toMatchObject({ quantityBase: 10, receivedBase: 4 });

    const audit = await ownerPool.query<{ action: string }>("select action from audit_events where tenant_id = $1 and action like 'procurement.purchase_order%' order by occurred_at", [tenantId]);
    expect(audit.rows.map((row) => row.action)).toEqual(["procurement.purchase_order_canceled", "procurement.purchase_order_closed"]);
  });

  it("recalcula el costo promedio ponderado con cada recepción", async () => {
    const order = await createOrder(30);
    await receive(order, "m4-wac-1", "L-A", 10, "2.0000");
    let costs = await procurement.listCosts(scope);
    expect(costs.items[0]).toMatchObject({ presentationId, averageUnitCost: "2.0000", lastUnitCost: "2.0000" });

    // 10 unidades a 2.00 + 10 a 4.00 = promedio 3.00.
    await receive(order, "m4-wac-2", "L-B", 10, "4.0000");
    costs = await procurement.listCosts(scope);
    expect(costs.items[0]).toMatchObject({ averageUnitCost: "3.0000", lastUnitCost: "4.0000" });

    // 20 unidades a 3.00 + 10 a 6.00 = 120 / 30 = 4.00.
    await receive(order, "m4-wac-3", "L-C", 10, "6.0000");
    costs = await procurement.listCosts(scope);
    expect(costs.items[0]).toMatchObject({ averageUnitCost: "4.0000", lastUnitCost: "6.0000" });
  });

  it("registra pagos parciales y totales sin pasarse del saldo ni duplicar reintentos", async () => {
    const order = await createOrder(10);
    const receiptId = await receive(order, "m4-pay-r", "L-P", 10, "10.0000");
    const invoice = await procurement.createSupplierInvoice(scope, {
      idempotencyKey: "m4-inv",
      supplierId,
      goodsReceiptId: receiptId,
      invoiceNumber: "F-100",
      issuedOn: "2026-09-01",
      currency: "BOB",
      totalAmount: "100.0000",
      dueOn: "2099-01-01"
    });

    const first = await payables.registerPayment(scope, invoice.payableId, { idempotencyKey: "m4-pay-1", amount: "40", paidOn: "2026-09-10", method: "TRANSFER", reference: "OP-1" });
    expect(first).toMatchObject({ outstandingAmount: "60.0000", status: "PARTIAL" });
    const retried = await payables.registerPayment(scope, invoice.payableId, { idempotencyKey: "m4-pay-1", amount: "40", paidOn: "2026-09-10", method: "TRANSFER", reference: "OP-1" });
    expect(retried.paymentId).toBe(first.paymentId);
    await expect(payables.registerPayment(scope, invoice.payableId, { idempotencyKey: "m4-pay-2", amount: "70", paidOn: "2026-09-11", method: "CASH" })).rejects.toThrow(/supera el saldo/);
    await expect(payables.registerPayment(scope, invoice.payableId, { idempotencyKey: "m4-pay-3", amount: "10", paidOn: "2026-09-11", method: "BITCOIN" as never })).rejects.toThrow(/Método/);

    await payables.schedule(scope, invoice.payableId, "2026-10-05");
    let list = await payables.list(scope);
    expect(list.items[0]).toMatchObject({ status: "PARTIAL", paidAmount: "40.0000", scheduledOn: "2026-10-05", paymentCount: 1 });

    const last = await payables.registerPayment(scope, invoice.payableId, { idempotencyKey: "m4-pay-4", amount: "60.0000", paidOn: "2026-09-12", method: "CASH" });
    expect(last).toMatchObject({ outstandingAmount: "0.0000", status: "PAID" });
    await expect(payables.registerPayment(scope, invoice.payableId, { idempotencyKey: "m4-pay-5", amount: "1", paidOn: "2026-09-13", method: "CASH" })).rejects.toThrow(/ya está pagada/);
    await expect(payables.schedule(scope, invoice.payableId, "2026-10-10")).rejects.toThrow(/ya está pagada/);

    list = await payables.list(scope);
    expect(list.items[0]).toMatchObject({ status: "PAID", bucket: "paid", scheduledOn: null, paymentCount: 2 });
    expect(list.totals).toEqual([]);
    const payments = await payables.listPayments(scope, invoice.payableId);
    expect(payments.items.map((payment) => payment.amount)).toEqual(["60.0000", "40.0000"]);
    const audit = await ownerPool.query("select 1 from audit_events where tenant_id = $1 and action = 'procurement.supplier_payment_registered'", [tenantId]);
    expect(audit.rowCount).toBe(2);
  });

  it("sugiere reponer según la venta de 30 días, el stock libre y lo ya pedido", async () => {
    // Stock libre: 10 unidades a 2.00.
    const order = await createOrder(10);
    await receive(order, "m4-reorder-r", "L-R", 10, "2.0000");
    // 60 unidades vendidas en los últimos 30 días = 2 por día.
    await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)", [registerId, tenantId, branchId]);
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '20 days', now() + interval '1 day', 'SCHEDULED', $5)`,
      [shiftId, tenantId, branchId, registerId, userId]
    );
    for (const [daysAgo, quantity] of [[3, 25], [12, 35], [45, 500]] as const) {
      const sale = await ownerPool.query<{ id: string }>(
        `insert into sales (tenant_id, branch_id, cash_shift_id, warehouse_id, total_amount_bob, paid_amount_bob, created_by_user_id, created_at, sale_number)
         values ($1, $2, $3, $4, 0, 0, $5, now() - make_interval(days => $6), 'V-TEST-' || $6::text) returning id`,
        [tenantId, branchId, shiftId, warehouseId, userId, daysAgo]
      );
      await ownerPool.query(
        `insert into sale_items (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob)
         values ($1, $2, $3, $4, $5::bigint, $5::bigint, 5, 5 * $5::bigint)`,
        [tenantId, branchId, sale.rows[0]!.id, presentationId, quantity]
      );
    }

    let result = await reorder.suggestions(scope, 30);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ soldBase: 60, averageDailyBase: 2, availableBase: 10, incomingBase: 0, daysOfStock: 5, suggestedBase: 50, averageUnitCost: "2.0000", estimatedCost: "100.00", lastSupplierName: "Droguería Sur" });

    // Una orden abierta de 20 unidades descuenta lo sugerido.
    await createOrder(20);
    result = await reorder.suggestions(scope, 30);
    expect(result.items[0]).toMatchObject({ incomingBase: 20, suggestedBase: 30 });
    // Con 7 días de cobertura alcanza lo que hay y lo pedido.
    expect((await reorder.suggestions(scope, 7)).items).toEqual([]);
    await expect(reorder.suggestions(scope, 3)).rejects.toThrow(/7 y 120/);
  });
});
