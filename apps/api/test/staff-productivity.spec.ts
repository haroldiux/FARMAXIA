import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { StaffProductivityService } from "../src/staff/staff-productivity.service.js";

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

const id = (n: number) => `00000000-0000-4000-8000-${String(940000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchId = id(11);
const otherBranchId = id(12);
const sellerA = id(21);
const sellerB = id(22);
const registerId = id(31);
const cashShiftId = id(32);
const warehouseId = id(33);
const productId = id(51);
const presentationOne = id(61);
const presentationTwo = id(62);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const productivity = new StaffProductivityService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId: sellerA, branchId };

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
const period = { from: isoDay(-3), to: isoDay(0) };

async function setPlan(planCode: string): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenantId]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query(
    "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
    [tenantId, plan.rows[0]!.id]
  );
}

let counter = 0;
async function insertSale(
  seller: string,
  lines: Array<{ presentationId: string; quantity: number; unitPrice: number }>,
  options: { status?: string; branch?: string } = {}
): Promise<{ saleId: string; itemIds: string[] }> {
  counter += 1;
  const status = options.status ?? "CONFIRMED";
  const branch = options.branch ?? branchId;
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const sale = await ownerPool.query<{ id: string }>(
    `insert into sales (tenant_id, branch_id, cash_shift_id, warehouse_id, status, total_amount_bob, paid_amount_bob, sale_number,
                        created_by_user_id, created_at, voided_at, voided_by_user_id, void_reason)
     values ($1, $2, $3, $4, $5::varchar, $6, $6, $7, $8, now() - interval '1 day',
             case when $5::varchar = 'VOIDED' then now() end, case when $5::varchar = 'VOIDED' then $8::uuid end, case when $5::varchar = 'VOIDED' then 'Error' end)
     returning id`,
    [tenantId, branch, cashShiftId, warehouseId, status, total, `P-${counter}`, seller]
  );
  const itemIds: string[] = [];
  for (const line of lines) {
    const item = await ownerPool.query<{ id: string }>(
      `insert into sale_items (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob)
       values ($1, $2, $3, $4, $5, $5, $6, $7) returning id`,
      [tenantId, branch, sale.rows[0]!.id, line.presentationId, line.quantity, line.unitPrice, line.quantity * line.unitPrice]
    );
    itemIds.push(item.rows[0]!.id);
  }
  return { saleId: sale.rows[0]!.id, itemIds };
}

async function insertReturn(saleId: string, itemId: string, quantity: number, unitPrice: number): Promise<void> {
  counter += 1;
  const amount = quantity * unitPrice;
  const ret = await ownerPool.query<{ id: string }>(
    `insert into sale_returns (tenant_id, branch_id, sale_id, return_number, refund_method, refund_amount_bob, reason, restock, cash_shift_id, created_by_user_id)
     values ($1, $2, $3, $4, 'CASH', $5, 'Devolución', false, $6, $7) returning id`,
    [tenantId, branchId, saleId, `R-${counter}`, amount, cashShiftId, sellerA]
  );
  await ownerPool.query(
    `insert into sale_return_items (tenant_id, branch_id, sale_return_id, sale_item_id, quantity, quantity_base, unit_price_bob, line_total_bob)
     values ($1, $2, $3, $4, $5, $5, $6, $7)`,
    [tenantId, branchId, ret.rows[0]!.id, itemId, quantity, unitPrice, amount]
  );
}

async function insertAttendance(user: string, hoursWorked: number | null): Promise<void> {
  // Starts yesterday 08:00 UTC, checked in right away; hoursWorked null leaves the shift open.
  await ownerPool.query(
    `insert into staff_shifts (tenant_id, branch_id, user_id, kind, starts_at, ends_at, checked_in_at, checked_out_at, created_by_user_id)
     values ($1, $2, $3, 'REGULAR', now() - interval '1 day 10 hours', now() - interval '1 day 2 hours',
             now() - interval '1 day 10 hours',
             case when $4::numeric is null then null else now() - interval '1 day 10 hours' + make_interval(hours => $4::numeric::int) end, $5)`,
    [tenantId, branchId, user, hoursWorked, sellerA]
  );
}

describe("F16 staff productivity (T4)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  beforeEach(async () => {
    counter = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'staff-prod', 'Farmacia Productividad')", [tenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Productividad SRL', '7009401')", [legalEntityId, tenantId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $3, $4, 'MAIN', 'Central'), ($2, $3, $4, 'SUR', 'Sur')", [branchId, otherBranchId, tenantId, legalEntityId]);
    await ownerPool.query(`insert into users (id, email, display_name, password_hash) values ($1, 'prod-a@example.test', 'Ana Vendedora', 'x'), ($2, 'prod-b@example.test', 'Beto Vendedor', 'x')`, [sellerA, sellerB]);
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $3, $4), ($1, $3, $5), ($2, $3, $5)",
      [sellerA, sellerB, tenantId, branchId, otherBranchId]
    );
    await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')", [warehouseId, tenantId, branchId]);
    await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)", [registerId, tenantId, branchId]);
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '30 days', now() + interval '8 hours', 'SCHEDULED', $5)`,
      [cashShiftId, tenantId, branchId, registerId, sellerA]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Producto Uno')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $3, $4, 'Caja x 10', 10), ($2, $3, $4, 'Blister', 1)",
      [presentationOne, presentationTwo, tenantId, productId]
    );

    // Seller A: sale 1 (2x50 + 1x40, one 50 unit returned), sale 2 (20), one voided sale. Seller B: one 40 sale.
    const first = await insertSale(sellerA, [
      { presentationId: presentationOne, quantity: 2, unitPrice: 50 },
      { presentationId: presentationTwo, quantity: 1, unitPrice: 40 }
    ], { status: "PARTIALLY_RETURNED" });
    await insertReturn(first.saleId, first.itemIds[0]!, 1, 50);
    await insertSale(sellerA, [{ presentationId: presentationTwo, quantity: 1, unitPrice: 20 }]);
    await insertSale(sellerA, [{ presentationId: presentationOne, quantity: 9, unitPrice: 50 }], { status: "VOIDED" });
    await insertSale(sellerB, [{ presentationId: presentationTwo, quantity: 1, unitPrice: 40 }]);
    await setPlan("PROFESIONAL");
  });

  it("computes sales, net, units, average ticket, returns and voids per seller", async () => {
    const report = await productivity.report(scope, period);
    const ana = report.sellers.find((s) => s.userId === sellerA)!;
    expect(ana).toMatchObject({
      userName: "Ana Vendedora",
      salesCount: 2,
      netSalesBob: "110.00",
      units: 3,
      averageTicketBob: "55.00",
      returnsCount: 1,
      returnsBob: "50.00",
      voidsCount: 1,
      hoursWorked: 0,
      salesPerHourBob: null
    });
    const beto = report.sellers.find((s) => s.userId === sellerB)!;
    expect(beto).toMatchObject({ salesCount: 1, netSalesBob: "40.00", units: 1, averageTicketBob: "40.00", returnsCount: 0, returnsBob: "0.00", voidsCount: 0 });
    expect(report.sellers.map((s) => s.userName)).toEqual(["Ana Vendedora", "Beto Vendedor"]);
  });

  it("adds hours worked and sales per hour from completed check-ins when staff.shifts is enabled", async () => {
    await insertAttendance(sellerA, 4);
    await insertAttendance(sellerA, null); // still open: ignored
    const report = await productivity.report(scope, period);
    expect(report.hoursAvailable).toBe(true);
    const ana = report.sellers.find((s) => s.userId === sellerA)!;
    expect(ana.hoursWorked).toBe(4);
    expect(ana.salesPerHourBob).toBe("27.50");
    expect(report.sellers.find((s) => s.userId === sellerB)!.hoursWorked).toBe(0);
    expect(report.sellers.find((s) => s.userId === sellerB)!.salesPerHourBob).toBeNull();
  });

  it("returns null hours on plans without staff.shifts but still reports sales", async () => {
    await insertAttendance(sellerA, 4);
    await setPlan("BASICO");
    const report = await productivity.report(scope, period);
    expect(report.hoursAvailable).toBe(false);
    const ana = report.sellers.find((s) => s.userId === sellerA)!;
    expect(ana.hoursWorked).toBeNull();
    expect(ana.salesPerHourBob).toBeNull();
    expect(ana.netSalesBob).toBe("110.00");
  });

  it("scopes the report to the active branch and validates the period", async () => {
    await insertSale(sellerA, [{ presentationId: presentationTwo, quantity: 1, unitPrice: 999 }], { branch: otherBranchId }).catch(() => undefined);
    const inOtherBranch = await productivity.report({ tenantId, userId: sellerA, branchId: otherBranchId }, period);
    expect(inOtherBranch.sellers).toEqual([]);
    const error = await productivity.report(scope, { from: "bad", to: period.to }).then(
      () => null,
      (caught: unknown) => caught as { getResponse: () => { field: string } }
    );
    expect(error!.getResponse().field).toBe("from");
    const empty = await productivity.report(scope, { from: isoDay(-400), to: isoDay(-300) });
    expect(empty.sellers).toEqual([]);
  });
});
