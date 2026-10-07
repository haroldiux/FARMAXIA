import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from "../src/auth/auth.decorators.js";
import { AgreementsController } from "../src/customers/agreements.controller.js";
import { AgreementsService } from "../src/customers/agreements.service.js";
import { CustomersService } from "../src/customers/customers.service.js";
import { LoyaltyService } from "../src/customers/loyalty.service.js";
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

const id = (n: number) => `00000000-0000-4000-8000-${String(970000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const otherTenantId = id(3);
const otherLegalEntityId = id(4);
const branchId = id(11);
const otherBranchId = id(12);
const cashierId = id(21);
const otherUserId = id(22);
const registerId = id(31);
const shiftId = id(32);
const warehouseId = id(33);
const productId = id(51);
const presentationId = id(61);
const batchId = id(71);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const customers = new CustomersService(database);
const loyalty = new LoyaltyService(database);
const agreements = new AgreementsService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId: cashierId, branchId };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };
const viewAll = { viewAll: true };

let counter = 0;
const key = () => `agr-${++counter}`;

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

type Payment = { method: string; amountBob: string; reference?: string; agreementId?: string };

/** Unit price 12.5; a sale of `quantity` units totals quantity * 12.5 (4 units = 50). */
function sell(customerId: string | undefined, quantity: number, payments: Payment[]) {
  return sales.confirm(scope, {
    idempotencyKey: key(),
    cashShiftId: shiftId,
    warehouseId,
    payments,
    ...(customerId === undefined ? {} : { customerId }),
    lines: [{ presentationId, quantity, unitPriceBob: "12.5000" }]
  });
}

async function newCustomer(name = "Paciente Convenio", doc = "8001"): Promise<string> {
  return (await customers.create(scope, { fullName: name, docType: "CI", docNumber: doc })).id;
}

/** An 80% agreement with a 500 BOB monthly limit and the customer enrolled as an active member. */
async function enrolled(options: { coverage?: number; limit?: string; memberLimit?: string | null } = {}) {
  const agreement = await agreements.create(scope, {
    name: "Seguro Salud",
    kind: "INSURER",
    payerName: "Seguros del Sur SA",
    payerTaxId: "1020304050",
    coveragePercent: options.coverage ?? 80,
    monthlyLimitBob: options.limit ?? "500"
  });
  const customerId = await newCustomer();
  const member = await agreements.addMember(scope, agreement.id, {
    customerId,
    memberCode: "AF-001",
    ...(options.memberLimit ? { monthlyLimitBob: options.memberLimit } : {})
  });
  return { agreement, customerId, member };
}

async function expectedCash(): Promise<string> {
  const result = await ownerPool.query<{ v: string }>("select expected_amount_bob::text as v from cash_shift_controls where cash_shift_id = $1", [shiftId]);
  return result.rows[0]!.v;
}

async function charges(): Promise<Array<{ saleId: string; amount: string; reduced: string; status: string; branchCode: string; saleNumber: string }>> {
  const result = await ownerPool.query(
    `select sale_id as "saleId", amount_bob::text as amount, reduced_amount_bob::text as reduced, status,
            branch_code as "branchCode", sale_number as "saleNumber"
     from agreement_charges order by created_at, id`
  );
  return result.rows;
}

async function itemId(saleId: string): Promise<string> {
  return (await sales.detail(scope, saleId, viewAll)).items[0]!.id;
}

function returnInput(saleItemId: string, quantity: number) {
  return {
    idempotencyKey: key(),
    reason: "Cliente se arrepintio",
    refundMethod: "CASH",
    restock: true,
    lines: [{ saleItemId, quantity }]
  } as Parameters<SalesService["registerReturn"]>[2];
}

describe("F17 CRM agreements (T4, T5)", () => {
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
      "insert into tenants (id, slug, name) values ($1, 'crm-agr', 'Farmacia Convenios'), ($2, 'crm-agr-2', 'Otra')",
      [tenantId, otherTenantId]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Convenios SRL', '7009701'), ($3, $4, 'Otra SRL', '7009702')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central'), ($4, $5, $6, 'MAIN', 'Otra')",
      [branchId, tenantId, legalEntityId, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, 'agr-a@example.test', 'Cajero', 'x'), ($2, 'agr-b@example.test', 'Otro', 'x')",
      [cashierId, otherUserId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $5, $6)",
      [cashierId, otherUserId, tenantId, branchId, otherTenantId, otherBranchId]
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
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-1', current_date + 400, 5.0000)",
      [batchId, tenantId, presentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 1000, 0)",
      [tenantId, warehouseId, batchId]
    );
    await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)", [registerId, tenantId, branchId]);
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
      [shiftId, tenantId, branchId, registerId, cashierId]
    );
    await ownerPool.query("insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)", [tenantId, branchId, shiftId, cashierId]);
    await ownerPool.query(
      `insert into cash_shift_controls (tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
       values ($1, $2, $3, '100.0000', '100.0000', 'OPEN', $4, now())`,
      [tenantId, branchId, shiftId, cashierId]
    );
    await setPlan("PREMIUM");
    await setPlan("PREMIUM", otherTenantId);
  });

  describe("T4: agreements and members", () => {
    it("creates, lists, reads and updates an agreement", async () => {
      const created = await agreements.create(scope, {
        name: "  Seguro Salud ",
        kind: "INSURER",
        payerName: "Seguros del Sur SA",
        payerTaxId: "1020304050",
        coveragePercent: "80.5",
        monthlyLimitBob: 500,
        notes: "Cobertura ambulatoria"
      });
      expect(created).toMatchObject({
        name: "Seguro Salud",
        kind: "INSURER",
        payerName: "Seguros del Sur SA",
        payerTaxId: "1020304050",
        coveragePercent: "80.50",
        monthlyLimitBob: "500.0000",
        notes: "Cobertura ambulatoria",
        isActive: true,
        memberCount: 0
      });
      await agreements.create(scope, { name: "Sindicato Fabril", kind: "UNION", payerName: "Sindicato", coveragePercent: 30, monthlyLimitBob: "200" });
      const list = await agreements.list(scope, {});
      expect(list.items.map((item) => item.name)).toEqual(["Seguro Salud", "Sindicato Fabril"]);
      expect(list.total).toBe(2);
      const updated = await agreements.update(scope, created.id, { coveragePercent: 70, monthlyLimitBob: "650.5", isActive: false, notes: null });
      expect(updated).toMatchObject({ coveragePercent: "70.00", monthlyLimitBob: "650.5000", isActive: false, notes: null, name: "Seguro Salud" });
      expect((await agreements.detail(scope, created.id)).isActive).toBe(false);
      expect((await agreements.list(scope, { active: "true" })).items.map((item) => item.name)).toEqual(["Sindicato Fabril"]);
      expect((await agreements.list(scope, { q: "fabril" })).total).toBe(1);
      const audits = await ownerPool.query("select action from audit_events where action like 'crm.agreement.%' order by occurred_at, id");
      expect(audits.rows.map((row) => row.action)).toEqual(["crm.agreement.created", "crm.agreement.created", "crm.agreement.updated"]);
    });

    it("validates the input and keeps the name unique per pharmacy", async () => {
      const base = { name: "Convenio", kind: "COMPANY", payerName: "Empresa SA", coveragePercent: 50, monthlyLimitBob: "100" };
      await agreements.create(scope, base);
      const duplicate = await rejection(agreements.create(scope, base));
      expect(duplicate.error).toBeInstanceOf(ConflictException);
      expect(duplicate.body.code).toBe("AGREEMENT_NAME_EXISTS");
      for (const override of [
        { name: " " },
        { kind: "OTHER" },
        { payerName: "" },
        { coveragePercent: 0 },
        { coveragePercent: 101 },
        { coveragePercent: "abc" },
        { monthlyLimitBob: 0 },
        { monthlyLimitBob: "-5" },
        { monthlyLimitBob: "1.00001" }
      ]) {
        const { error, body } = await rejection(agreements.create(scope, { ...base, name: "Otro", ...override } as never));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.code).toBe("INVALID_INPUT");
      }
      expect((await rejection(agreements.detail(scope, id(999)))).body.code).toBe("AGREEMENT_NOT_FOUND");
      expect((await rejection(agreements.detail(scope, "no-uuid"))).error).toBeInstanceOf(NotFoundException);
    });

    it("is gated by the plan: PROFESIONAL gets 403 PLAN_FEATURE_RESTRICTED on every operation", async () => {
      const { agreement, customerId, member } = await enrolled();
      await setPlan("PROFESIONAL");
      for (const call of [
        () => agreements.list(scope, {}),
        () => agreements.create(scope, { name: "X", kind: "UNION", payerName: "Y", coveragePercent: 10, monthlyLimitBob: "10" }),
        () => agreements.update(scope, agreement.id, { isActive: false }),
        () => agreements.detail(scope, agreement.id),
        () => agreements.listMembers(scope, agreement.id),
        () => agreements.addMember(scope, agreement.id, { customerId, memberCode: "Z" }),
        () => agreements.updateMember(scope, agreement.id, member.id, { isActive: false }),
        () => agreements.customerAgreements(scope, customerId)
      ]) {
        const { error, body } = await rejection(call());
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(body.code).toBe("PLAN_FEATURE_RESTRICTED");
        expect(body.feature).toBe("crm.agreements");
      }
    });

    it("enrolls members, rejects duplicates and unknown customers, and updates or deactivates them", async () => {
      const { agreement, customerId, member } = await enrolled({ memberLimit: "200" });
      expect(member).toMatchObject({
        agreementId: agreement.id,
        customerId,
        customerName: "Paciente Convenio",
        memberCode: "AF-001",
        monthlyLimitBob: "200.0000",
        effectiveLimitBob: "200.0000",
        usedBob: "0.0000",
        remainingBob: "200.0000",
        isActive: true
      });
      const again = await rejection(agreements.addMember(scope, agreement.id, { customerId, memberCode: "AF-777" }));
      expect(again.error).toBeInstanceOf(ConflictException);
      expect(again.body.code).toBe("AGREEMENT_MEMBER_EXISTS");
      const other = await newCustomer("Otro Paciente", "8002");
      const sameCode = await rejection(agreements.addMember(scope, agreement.id, { customerId: other, memberCode: "AF-001" }));
      expect(sameCode.body.code).toBe("AGREEMENT_MEMBER_CODE_EXISTS");
      const unknown = await rejection(agreements.addMember(scope, agreement.id, { customerId: id(995), memberCode: "AF-2" }));
      expect(unknown.error).toBeInstanceOf(NotFoundException);
      expect(unknown.body.code).toBe("CUSTOMER_NOT_FOUND");
      expect((await rejection(agreements.addMember(scope, id(996), { customerId: other, memberCode: "AF-2" }))).body.code).toBe("AGREEMENT_NOT_FOUND");
      expect((await rejection(agreements.addMember(scope, agreement.id, { customerId: other, memberCode: " " }))).body.code).toBe("INVALID_INPUT");

      const cleared = await agreements.updateMember(scope, agreement.id, member.id, { monthlyLimitBob: null, memberCode: "AF-100" });
      expect(cleared).toMatchObject({ memberCode: "AF-100", monthlyLimitBob: null, effectiveLimitBob: "500.0000", remainingBob: "500.0000" });
      const off = await agreements.updateMember(scope, agreement.id, member.id, { isActive: false });
      expect(off.isActive).toBe(false);
      expect((await agreements.listMembers(scope, agreement.id)).items).toHaveLength(1);
      expect((await agreements.detail(scope, agreement.id)).memberCount).toBe(1);
      expect((await rejection(agreements.updateMember(scope, agreement.id, id(997), { isActive: true }))).body.code).toBe("AGREEMENT_MEMBER_NOT_FOUND");
    });

    it("lists the active agreements of a customer with used and remaining credit of the La Paz month", async () => {
      const { agreement, customerId } = await enrolled({ limit: "100" });
      const inactive = await agreements.create(scope, { name: "Viejo", kind: "UNION", payerName: "Gremio", coveragePercent: 20, monthlyLimitBob: "50" });
      await agreements.addMember(scope, inactive.id, { customerId, memberCode: "V-1" });
      await agreements.update(scope, inactive.id, { isActive: false });
      await sell(customerId, 4, [{ method: "AGREEMENT", amountBob: "40.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "10.0000" }]);
      const view = await agreements.customerAgreements(scope, customerId);
      expect(view.items).toEqual([
        {
          agreementId: agreement.id,
          name: "Seguro Salud",
          kind: "INSURER",
          coveragePercent: "80.00",
          memberId: expect.any(String),
          memberCode: "AF-001",
          monthlyLimitBob: "100.0000",
          usedBob: "40.0000",
          remainingBob: "60.0000"
        }
      ]);
      // A charge of the previous La Paz month does not count.
      await ownerPool.query("update agreement_charges set created_at = created_at - interval '40 days'");
      expect((await agreements.customerAgreements(scope, customerId)).items[0]).toMatchObject({ usedBob: "0.0000", remainingBob: "100.0000" });
    });

    it("isolates pharmacies (RLS) and rejects agreements of another pharmacy at the POS", async () => {
      const { agreement, customerId } = await enrolled();
      expect((await rejection(agreements.detail(otherScope, agreement.id))).error).toBeInstanceOf(NotFoundException);
      expect((await agreements.list(otherScope, {})).total).toBe(0);
      const seen = await database.withScope(otherScope, (client) => client.query("select * from agreements"));
      expect(seen.rowCount).toBe(0);
      const members = await database.withScope(otherScope, (client) => client.query("select * from agreement_members"));
      expect(members.rowCount).toBe(0);
      const foreignSale = await rejection(sell(customerId, 1, [{ method: "AGREEMENT", amountBob: "5.0000", agreementId: id(998) }, { method: "CASH", amountBob: "7.5000" }]));
      expect(foreignSale.body.code).toBe("AGREEMENT_NOT_FOUND");
    });

    it("declares permissions and feature on the controller", () => {
      const proto = AgreementsController.prototype as unknown as Record<string, object>;
      for (const name of ["create", "update", "addMember", "updateMember"]) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[name]!)).toEqual(["agreements.manage"]);
      }
      for (const name of ["list", "detail", "listMembers"]) {
        expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, proto[name]!)).toEqual(expect.arrayContaining(["agreements.manage", "agreements.billing"]));
      }
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, proto.customerAgreements!)).toEqual(expect.arrayContaining(["sales.confirm", "agreements.manage"]));
      expect(Reflect.getMetadata(FEATURE_KEY, AgreementsController)).toBe("crm.agreements");
    });
  });

  describe("T5: POS with the AGREEMENT payment", () => {
    it("covers part of the sale: copay in cash is the only drawer effect and the agreement share earns no points", async () => {
      const { agreement, customerId, member } = await enrolled();
      const sale = await sell(customerId, 4, [
        { method: "AGREEMENT", amountBob: "40.0000", agreementId: agreement.id },
        { method: "CASH", amountBob: "12.0000" } // total 50: copay 10, change 2
      ]);
      expect(sale.agreement).toEqual({ id: agreement.id, name: "Seguro Salud", coverageAmountBob: "40.0000" });
      expect(sale.payments.map((p) => [p.method, p.amountBob, p.reference])).toEqual([
        ["AGREEMENT", "40.0000", null],
        ["CASH", "12.0000", null]
      ]);
      expect(sale.loyalty).toMatchObject({ earned: 1, redeemed: 0 }); // only the 10 BOB of cash net of change
      expect(await expectedCash()).toBe("110.0000");
      expect(await charges()).toEqual([
        { saleId: sale.id, amount: "40.0000", reduced: "0.0000", status: "OPEN", branchCode: "MAIN", saleNumber: sale.saleNumber }
      ]);
      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.agreement).toEqual({ id: agreement.id, name: "Seguro Salud", coverageAmountBob: "40.0000" });
      expect(detail.payments.find((p) => p.method === "AGREEMENT")).toEqual({ method: "AGREEMENT", amountBob: "40.0000", reference: null, reversed: false });
      const members = await agreements.listMembers(scope, agreement.id);
      expect(members.items[0]).toMatchObject({ id: member.id, usedBob: "40.0000", remainingBob: "460.0000" });
    });

    it("accepts a lower amount than the coverage cap and an exactly capped one", async () => {
      const { agreement, customerId } = await enrolled({ coverage: 33.33 });
      // total 37.5 -> cap round(37.5 * 33.33 / 100, 2) = 12.50
      const capped = await sell(customerId, 3, [{ method: "AGREEMENT", amountBob: "12.5000", agreementId: agreement.id }, { method: "CASH", amountBob: "25.0000" }]);
      expect(capped.agreement?.coverageAmountBob).toBe("12.5000");
      const lower = await sell(customerId, 3, [{ method: "AGREEMENT", amountBob: "5.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "32.5000" }]);
      expect(lower.agreement?.coverageAmountBob).toBe("5.0000");
    });

    it("sales without agreement behave as before: no agreement, no charge", async () => {
      const { customerId } = await enrolled();
      const plain = await sell(undefined, 1, [{ method: "CASH", amountBob: "12.5000" }]);
      expect(plain.agreement).toBeNull();
      expect((await sales.detail(scope, plain.id, viewAll)).agreement).toBeNull();
      const withCustomer = await sell(customerId, 1, [{ method: "CASH", amountBob: "12.5000" }]);
      expect(withCustomer.agreement).toBeNull();
      expect(await charges()).toEqual([]);
    });

    it("rejects invalid AGREEMENT payments with their error codes and leaves everything untouched", async () => {
      const { agreement, customerId } = await enrolled({ limit: "500" });
      const stranger = await newCustomer("No Afiliado", "8003");
      const cash = (amount: string): Payment => ({ method: "CASH", amountBob: amount });
      const ag = (amount: string, agreementId: string = agreement.id): Payment => ({ method: "AGREEMENT", amountBob: amount, ...(agreementId ? { agreementId } : {}) });
      const cases: Array<[string | undefined, Payment[], string, number]> = [
        [customerId, [ag("40.0001"), cash("10.0000")], "AGREEMENT_COVERAGE_EXCEEDED", 400],
        [stranger, [ag("10.0000"), cash("40.0000")], "NOT_AGREEMENT_MEMBER", 400],
        [undefined, [ag("10.0000"), cash("40.0000")], "INVALID_INPUT", 400],
        [customerId, [ag("10.0000", ""), cash("40.0000")], "INVALID_INPUT", 400],
        [customerId, [ag("10.0000", "no-uuid"), cash("40.0000")], "INVALID_INPUT", 400],
        [customerId, [ag("10.0000"), ag("10.0000"), cash("30.0000")], "INVALID_INPUT", 400],
        [customerId, [{ method: "CASH", amountBob: "50.0000", agreementId: agreement.id }], "INVALID_INPUT", 400],
        [customerId, [{ method: "AGREEMENT", amountBob: "10.0000", agreementId: agreement.id, reference: "X" }, cash("40.0000")], "INVALID_INPUT", 400],
        [customerId, [ag("10.0000", id(990)), cash("40.0000")], "AGREEMENT_NOT_FOUND", 404]
      ];
      for (const [customer, payments, code, status] of cases) {
        const { error, body } = await rejection(sell(customer, 4, payments));
        expect((error as { getStatus: () => number }).getStatus()).toBe(status);
        expect(body.code ?? "INVALID_INPUT").toBe(code);
      }
      // Inactive agreement and inactive member.
      await agreements.update(scope, agreement.id, { isActive: false });
      expect((await rejection(sell(customerId, 4, [ag("10.0000"), cash("40.0000")]))).body.code).toBe("AGREEMENT_INACTIVE");
      await agreements.update(scope, agreement.id, { isActive: true });
      const member = (await agreements.listMembers(scope, agreement.id)).items[0]!;
      await agreements.updateMember(scope, agreement.id, member.id, { isActive: false });
      expect((await rejection(sell(customerId, 4, [ag("10.0000"), cash("40.0000")]))).body.code).toBe("NOT_AGREEMENT_MEMBER");
      expect((await ownerPool.query("select count(*)::int as n from sales")).rows[0].n).toBe(0);
      expect(await charges()).toEqual([]);
      expect(await expectedCash()).toBe("100.0000");
      const stock = await ownerPool.query("select quantity_base::text as q from inventory_balances where batch_id = $1", [batchId]);
      expect(stock.rows[0].q).toBe("1000");
    });

    it("rejects an AGREEMENT payment on a plan without crm.agreements with 403 PLAN_FEATURE_RESTRICTED", async () => {
      const { agreement, customerId } = await enrolled();
      await setPlan("PROFESIONAL");
      const { error, body } = await rejection(sell(customerId, 4, [{ method: "AGREEMENT", amountBob: "40.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "10.0000" }]));
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(body).toMatchObject({ code: "PLAN_FEATURE_RESTRICTED", feature: "crm.agreements" });
      const plain = await sell(customerId, 1, [{ method: "CASH", amountBob: "12.5000" }]);
      expect(plain.agreement).toBeNull();
    });

    it("enforces the monthly limit across sales (member override wins) and resets on a new La Paz month", async () => {
      const { agreement, customerId } = await enrolled({ limit: "500", memberLimit: "100" });
      const ag = (amount: string): Payment[] => [{ method: "AGREEMENT", amountBob: amount, agreementId: agreement.id }];
      await sell(customerId, 4, [...ag("40.0000"), { method: "CASH", amountBob: "10.0000" }]);
      await sell(customerId, 4, [...ag("40.0000"), { method: "CASH", amountBob: "10.0000" }]);
      const third = await rejection(sell(customerId, 4, [...ag("40.0000"), { method: "CASH", amountBob: "10.0000" }]));
      expect(third.error).toBeInstanceOf(BadRequestException);
      expect(third.body).toMatchObject({ code: "AGREEMENT_LIMIT_EXCEEDED", remainingBob: "20.0000" });
      const exact = await sell(customerId, 4, [...ag("20.0000"), { method: "CASH", amountBob: "30.0000" }]);
      expect(exact.agreement?.coverageAmountBob).toBe("20.0000");
      expect((await rejection(sell(customerId, 4, [...ag("0.0100"), { method: "CASH", amountBob: "50.0000" }]))).body.code).toBe("AGREEMENT_LIMIT_EXCEEDED");
      await ownerPool.query("update agreement_charges set created_at = created_at - interval '40 days'");
      const next = await sell(customerId, 4, [...ag("40.0000"), { method: "CASH", amountBob: "10.0000" }]);
      expect(next.agreement?.coverageAmountBob).toBe("40.0000");
    });

    it("replaying the same idempotency key does not charge twice", async () => {
      const { agreement, customerId } = await enrolled();
      const input = {
        idempotencyKey: "same-key", cashShiftId: shiftId, warehouseId, customerId,
        payments: [{ method: "AGREEMENT", amountBob: "40.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "10.0000" }],
        lines: [{ presentationId, quantity: 4, unitPriceBob: "12.5000" }]
      };
      const first = await sales.confirm(scope, input);
      const second = await sales.confirm(scope, input);
      expect(second.id).toBe(first.id);
      expect(await charges()).toHaveLength(1);
    });

    it("void marks the charge VOIDED, frees the credit and reverses the points of the copay", async () => {
      const { agreement, customerId } = await enrolled();
      const sale = await sell(customerId, 4, [{ method: "AGREEMENT", amountBob: "40.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "10.0000" }]);
      expect(await expectedCash()).toBe("110.0000");
      await sales.voidSale(scope, sale.id, { idempotencyKey: key(), reason: "Error" }, viewAll);
      expect((await charges())[0]).toMatchObject({ status: "VOIDED", amount: "40.0000" });
      expect(await expectedCash()).toBe("100.0000");
      expect((await agreements.listMembers(scope, agreement.id)).items[0]).toMatchObject({ usedBob: "0.0000", remainingBob: "500.0000" });
      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.payments.find((p) => p.method === "AGREEMENT")?.reversed).toBe(true);
    });

    it("partial returns reduce the charge by the proportional agreement share and refund only the rest", async () => {
      const { agreement, customerId } = await enrolled();
      const sale = await sell(customerId, 4, [{ method: "AGREEMENT", amountBob: "40.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "10.0000" }]);
      const item = await itemId(sale.id);
      // 1 of 4 units: 12.5 returned, 10.0 belongs to the agreement, 2.5 goes back in cash.
      const first = await sales.registerReturn(scope, sale.id, returnInput(item, 1), viewAll);
      expect(first).toMatchObject({ refundAmountBob: "12.5000", refundMoneyBob: "2.5000", refundPointsBob: "0.0000", refundAgreementBob: "10.0000" });
      expect(await expectedCash()).toBe("107.5000");
      expect((await charges())[0]).toMatchObject({ status: "OPEN", reduced: "10.0000" });
      expect((await agreements.listMembers(scope, agreement.id)).items[0]).toMatchObject({ usedBob: "30.0000", remainingBob: "470.0000" });
      // The remaining 3 units close the sale: the rest of the agreement share, the charge is fully reduced.
      const second = await sales.registerReturn(scope, sale.id, returnInput(item, 3), viewAll);
      expect(second).toMatchObject({ saleStatus: "RETURNED", refundMoneyBob: "7.5000", refundAgreementBob: "30.0000" });
      expect(await expectedCash()).toBe("100.0000");
      expect((await charges())[0]).toMatchObject({ status: "VOIDED", reduced: "40.0000" });
      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.returns.map((r) => r.refundAgreementBob)).toEqual(["10.0000", "30.0000"]);
    });

    it("splits a return across points, agreement and money (D70)", async () => {
      const { agreement, customerId } = await enrolled();
      await loyalty.adjust(scope, customerId, { points: 50, reason: "Bono" }); // worth 5.00 BOB
      const sale = await sell(customerId, 4, [
        { method: "AGREEMENT", amountBob: "30.0000", agreementId: agreement.id },
        { method: "POINTS", amountBob: "5.0000" },
        { method: "CASH", amountBob: "15.0000" }
      ]);
      expect(sale.loyalty).toMatchObject({ earned: 1, redeemed: 50 });
      const result = await sales.registerReturn(scope, sale.id, returnInput(await itemId(sale.id), 4), viewAll);
      expect(result).toMatchObject({ refundAmountBob: "50.0000", refundPointsBob: "5.0000", refundAgreementBob: "30.0000", refundMoneyBob: "15.0000" });
      expect(await expectedCash()).toBe("100.0000");
      expect((await charges())[0]).toMatchObject({ status: "VOIDED", reduced: "30.0000" });
    });

    it("a return refunds the cash share of the payment mix when the agreement paid only part of it", async () => {
      const { agreement, customerId } = await enrolled();
      const sale = await sell(customerId, 4, [{ method: "AGREEMENT", amountBob: "20.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "30.0000" }]);
      // 2 of 4 units: 25 returned; agreement share 20 * 25 / 50 = 10; money 15.
      const result = await sales.registerReturn(scope, sale.id, returnInput(await itemId(sale.id), 2), viewAll);
      expect(result).toMatchObject({ refundAmountBob: "25.0000", refundAgreementBob: "10.0000", refundMoneyBob: "15.0000" });
      expect(await expectedCash()).toBe("115.0000");
    });

    it("returns on sales without agreement keep refunding the full amount in the chosen method", async () => {
      const sale = await sell(undefined, 2, [{ method: "CASH", amountBob: "25.0000" }]);
      const result = await sales.registerReturn(scope, sale.id, returnInput(await itemId(sale.id), 1), viewAll);
      expect(result).toMatchObject({ refundAmountBob: "12.5000", refundMoneyBob: "12.5000", refundAgreementBob: "0.0000" });
    });

    it("charges are tenant-isolated and nobody can delete them", async () => {
      const { agreement, customerId } = await enrolled();
      await sell(customerId, 4, [{ method: "AGREEMENT", amountBob: "40.0000", agreementId: agreement.id }, { method: "CASH", amountBob: "10.0000" }]);
      await expect(database.withScope(scope, (client) => client.query("delete from agreement_charges"))).rejects.toMatchObject({ code: "42501" });
      const seen = await database.withScope(otherScope, (client) => client.query("select * from agreement_charges"));
      expect(seen.rowCount).toBe(0);
    });
  });
});
