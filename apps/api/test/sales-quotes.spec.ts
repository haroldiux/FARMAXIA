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

const id = (n: number) => `00000000-0000-4000-8000-0000000073${String(n).padStart(2, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchId = id(3);
const branch2Id = id(4);
const cashierId = id(10);
const otherBranchUserId = id(11);
const warehouseId = id(20);
const productId = id(30);
const presentationId = id(31);
const product2Id = id(32);
const presentation2Id = id(33);
const product3Id = id(34);
const unpricedPresentationId = id(35);
const batchId = id(40);
const registerId = id(50);
const shiftId = id(60);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const cashierScope: TenantScope = { tenantId, userId: cashierId, branchId };
const otherBranchScope: TenantScope = { tenantId, userId: otherBranchUserId, branchId: branch2Id };

let counter = 0;
const key = () => `quote-${++counter}`;

function createQuote(
  lines: Array<{ presentationId: string; quantity: number }> = [{ presentationId, quantity: 2 }],
  extra: Record<string, unknown> = {},
  scope: TenantScope = cashierScope
) {
  return sales.createQuote(scope, { idempotencyKey: key(), lines, ...extra } as Parameters<SalesService["createQuote"]>[1]);
}

function confirmFromQuote(quoteId: string | undefined, quantity = 2, extra: Record<string, unknown> = {}) {
  return sales.confirm(cashierScope, {
    idempotencyKey: key(),
    cashShiftId: shiftId,
    warehouseId,
    payments: [{ method: "CASH", amountBob: (quantity * 12.5).toFixed(4) }],
    lines: [{ presentationId, quantity }],
    ...(quoteId === undefined ? {} : { quoteId }),
    ...extra
  } as Parameters<SalesService["confirm"]>[1]);
}

async function stockBase(): Promise<number> {
  const result = await ownerPool.query<{ q: string }>(
    "select coalesce(sum(quantity_base), 0)::text as q from inventory_balances where warehouse_id = $1",
    [warehouseId]
  );
  return Number(result.rows[0]!.q);
}

async function expectedCash(): Promise<string> {
  const result = await ownerPool.query<{ e: string }>(
    "select expected_amount_bob::text as e from cash_shift_controls where cash_shift_id = $1",
    [shiftId]
  );
  return result.rows[0]!.e;
}

async function expire(quoteId: string): Promise<void> {
  await ownerPool.query("alter table sales_quotes disable trigger trg_sales_quotes_guard");
  await ownerPool.query("update sales_quotes set valid_until = now() - interval '1 minute' where id = $1", [quoteId]);
  await ownerPool.query("alter table sales_quotes enable trigger trg_sales_quotes_guard");
}

describe("Module 5 T7 quotes (proformas)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    counter = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'quote-pharmacy', 'Farmacia Proformas')", [tenantId]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Proformas SRL', '7000901')",
      [legalEntityId, tenantId]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name)
       values ($1, $3, $4, 'MAIN', 'Central'), ($2, $3, $4, 'SUR', 'Sur')`,
      [branchId, branch2Id, tenantId, legalEntityId]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash)
       values ($1, 'quote1@example.test', 'Cajero', 'x'), ($2, 'quote2@example.test', 'Cajero Sur', 'x')`,
      [cashierId, otherBranchUserId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $3, $5)",
      [cashierId, otherBranchUserId, tenantId, branchId, branch2Id]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')",
      [warehouseId, tenantId, branchId]
    );
    await ownerPool.query(
      "insert into products (id, tenant_id, name) values ($1, $4, 'Paracetamol 500 mg'), ($2, $4, 'Ibuprofeno 400 mg'), ($3, $4, 'Sin precio')",
      [productId, product2Id, product3Id, tenantId]
    );
    await ownerPool.query(
      `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor)
       values ($1, $4, $5, 'Caja x 10', 10), ($2, $4, $6, 'Caja x 10', 10), ($3, $4, $7, 'Caja x 10', 10)`,
      [presentationId, presentation2Id, unpricedPresentationId, tenantId, productId, product2Id, product3Id]
    );
    await ownerPool.query("insert into price_lists (id, tenant_id, name, currency) values ($1, $2, 'General', 'BOB')", [id(90), tenantId]);
    await ownerPool.query(
      `insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from)
       values ($1, $2, $3, 12.5000, now() - interval '1 day'), ($1, $2, $4, 20.0000, now() - interval '1 day')`,
      [tenantId, id(90), presentationId, presentation2Id]
    );
    await ownerPool.query(
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost, status) values ($1, $2, $3, 'LOT-1', current_date + 200, 5, 'AVAILABLE')",
      [batchId, tenantId, presentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 100, 0)",
      [tenantId, warehouseId, batchId]
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

  it("creates a quote with server prices, a per-branch number, 7 days of validity and no stock or cash effect", async () => {
    const quote = await createQuote(
      [{ presentationId, quantity: 2 }, { presentationId: presentation2Id, quantity: 1 }],
      { customerName: "  Maria Perez ", customerNote: "Entrega el viernes", unitPriceBob: "1.0000" }
    );
    expect(quote).toMatchObject({
      number: "P-MAIN-000001",
      status: "OPEN",
      customerName: "Maria Perez",
      customerNote: "Entrega el viernes",
      totalBob: "45.0000",
      pricesChanged: false
    });
    expect(quote.items).toEqual([
      expect.objectContaining({ presentationId, quantity: 2, quotedUnitPriceBob: "12.5000", lineTotalBob: "25.0000" }),
      expect.objectContaining({ presentationId: presentation2Id, quantity: 1, quotedUnitPriceBob: "20.0000", lineTotalBob: "20.0000" })
    ]);
    const days = (new Date(quote.validUntil).getTime() - new Date(quote.createdAt).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect((await createQuote()).number).toBe("P-MAIN-000002");
    expect(await stockBase()).toBe(100);
    expect(await expectedCash()).toBe("100.0000");
    expect((await ownerPool.query("select 1 from inventory_movements")).rowCount).toBe(0);
    expect((await ownerPool.query("select 1 from sales")).rowCount).toBe(0);
    expect((await ownerPool.query("select reserved_base from inventory_balances where reserved_base <> 0")).rowCount).toBe(0);
  });

  it("accepts a custom validity of 1 to 30 days and rejects anything else", async () => {
    const quote = await createQuote(undefined, { validDays: 30 });
    const days = (new Date(quote.validUntil).getTime() - new Date(quote.createdAt).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.99);
    for (const validDays of [0, 31, 1.5, "7"]) {
      await expect(createQuote(undefined, { validDays })).rejects.toMatchObject({ status: 400 });
    }
  });

  it("validates lines, customer fields and the presentation", async () => {
    await expect(createQuote([])).rejects.toMatchObject({ status: 400 });
    await expect(createQuote([{ presentationId, quantity: 0 }])).rejects.toMatchObject({ status: 400 });
    await expect(createQuote(undefined, { customerName: "x".repeat(121) })).rejects.toMatchObject({ status: 400 });
    await expect(createQuote(undefined, { customerNote: "x".repeat(501) })).rejects.toMatchObject({ status: 400 });
    await expect(createQuote([{ presentationId: id(99), quantity: 1 }])).rejects.toMatchObject({ status: 404 });
    expect((await ownerPool.query("select 1 from sales_quotes")).rowCount).toBe(0);
  });

  it("rejects a line without a current price with 409 PRICE_NOT_FOUND", async () => {
    await expect(createQuote([{ presentationId, quantity: 1 }, { presentationId: unpricedPresentationId, quantity: 1 }])).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: "PRICE_NOT_FOUND", presentationId: unpricedPresentationId })
    });
    expect((await ownerPool.query("select 1 from sales_quotes")).rowCount).toBe(0);
  });

  it("lists with status and date filters and pagination", async () => {
    const first = await createQuote();
    const second = await createQuote();
    const third = await createQuote();
    await sales.cancelQuote(cashierScope, second.id, { idempotencyKey: key() });
    await expire(third.id);

    const all = await sales.listQuotes(cashierScope, {});
    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.number)).toEqual(["P-MAIN-000003", "P-MAIN-000002", "P-MAIN-000001"]);
    expect(all.items.map((item) => item.status)).toEqual(["EXPIRED", "CANCELED", "OPEN"]);
    expect((await sales.listQuotes(cashierScope, { status: "open" })).items.map((item) => item.id)).toEqual([first.id]);
    expect((await sales.listQuotes(cashierScope, { status: "CANCELED" })).items.map((item) => item.id)).toEqual([second.id]);
    expect((await sales.listQuotes(cashierScope, { status: "EXPIRED" })).items.map((item) => item.id)).toEqual([third.id]);
    expect((await sales.listQuotes(cashierScope, { status: "CONVERTED" })).total).toBe(0);
    await expect(sales.listQuotes(cashierScope, { status: "NOPE" })).rejects.toMatchObject({ status: 400 });

    expect((await sales.listQuotes(cashierScope, { from: "2000-01-01", to: "2100-01-01" })).total).toBe(3);
    expect((await sales.listQuotes(cashierScope, { from: "2100-01-01" })).total).toBe(0);
    await expect(sales.listQuotes(cashierScope, { from: "not-a-date" })).rejects.toMatchObject({ status: 400 });

    const page = await sales.listQuotes(cashierScope, { limit: 2, offset: 1 });
    expect(page).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(page.items.map((item) => item.number)).toEqual(["P-MAIN-000002", "P-MAIN-000001"]);
    expect(all.items[2]).toMatchObject({ totalBob: "25.0000", customerName: null, createdByName: "Cajero" });
  });

  it("returns the detail with current prices and flags price differences", async () => {
    const quote = await createQuote([{ presentationId, quantity: 2 }, { presentationId: presentation2Id, quantity: 1 }]);
    await ownerPool.query(
      "insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values ($1, $2, $3, 15.0000, now() - interval '1 second')",
      [tenantId, id(90), presentationId]
    );
    const detail = await sales.quoteDetail(cashierScope, quote.id);
    expect(detail).toMatchObject({
      id: quote.id,
      number: "P-MAIN-000001",
      status: "OPEN",
      totalBob: "45.0000",
      currentTotalBob: "50.0000",
      pricesChanged: true,
      branch: { code: "MAIN" },
      pharmacy: { name: "Farmacia Proformas" },
      createdBy: { id: cashierId, name: "Cajero" }
    });
    expect(detail.items[0]).toMatchObject({
      productName: "Paracetamol 500 mg",
      presentationName: "Caja x 10",
      quotedUnitPriceBob: "12.5000",
      currentUnitPriceBob: "15.0000",
      priceChanged: true,
      lineTotalBob: "25.0000",
      currentLineTotalBob: "30.0000"
    });
    expect(detail.items[1]).toMatchObject({ priceChanged: false, currentUnitPriceBob: "20.0000" });
    await expect(sales.quoteDetail(cashierScope, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
    await expect(sales.quoteDetail(cashierScope, id(98))).rejects.toMatchObject({ status: 404 });
  });

  it("cancels an open quote once, audits it and rejects a second cancel with QUOTE_NOT_OPEN", async () => {
    const quote = await createQuote();
    const canceled = await sales.cancelQuote(cashierScope, quote.id, { idempotencyKey: key() });
    expect(canceled).toMatchObject({ id: quote.id, status: "CANCELED" });
    expect((await sales.quoteDetail(cashierScope, quote.id)).status).toBe("CANCELED");
    await expect(sales.cancelQuote(cashierScope, quote.id, { idempotencyKey: key() })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: "QUOTE_NOT_OPEN" })
    });
    const audit = await ownerPool.query("select action from audit_events where action like 'sales.quote_%'");
    expect(audit.rows.map((row) => row.action).sort()).toEqual(["sales.quote_canceled", "sales.quote_created"]);
    const outbox = await ownerPool.query("select event_type from outbox_events where event_type like 'sales.quote_%'");
    expect(outbox.rows.map((row) => row.event_type).sort()).toEqual(["sales.quote_canceled", "sales.quote_created"]);
  });

  it("derives EXPIRED after valid_until and refuses to cancel an expired quote", async () => {
    const quote = await createQuote();
    await expire(quote.id);
    expect((await sales.quoteDetail(cashierScope, quote.id)).status).toBe("EXPIRED");
    await expect(sales.cancelQuote(cashierScope, quote.id, { idempotencyKey: key() })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: "QUOTE_NOT_OPEN" })
    });
  });

  it("converts through confirm: the sale uses current prices and the quote becomes CONVERTED atomically", async () => {
    const quote = await createQuote([{ presentationId, quantity: 2 }]);
    await ownerPool.query(
      "insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values ($1, $2, $3, 15.0000, now() - interval '1 second')",
      [tenantId, id(90), presentationId]
    );
    const confirmed = await sales.confirm(cashierScope, {
      idempotencyKey: key(),
      cashShiftId: shiftId,
      warehouseId,
      payments: [{ method: "CASH", amountBob: "30.0000" }],
      lines: [{ presentationId, quantity: 2 }],
      quoteId: quote.id
    } as Parameters<SalesService["confirm"]>[1]);
    expect(confirmed.totalBob).toBe("30.0000");
    const detail = await sales.quoteDetail(cashierScope, quote.id);
    expect(detail).toMatchObject({ status: "CONVERTED", convertedSaleId: confirmed.id, convertedSaleNumber: confirmed.saleNumber });
    expect(await stockBase()).toBe(80);
    const audit = await ownerPool.query("select entity_id, payload from audit_events where action = 'sales.quote_converted'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].entity_id).toBe(quote.id);
    expect(audit.rows[0].payload).toMatchObject({ saleId: confirmed.id });
  });

  it("accepts edited lines on conversion and replays the same confirm idempotently", async () => {
    const quote = await createQuote([{ presentationId, quantity: 2 }]);
    const input = {
      idempotencyKey: "same-confirm",
      cashShiftId: shiftId,
      warehouseId,
      payments: [{ method: "CASH", amountBob: "37.5000" }],
      lines: [{ presentationId, quantity: 3 }],
      quoteId: quote.id
    } as Parameters<SalesService["confirm"]>[1];
    const first = await sales.confirm(cashierScope, input);
    const replay = await sales.confirm(cashierScope, input);
    expect(replay.id).toBe(first.id);
    expect(first.totalBob).toBe("37.5000");
    expect((await sales.quoteDetail(cashierScope, quote.id)).status).toBe("CONVERTED");
    expect(await stockBase()).toBe(70);
    expect((await ownerPool.query("select 1 from sales")).rowCount).toBe(1);
  });

  it("leaves the quote OPEN when the sale fails", async () => {
    const quote = await createQuote([{ presentationId, quantity: 20 }]);
    await expect(confirmFromQuote(quote.id, 20)).rejects.toMatchObject({ status: 409 });
    expect((await sales.quoteDetail(cashierScope, quote.id)).status).toBe("OPEN");
    expect(await stockBase()).toBe(100);
    expect((await ownerPool.query("select 1 from sales")).rowCount).toBe(0);
  });

  it("rejects converting twice, a canceled quote or an expired quote with 409 QUOTE_NOT_OPEN and sells nothing", async () => {
    const converted = await createQuote();
    await confirmFromQuote(converted.id);
    const canceled = await createQuote();
    await sales.cancelQuote(cashierScope, canceled.id, { idempotencyKey: key() });
    const expired = await createQuote();
    await expire(expired.id);
    const stockBefore = await stockBase();
    const cashBefore = await expectedCash();
    for (const quoteId of [converted.id, canceled.id, expired.id]) {
      await expect(confirmFromQuote(quoteId)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: "QUOTE_NOT_OPEN" })
      });
    }
    expect(await stockBase()).toBe(stockBefore);
    expect(await expectedCash()).toBe(cashBefore);
    expect((await ownerPool.query("select 1 from sales")).rowCount).toBe(1);
  });

  it("rejects an unknown or malformed quoteId on confirm", async () => {
    await expect(confirmFromQuote(id(97))).rejects.toMatchObject({ status: 404 });
    await expect(confirmFromQuote("nope")).rejects.toMatchObject({ status: 400 });
    expect((await ownerPool.query("select 1 from sales")).rowCount).toBe(0);
  });

  it("keeps quotes isolated per branch: invisible and untouchable from another branch", async () => {
    const quote = await createQuote();
    await expect(sales.quoteDetail(otherBranchScope, quote.id)).rejects.toMatchObject({ status: 404 });
    await expect(sales.cancelQuote(otherBranchScope, quote.id, { idempotencyKey: key() })).rejects.toMatchObject({ status: 404 });
    expect((await sales.listQuotes(otherBranchScope, {})).total).toBe(0);
    expect((await sales.quoteDetail(cashierScope, quote.id)).status).toBe("OPEN");
  });

  it("replays create and cancel with the same idempotency key and rejects a changed payload", async () => {
    const input = { idempotencyKey: "create-1", lines: [{ presentationId, quantity: 2 }] };
    const first = await sales.createQuote(cashierScope, input);
    const replay = await sales.createQuote(cashierScope, input);
    expect(replay.id).toBe(first.id);
    expect((await ownerPool.query("select 1 from sales_quotes")).rowCount).toBe(1);
    await expect(
      sales.createQuote(cashierScope, { idempotencyKey: "create-1", lines: [{ presentationId, quantity: 3 }] })
    ).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }) });

    const first1 = await sales.cancelQuote(cashierScope, first.id, { idempotencyKey: "cancel-1" });
    const replay1 = await sales.cancelQuote(cashierScope, first.id, { idempotencyKey: "cancel-1" });
    expect(replay1).toEqual(first1);
    expect((await ownerPool.query("select 1 from audit_events where action = 'sales.quote_canceled'")).rowCount).toBe(1);
  });

  it("keeps quote lines immutable and terminal quotes unchangeable at the database level", async () => {
    const quote = await createQuote();
    const app = new Pool({ connectionString: testAppUrl });
    try {
      const client = await app.connect();
      try {
        await client.query("begin");
        await client.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.branch_id', $2, true), set_config('app.user_id', $3, true)",
          [tenantId, branchId, cashierId]
        );
        await expect(client.query("update sales_quote_items set quantity = 99 where quote_id = $1", [quote.id])).rejects.toThrow(/immutable|permission denied/);
        await client.query("rollback");
        await client.query("begin");
        await client.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.branch_id', $2, true), set_config('app.user_id', $3, true)",
          [tenantId, branchId, cashierId]
        );
        await expect(client.query("update sales_quotes set total_amount_bob = 1 where id = $1", [quote.id])).rejects.toThrow(/status fields/);
        await client.query("rollback");
      } finally {
        client.release();
      }
    } finally {
      await app.end();
    }
  });
});
