import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS_KEY } from "../src/auth/auth.decorators.js";
import { AgreementStatementsController } from "../src/customers/agreement-statements.controller.js";
import { AgreementStatementsService } from "../src/customers/agreement-statements.service.js";
import { AgreementsService } from "../src/customers/agreements.service.js";
import { CustomersService } from "../src/customers/customers.service.js";
import { FEATURE_KEY } from "../src/saas/subscription.guard.js";
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

const id = (n: number) => `00000000-0000-4000-8000-${String(980000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const otherTenantId = id(3);
const otherLegalEntityId = id(4);
const branchA = id(11);
const branchB = id(12);
const otherBranchId = id(13);
const userA = id(21);
const userB = id(22);
const otherUserId = id(23);
const productId = id(51);
const presentationId = id(61);
const batchId = id(71);
/** Per-branch fixtures: register, shift, warehouse. */
const fixtures = {
  A: { register: id(31), shift: id(32), warehouse: id(33) },
  B: { register: id(41), shift: id(42), warehouse: id(43) }
};

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const customers = new CustomersService(database);
const agreements = new AgreementsService(database);
const statements = new AgreementStatementsService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scopeA: TenantScope = { tenantId, userId: userA, branchId: branchA };
const scopeB: TenantScope = { tenantId, userId: userB, branchId: branchB };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };
const viewAll = { viewAll: true };

let counter = 0;
const key = () => `stm-${++counter}`;

async function setPlan(planCode: string, forTenant = tenantId): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [forTenant]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query(
    "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
    [forTenant, plan.rows[0]!.id]
  );
}

async function rejection(promise: Promise<unknown>): Promise<{ error: unknown; body: Record<string, unknown> }> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).not.toBeNull();
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return { error, body: (response ?? {}) as Record<string, unknown> };
}

async function laPazPeriod(shiftMonths = 0): Promise<string> {
  const result = await ownerPool.query<{ p: string }>(
    "select to_char((now() at time zone 'America/La_Paz') + make_interval(months => $1::int), 'YYYY-MM') as p",
    [shiftMonths]
  );
  return result.rows[0]!.p;
}

type Branch = "A" | "B";

/** Unit price 12.5: 4 units = 50 BOB; the agreement pays `agreementBob`, the rest is cash. */
async function agreementSale(branch: Branch, customerId: string, agreementId: string, agreementBob: string, quantity = 4) {
  const total = quantity * 12.5;
  const copay = (total - Number(agreementBob)).toFixed(4);
  const fixture = fixtures[branch];
  return sales.confirm(branch === "A" ? scopeA : scopeB, {
    idempotencyKey: key(),
    cashShiftId: fixture.shift,
    warehouseId: fixture.warehouse,
    customerId,
    payments: [{ method: "AGREEMENT", amountBob: agreementBob, agreementId }, ...(Number(copay) > 0 ? [{ method: "CASH", amountBob: copay }] : [])],
    lines: [{ presentationId, quantity, unitPriceBob: "12.5000" }]
  });
}

async function expectedCash(shiftId: string): Promise<string> {
  const result = await ownerPool.query<{ v: string }>("select expected_amount_bob::text as v from cash_shift_controls where cash_shift_id = $1", [shiftId]);
  return result.rows[0]!.v;
}

function paymentInput(amount: string, overrides: Record<string, unknown> = {}) {
  return { idempotencyKey: key(), amountBob: amount, method: "TRANSFER", paidOn: "2026-10-05", reference: "TR-1", ...overrides } as Parameters<AgreementStatementsService["registerPayment"]>[2];
}

async function newAgreement(name = "Seguro Salud", coverage = 80) {
  return agreements.create(scopeA, { name, kind: "INSURER", payerName: `${name} SA`, payerTaxId: "1020304050", coveragePercent: coverage, monthlyLimitBob: "5000" });
}

async function newMember(agreementId: string, name: string, doc: string, code: string): Promise<string> {
  const customer = await customers.create(scopeA, { fullName: name, docType: "CI", docNumber: doc });
  await agreements.addMember(scopeA, agreementId, { customerId: customer.id, memberCode: code });
  return customer.id;
}

describe("F17 CRM agreement statements (T6)", () => {
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
    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, 'crm-stm', 'Farmacia Estados'), ($2, 'crm-stm-2', 'Otra')",
      [tenantId, otherTenantId]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Estados SRL', '7009801'), ($3, $4, 'Otra SRL', '7009802')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central'), ($4, $2, $3, 'SUR', 'Sucursal Sur'), ($5, $6, $7, 'MAIN', 'Otra')",
      [branchA, tenantId, legalEntityId, branchB, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, 'stm-a@example.test', 'Cajero Central', 'x'), ($2, 'stm-b@example.test', 'Cajero Sur', 'x'), ($3, 'stm-o@example.test', 'Otro', 'x')",
      [userA, userB, otherUserId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $4, $5), ($2, $4, $6), ($3, $7, $8)",
      [userA, userB, otherUserId, tenantId, branchA, branchB, otherTenantId, otherBranchId]
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
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-1', current_date + 400, 5.0000)",
      [batchId, tenantId, presentationId]
    );
    for (const [branch, branchRef, user] of [["A", branchA, userA], ["B", branchB, userB]] as const) {
      const f = fixtures[branch];
      await ownerPool.query(
        "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')",
        [f.warehouse, tenantId, branchRef]
      );
      await ownerPool.query(
        "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 1000, 0)",
        [tenantId, f.warehouse, batchId]
      );
      await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, $4, true)", [f.register, tenantId, branchRef, `CAJA-${branch}`]);
      await ownerPool.query(
        `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
         values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
        [f.shift, tenantId, branchRef, f.register, user]
      );
      await ownerPool.query("insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)", [tenantId, branchRef, f.shift, user]);
      await ownerPool.query(
        `insert into cash_shift_controls (tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
         values ($1, $2, $3, '100.0000', '100.0000', 'OPEN', $4, now())`,
        [tenantId, branchRef, f.shift, user]
      );
    }
    await setPlan("PREMIUM");
    await setPlan("PREMIUM", otherTenantId);
  });

  describe("preview and issue", () => {
    it("previews the unbilled charges of an agreement and month from every branch, net of reductions", async () => {
      const agreement = await newAgreement();
      const other = await newAgreement("Otro Convenio", 50);
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      const beto = await newMember(agreement.id, "Beto Rios", "9002", "AF-2");
      const carla = await newMember(other.id, "Carla Sosa", "9003", "OC-1");
      const first = await agreementSale("A", ana, agreement.id, "40.0000");
      const second = await agreementSale("B", beto, agreement.id, "30.0000");
      await agreementSale("A", carla, other.id, "25.0000");
      const voided = await agreementSale("A", ana, agreement.id, "20.0000");
      await sales.voidSale(scopeA, voided.id, { idempotencyKey: key(), reason: "Error" }, viewAll);
      // A partial return reduces the charge: 1 of 4 units -> 10.0 less on the first sale.
      const item = (await sales.detail(scopeA, first.id, viewAll)).items[0]!.id;
      await sales.registerReturn(scopeA, first.id, { idempotencyKey: key(), reason: "Cambio", refundMethod: "CASH", restock: true, lines: [{ saleItemId: item, quantity: 1 }] }, viewAll);

      const period = await laPazPeriod();
      const preview = await statements.preview(scopeA, { agreementId: agreement.id, period });
      expect(preview).toMatchObject({ agreementId: agreement.id, agreementName: "Seguro Salud", period, lineCount: 2, totalBob: "60.0000" });
      expect(preview.lines.map((line) => [line.branchCode, line.saleNumber, line.customerName, line.memberCode, line.amountBob])).toEqual([
        ["MAIN", first.saleNumber, "Ana Perez", "AF-1", "30.0000"],
        ["SUR", second.saleNumber, "Beto Rios", "AF-2", "30.0000"]
      ]);
      expect((await statements.preview(scopeA, { agreementId: agreement.id, period: await laPazPeriod(-1) })).lineCount).toBe(0);
      // Same answer from the other branch: the charges are read tenant-wide.
      expect((await statements.preview(scopeB, { agreementId: agreement.id, period })).totalBob).toBe("60.0000");
    });

    it("issues one statement per agreement and month: total = sum of charges, charges become BILLED, number per issuing branch", async () => {
      const agreement = await newAgreement();
      const other = await newAgreement("Otro Convenio", 50);
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      const carla = await newMember(other.id, "Carla Sosa", "9003", "OC-1");
      await agreementSale("A", ana, agreement.id, "40.0000");
      await agreementSale("B", ana, agreement.id, "30.0000");
      await agreementSale("A", ana, agreement.id, "10.0000", 2);
      await agreementSale("B", carla, other.id, "25.0000");
      const period = await laPazPeriod();

      const issued = await statements.issue(scopeA, { agreementId: agreement.id, period });
      expect(issued).toMatchObject({
        agreementId: agreement.id,
        agreementName: "Seguro Salud",
        period,
        number: "CONV-MAIN-000001",
        totalBob: "80.0000",
        paidBob: "0.0000",
        balanceBob: "80.0000",
        status: "ISSUED",
        lineCount: 3,
        payments: []
      });
      expect(issued.lines.map((line) => line.branchCode).sort()).toEqual(["MAIN", "MAIN", "SUR"]);
      expect(issued.lines.reduce((sum, line) => sum + Number(line.amountBob), 0)).toBe(80);
      const billed = await ownerPool.query("select status, statement_id from agreement_charges where agreement_id = $1", [agreement.id]);
      expect(billed.rows.every((row) => row.status === "BILLED" && row.statement_id === issued.id)).toBe(true);
      const untouched = await ownerPool.query("select status from agreement_charges where agreement_id = $1", [other.id]);
      expect(untouched.rows[0].status).toBe("OPEN");

      // The second statement is issued from the other branch: its number follows that branch's sequence.
      const second = await statements.issue(scopeB, { agreementId: other.id, period });
      expect(second.number).toBe("CONV-SUR-000001");
      expect((await statements.issue(scopeA, { agreementId: other.id, period: await laPazPeriod(-1) }).catch((e: unknown) => e)) instanceof ConflictException).toBe(true);
      const audits = await ownerPool.query("select action from audit_events where action = 'crm.agreement_statement.issued'");
      expect(audits.rowCount).toBe(2);
    });

    it("refuses a second statement for the same month, an empty month, a bad period and a future one", async () => {
      const agreement = await newAgreement();
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      const period = await laPazPeriod();
      const empty = await rejection(statements.issue(scopeA, { agreementId: agreement.id, period }));
      expect(empty.error).toBeInstanceOf(ConflictException);
      expect(empty.body.code).toBe("NO_CHARGES_TO_BILL");
      await agreementSale("A", ana, agreement.id, "40.0000");
      await statements.issue(scopeA, { agreementId: agreement.id, period });
      const again = await rejection(statements.issue(scopeA, { agreementId: agreement.id, period }));
      expect(again.error).toBeInstanceOf(ConflictException);
      expect(again.body.code).toBe("AGREEMENT_STATEMENT_EXISTS");
      for (const bad of ["2026-13", "26-10", "abc", "", await laPazPeriod(1)]) {
        const { error, body } = await rejection(statements.issue(scopeA, { agreementId: agreement.id, period: bad }));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.code).toBe("INVALID_INPUT");
      }
      expect((await rejection(statements.issue(scopeA, { agreementId: id(999), period }))).body.code).toBe("AGREEMENT_NOT_FOUND");
      expect((await rejection(statements.preview(scopeA, { agreementId: "no-uuid", period }))).error).toBeInstanceOf(NotFoundException);
    });

    it("bills only the charges of the requested month", async () => {
      const agreement = await newAgreement();
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      await agreementSale("A", ana, agreement.id, "40.0000");
      await agreementSale("A", ana, agreement.id, "30.0000");
      await ownerPool.query("update agreement_charges set created_at = created_at - interval '1 month' where amount_bob = 30");
      const previous = await laPazPeriod(-1);
      const old = await statements.issue(scopeA, { agreementId: agreement.id, period: previous });
      expect(old).toMatchObject({ period: previous, totalBob: "30.0000", lineCount: 1 });
      const current = await statements.issue(scopeA, { agreementId: agreement.id, period: await laPazPeriod() });
      expect(current).toMatchObject({ totalBob: "40.0000", lineCount: 1 });
      expect(current.number).toBe("CONV-MAIN-000002");
    });
  });

  describe("billed charges are frozen", () => {
    it("voiding or returning a sale whose charge is already BILLED is a 409 AGREEMENT_CHARGE_BILLED and changes nothing", async () => {
      const agreement = await newAgreement();
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      const sale = await agreementSale("A", ana, agreement.id, "40.0000");
      await statements.issue(scopeA, { agreementId: agreement.id, period: await laPazPeriod() });
      const cashBefore = await expectedCash(fixtures.A.shift);
      const voided = await rejection(sales.voidSale(scopeA, sale.id, { idempotencyKey: key(), reason: "Error" }, viewAll));
      expect(voided.error).toBeInstanceOf(ConflictException);
      expect(voided.body.code).toBe("AGREEMENT_CHARGE_BILLED");
      const item = (await sales.detail(scopeA, sale.id, viewAll)).items[0]!.id;
      const returned = await rejection(
        sales.registerReturn(scopeA, sale.id, { idempotencyKey: key(), reason: "Cambio", refundMethod: "CASH", restock: true, lines: [{ saleItemId: item, quantity: 1 }] }, viewAll)
      );
      expect(returned.error).toBeInstanceOf(ConflictException);
      expect(returned.body.code).toBe("AGREEMENT_CHARGE_BILLED");
      const detail = await sales.detail(scopeA, sale.id, viewAll);
      expect(detail.status).toBe("CONFIRMED");
      expect(detail.returns).toHaveLength(0);
      expect(await expectedCash(fixtures.A.shift)).toBe(cashBefore);
      expect((await ownerPool.query("select status, reduced_amount_bob::text as reduced from agreement_charges")).rows[0]).toEqual({ status: "BILLED", reduced: "0.0000" });
    });
  });

  describe("payments", () => {
    async function issuedStatement() {
      const agreement = await newAgreement();
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      await agreementSale("A", ana, agreement.id, "40.0000");
      await agreementSale("B", ana, agreement.id, "20.0000");
      const statement = await statements.issue(scopeA, { agreementId: agreement.id, period: await laPazPeriod() });
      return { agreement, statement }; // total 60
    }

    it("registers partial and final payments and moves the status ISSUED -> PARTIAL -> PAID", async () => {
      const { statement } = await issuedStatement();
      const partial = await statements.registerPayment(scopeA, statement.id, paymentInput("25.5"));
      expect(partial).toMatchObject({ statementId: statement.id, amountBob: "25.5000", paidBob: "25.5000", balanceBob: "34.5000", status: "PARTIAL" });
      expect((await statements.detail(scopeA, statement.id)).status).toBe("PARTIAL");
      const final = await statements.registerPayment(scopeB, statement.id, paymentInput("34.5000", { method: "CHECK", reference: "CH-77" }));
      expect(final).toMatchObject({ paidBob: "60.0000", balanceBob: "0.0000", status: "PAID" });
      const detail = await statements.detail(scopeA, statement.id);
      expect(detail).toMatchObject({ status: "PAID", paidBob: "60.0000", balanceBob: "0.0000" });
      expect(detail.payments.map((p) => [p.amountBob, p.method, p.reference, p.createdByName])).toEqual([
        ["25.5000", "TRANSFER", "TR-1", "Cajero Central"],
        ["34.5000", "CHECK", "CH-77", "Cajero Sur"]
      ]);
      const audits = await ownerPool.query("select action from audit_events where action = 'crm.agreement_statement.payment_registered'");
      expect(audits.rowCount).toBe(2);
    });

    it("never accepts more than the balance and rejects invalid input", async () => {
      const { statement } = await issuedStatement();
      const over = await rejection(statements.registerPayment(scopeA, statement.id, paymentInput("60.0001")));
      expect(over.error).toBeInstanceOf(BadRequestException);
      expect(over.body).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE", balanceBob: "60.0000" });
      await statements.registerPayment(scopeA, statement.id, paymentInput("60"));
      expect((await rejection(statements.registerPayment(scopeA, statement.id, paymentInput("0.0100")))).body.code).toBe("PAYMENT_EXCEEDS_BALANCE");
      for (const override of [{ amountBob: "0" }, { amountBob: "-1" }, { amountBob: "abc" }, { method: "CARD" }, { paidOn: "2026-02-30" }, { paidOn: "hoy" }, { idempotencyKey: "" }, { reference: "x".repeat(121) }]) {
        const { error, body } = await rejection(statements.registerPayment(scopeA, statement.id, paymentInput("1", override)));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.code).toBe("INVALID_INPUT");
      }
      expect((await rejection(statements.registerPayment(scopeA, id(998), paymentInput("1")))).body.code).toBe("STATEMENT_NOT_FOUND");
      const paid = await ownerPool.query("select paid_bob::text as paid from agreement_statements");
      expect(paid.rows[0].paid).toBe("60.0000");
    });

    it("is idempotent: replaying a key returns the same payment and does not pay twice; a changed payload is a conflict", async () => {
      const { statement } = await issuedStatement();
      const input = paymentInput("10", { idempotencyKey: "pay-once" });
      const first = await statements.registerPayment(scopeA, statement.id, input);
      const second = await statements.registerPayment(scopeA, statement.id, input);
      expect(second.paymentId).toBe(first.paymentId);
      expect((await statements.detail(scopeA, statement.id)).paidBob).toBe("10.0000");
      const reused = await rejection(statements.registerPayment(scopeA, statement.id, paymentInput("11", { idempotencyKey: "pay-once" })));
      expect(reused.error).toBeInstanceOf(ConflictException);
    });

    it("serializes concurrent payments so the balance is never exceeded", async () => {
      const { statement } = await issuedStatement();
      const results = await Promise.allSettled([
        statements.registerPayment(scopeA, statement.id, paymentInput("40")),
        statements.registerPayment(scopeB, statement.id, paymentInput("40"))
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await statements.detail(scopeA, statement.id)).paidBob).toBe("40.0000");
    });
  });

  describe("list, detail and CSV", () => {
    it("lists statements with filters and paging and reads a detail with lines and payer data", async () => {
      const agreement = await newAgreement();
      const other = await newAgreement("Otro Convenio", 50);
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      const carla = await newMember(other.id, "Carla Sosa", "9003", "OC-1");
      await agreementSale("A", ana, agreement.id, "40.0000");
      await agreementSale("A", carla, other.id, "25.0000");
      const period = await laPazPeriod();
      const one = await statements.issue(scopeA, { agreementId: agreement.id, period });
      const two = await statements.issue(scopeA, { agreementId: other.id, period });
      await statements.registerPayment(scopeA, two.id, paymentInput("25"));
      const all = await statements.list(scopeA, {});
      expect(all.total).toBe(2);
      expect(all.items.map((item) => item.number)).toEqual([two.number, one.number]); // newest first
      expect(all.items[0]).toMatchObject({ agreementName: "Otro Convenio", status: "PAID", totalBob: "25.0000", balanceBob: "0.0000" });
      expect(all.items[0]).not.toHaveProperty("lines");
      expect((await statements.list(scopeB, { agreementId: agreement.id })).items.map((i) => i.id)).toEqual([one.id]);
      expect((await statements.list(scopeA, { status: "PAID" })).items.map((i) => i.id)).toEqual([two.id]);
      expect((await statements.list(scopeA, { period: await laPazPeriod(-1) })).total).toBe(0);
      expect((await statements.list(scopeA, { limit: 1, offset: 1 })).items).toHaveLength(1);
      expect((await rejection(statements.list(scopeA, { status: "BAD" }))).body.code).toBe("INVALID_INPUT");
      const detail = await statements.detail(scopeB, one.id);
      expect(detail).toMatchObject({ payerName: "Seguro Salud SA", payerTaxId: "1020304050", coveragePercent: "80.00", number: one.number });
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0]).toMatchObject({ branchCode: "MAIN", customerName: "Ana Perez", memberCode: "AF-1", amountBob: "40.0000" });
      expect((await rejection(statements.detail(scopeA, "no-uuid"))).error).toBeInstanceOf(NotFoundException);
    });

    it("exports the statement as CSV with a header, one row per charge and the total", async () => {
      const agreement = await newAgreement();
      const ana = await newMember(agreement.id, "Ana \"La Pérez\", Rios", "9001", "AF-1");
      const sale = await agreementSale("B", ana, agreement.id, "40.0000");
      const statement = await statements.issue(scopeA, { agreementId: agreement.id, period: await laPazPeriod() });
      const exported = await statements.exportCsv(scopeA, statement.id);
      expect(exported.filename).toBe("convenio-CONV-MAIN-000001.csv");
      const lines = exported.csv.trim().split("\r\n");
      expect(lines[0]).toContain("Sucursal");
      expect(exported.csv).toContain(`SUR,${sale.saleNumber},`);
      expect(exported.csv).toContain("\"Ana \"\"La Pérez\"\", Rios\"");
      expect(exported.csv).toContain(",AF-1,40.0000");
      expect(lines[lines.length - 1]).toMatch(/^TOTAL,.*40\.0000$/);
    });
  });

  describe("plan, permissions and isolation", () => {
    it("is gated by the plan: PROFESIONAL gets 403 PLAN_FEATURE_RESTRICTED on every statement operation", async () => {
      const agreement = await newAgreement();
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      await agreementSale("A", ana, agreement.id, "40.0000");
      const statement = await statements.issue(scopeA, { agreementId: agreement.id, period: await laPazPeriod() });
      await setPlan("PROFESIONAL");
      for (const call of [
        () => statements.preview(scopeA, { agreementId: agreement.id, period: "2026-10" }),
        () => statements.issue(scopeA, { agreementId: agreement.id, period: "2026-10" }),
        () => statements.list(scopeA, {}),
        () => statements.detail(scopeA, statement.id),
        () => statements.registerPayment(scopeA, statement.id, paymentInput("1")),
        () => statements.exportCsv(scopeA, statement.id)
      ]) {
        const { error, body } = await rejection(call());
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(body).toMatchObject({ code: "PLAN_FEATURE_RESTRICTED", feature: "crm.agreements" });
      }
    });

    it("isolates pharmacies (RLS) and keeps payments immutable for the application role", async () => {
      const agreement = await newAgreement();
      const ana = await newMember(agreement.id, "Ana Perez", "9001", "AF-1");
      await agreementSale("A", ana, agreement.id, "40.0000");
      const statement = await statements.issue(scopeA, { agreementId: agreement.id, period: await laPazPeriod() });
      await statements.registerPayment(scopeA, statement.id, paymentInput("10"));
      expect((await rejection(statements.detail(otherScope, statement.id))).error).toBeInstanceOf(NotFoundException);
      expect((await statements.list(otherScope, {})).total).toBe(0);
      for (const table of ["agreement_statements", "agreement_statement_payments", "agreement_charges"]) {
        expect((await database.withScope(otherScope, (client) => client.query(`select * from ${table}`))).rowCount).toBe(0);
      }
      await expect(database.withScope(scopeA, (client) => client.query("update agreement_statement_payments set amount_bob = 1"))).rejects.toMatchObject({ code: "42501" });
      await expect(database.withScope(scopeA, (client) => client.query("delete from agreement_statements"))).rejects.toMatchObject({ code: "42501" });
    });

    it("declares the billing permission and the plan feature on the controller", () => {
      const proto = AgreementStatementsController.prototype as unknown as Record<string, object>;
      for (const name of ["preview", "issue", "list", "detail", "registerPayment", "exportCsv"]) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[name]!)).toEqual(["agreements.billing"]);
      }
      expect(Reflect.getMetadata(FEATURE_KEY, AgreementStatementsController)).toBe("crm.agreements");
    });
  });
});
