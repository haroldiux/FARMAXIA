import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from "../src/auth/auth.decorators.js";
import { CustomersService } from "../src/customers/customers.service.js";
import { LoyaltyController } from "../src/customers/loyalty.controller.js";
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

const id = (n: number) => `00000000-0000-4000-8000-${String(960000 + n).padStart(12, "0")}`;
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
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId: cashierId, branchId };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };
const viewAll = { viewAll: true };

let counter = 0;
const key = () => `crm-${++counter}`;

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

type Payment = { method: string; amountBob: string; reference?: string };

/** Unit price 12.5; a sale of `quantity` units totals quantity * 12.5. */
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

async function newCustomer(name = "Cliente Puntos", doc = "7001"): Promise<string> {
  return (await customers.create(scope, { fullName: name, docType: "CI", docNumber: doc })).id;
}

async function balance(customerId: string): Promise<number> {
  const result = await ownerPool.query<{ b: string }>(
    "select coalesce(sum(points), 0)::text as b from loyalty_movements where customer_id = $1",
    [customerId]
  );
  return Number(result.rows[0]!.b);
}

async function movements(customerId: string): Promise<Array<{ kind: string; points: number; saleId: string | null; reason: string }>> {
  const result = await ownerPool.query(
    `select kind, points, sale_id as "saleId", reason from loyalty_movements where customer_id = $1 order by created_at, id`,
    [customerId]
  );
  return result.rows;
}

async function expectedCash(): Promise<string> {
  const result = await ownerPool.query<{ v: string }>("select expected_amount_bob::text as v from cash_shift_controls where cash_shift_id = $1", [shiftId]);
  return result.rows[0]!.v;
}

async function itemId(saleId: string): Promise<string> {
  return (await sales.detail(scope, saleId, viewAll)).items[0]!.id;
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

describe("F17 CRM loyalty (T2, T3)", () => {
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
      "insert into tenants (id, slug, name) values ($1, 'crm-loy', 'Farmacia Puntos'), ($2, 'crm-loy-2', 'Otra')",
      [tenantId, otherTenantId]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Puntos SRL', '7009601'), ($3, $4, 'Otra SRL', '7009602')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central'), ($4, $5, $6, 'MAIN', 'Otra')",
      [branchId, tenantId, legalEntityId, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, 'loy-a@example.test', 'Cajero', 'x'), ($2, 'loy-b@example.test', 'Otro', 'x')",
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
    await setPlan("PROFESIONAL");
    await setPlan("PROFESIONAL", otherTenantId);
  });

  describe("settings, balance and manual adjustments", () => {
    it("returns the defaults, updates them and audits the change", async () => {
      expect(await loyalty.getSettings(scope)).toEqual({ enabled: true, bobPerPoint: "10.0000", pointValueBob: "0.1000" });
      const updated = await loyalty.updateSettings(scope, { enabled: true, bobPerPoint: "5", pointValueBob: 0.2 });
      expect(updated).toEqual({ enabled: true, bobPerPoint: "5.0000", pointValueBob: "0.2000" });
      expect(await loyalty.getSettings(scope)).toEqual(updated);
      const partial = await loyalty.updateSettings(scope, { enabled: false });
      expect(partial).toEqual({ enabled: false, bobPerPoint: "5.0000", pointValueBob: "0.2000" });
      const audits = await ownerPool.query("select action from audit_events where action = 'crm.loyalty_settings.updated'");
      expect(audits.rowCount).toBe(2);
    });

    it("validates settings", async () => {
      for (const input of [{ bobPerPoint: 0 }, { bobPerPoint: "abc" }, { pointValueBob: -1 }, { pointValueBob: "0.00001" }, { enabled: "yes" }, {}]) {
        const { error, body } = await rejection(loyalty.updateSettings(scope, input as never));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.code).toBe("INVALID_INPUT");
      }
    });

    it("is gated by the plan: BASICO gets 403 PLAN_FEATURE_RESTRICTED on every loyalty operation", async () => {
      const customerId = await newCustomer();
      await setPlan("BASICO");
      for (const call of [
        () => loyalty.getSettings(scope),
        () => loyalty.updateSettings(scope, { enabled: true }),
        () => loyalty.customerLoyalty(scope, customerId, {}),
        () => loyalty.adjust(scope, customerId, { points: 5, reason: "Bono" })
      ]) {
        const { error, body } = await rejection(call());
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(body.code).toBe("PLAN_FEATURE_RESTRICTED");
        expect(body.feature).toBe("crm.loyalty");
      }
    });

    it("adjusts points with a reason, keeps the balance and never goes negative", async () => {
      const customerId = await newCustomer();
      const added = await loyalty.adjust(scope, customerId, { points: 50, reason: " Bono de bienvenida " });
      expect(added).toMatchObject({ kind: "ADJUST", points: 50, reason: "Bono de bienvenida" });
      await loyalty.adjust(scope, customerId, { points: -20, reason: "Corrección" });
      const view = await loyalty.customerLoyalty(scope, customerId, {});
      expect(view.balance).toBe(30);
      expect(view.settings).toEqual({ enabled: true, bobPerPoint: "10.0000", pointValueBob: "0.1000" });
      expect(view.movements.items.map((m) => [m.kind, m.points])).toEqual([["ADJUST", -20], ["ADJUST", 50]]);
      expect(view.movements.total).toBe(2);
      const tooMuch = await rejection(loyalty.adjust(scope, customerId, { points: -31, reason: "Exceso" }));
      expect(tooMuch.error).toBeInstanceOf(BadRequestException);
      expect(tooMuch.body.code).toBe("INSUFFICIENT_POINTS");
      for (const input of [{ points: 0, reason: "x" }, { points: 1.5, reason: "x" }, { points: 5, reason: " " }, { points: 5 }, { points: 2_000_000, reason: "x" }]) {
        expect((await rejection(loyalty.adjust(scope, customerId, input as never))).body.code).toBe("INVALID_INPUT");
      }
      expect((await rejection(loyalty.adjust(scope, id(990), { points: 5, reason: "x" }))).error).toBeInstanceOf(NotFoundException);
      const paged = await loyalty.customerLoyalty(scope, customerId, { limit: 1, offset: 1 });
      expect(paged.movements.items).toHaveLength(1);
    });

    it("isolates pharmacies (RLS) and keeps the ledger immutable for the application role", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 10, reason: "Bono" });
      expect((await rejection(loyalty.customerLoyalty(otherScope, customerId, {}))).error).toBeInstanceOf(NotFoundException);
      const seen = await database.withScope(otherScope, (client) => client.query("select * from loyalty_movements"));
      expect(seen.rowCount).toBe(0);
      await expect(database.withScope(scope, (client) => client.query("update loyalty_movements set points = 999"))).rejects.toThrow(/permission denied/);
      await expect(database.withScope(scope, (client) => client.query("delete from loyalty_movements"))).rejects.toThrow(/permission denied/);
    });

    it("declares permissions and feature on the controller", () => {
      const proto = LoyaltyController.prototype as unknown as Record<string, object>;
      for (const name of ["updateSettings", "adjust"]) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[name]!)).toEqual(["loyalty.manage"]);
      }
      for (const name of ["settings", "customerLoyalty"]) {
        expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, proto[name]!)).toEqual(expect.arrayContaining(["loyalty.manage", "sales.confirm"]));
      }
      expect(Reflect.getMetadata(FEATURE_KEY, LoyaltyController)).toBe("crm.loyalty");
    });
  });

  describe("POS: customer on the sale and earning points", () => {
    it("links the customer, earns floor(cash net of change / 10) and exposes customer and loyalty in confirm and detail", async () => {
      const customerId = await newCustomer();
      const sale = await sell(customerId, 3, [{ method: "CASH", amountBob: "40.0000" }]); // total 37.5, change 2.5
      expect(sale.customer).toEqual({ id: customerId, fullName: "Cliente Puntos", docType: "CI", docNumber: "7001" });
      expect(sale.loyalty).toEqual({ earned: 3, redeemed: 0, balance: 3 });
      expect(await movements(customerId)).toEqual([{ kind: "EARN", points: 3, saleId: sale.id, reason: expect.stringContaining(sale.saleNumber) }]);
      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.customer).toEqual({ id: customerId, fullName: "Cliente Puntos", docType: "CI", docNumber: "7001" });
      expect(detail.loyalty).toEqual({ earned: 3, redeemed: 0, balance: 3 });
      const stored = await ownerPool.query("select customer_id from sales where id = $1", [sale.id]);
      expect(stored.rows[0].customer_id).toBe(customerId);
    });

    it("counts CARD and QR in full and honors custom settings", async () => {
      const customerId = await newCustomer();
      const mixed = await sell(customerId, 4, [
        { method: "CARD", amountBob: "20.0000", reference: "POS-1" },
        { method: "CASH", amountBob: "40.0000" } // total 50: change 10, cash net 30
      ]);
      expect(mixed.loyalty).toEqual({ earned: 5, redeemed: 0, balance: 5 });
      await loyalty.updateSettings(scope, { bobPerPoint: "5" });
      const custom = await sell(customerId, 2, [{ method: "QR", amountBob: "25.0000", reference: "QR-1" }]);
      expect(custom.loyalty).toEqual({ earned: 5, redeemed: 0, balance: 10 });
    });

    it("sales without a customer behave as before: no customer, no loyalty", async () => {
      const sale = await sell(undefined, 1, [{ method: "CASH", amountBob: "12.5000" }]);
      expect(sale.customer).toBeNull();
      expect(sale.loyalty).toBeNull();
      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.customer).toBeNull();
      expect(detail.loyalty).toBeNull();
      expect((await ownerPool.query("select count(*)::int as n from loyalty_movements")).rows[0].n).toBe(0);
    });

    it("rejects an unknown, foreign or malformed customer and an inactive one", async () => {
      const foreign = await customers.create(otherScope, { fullName: "Ajeno" });
      const unknown = await rejection(sell(id(995), 1, [{ method: "CASH", amountBob: "12.5000" }]));
      expect(unknown.error).toBeInstanceOf(NotFoundException);
      expect(unknown.body.code).toBe("CUSTOMER_NOT_FOUND");
      expect((await rejection(sell(foreign.id, 1, [{ method: "CASH", amountBob: "12.5000" }]))).body.code).toBe("CUSTOMER_NOT_FOUND");
      expect((await rejection(sell("no-uuid", 1, [{ method: "CASH", amountBob: "12.5000" }]))).error).toBeInstanceOf(BadRequestException);
      const customerId = await newCustomer();
      await customers.update(scope, customerId, { isActive: false });
      const inactive = await rejection(sell(customerId, 1, [{ method: "CASH", amountBob: "12.5000" }]));
      expect(inactive.body.code).toBe("CUSTOMER_INACTIVE");
      expect((await ownerPool.query("select count(*)::int as n from sales")).rows[0].n).toBe(0);
    });

    it("on a plan without crm.loyalty the sale goes through with the customer but earns nothing; POINTS is 403", async () => {
      const customerId = await newCustomer();
      await setPlan("BASICO");
      const sale = await sell(customerId, 4, [{ method: "CASH", amountBob: "50.0000" }]);
      expect(sale.customer).toMatchObject({ id: customerId });
      expect(sale.loyalty).toBeNull();
      expect(await movements(customerId)).toEqual([]);
      const points = await rejection(sell(customerId, 1, [{ method: "POINTS", amountBob: "1.0000" }, { method: "CASH", amountBob: "11.5000" }]));
      expect(points.error).toBeInstanceOf(ForbiddenException);
      expect(points.body).toMatchObject({ code: "PLAN_FEATURE_RESTRICTED", feature: "crm.loyalty" });
    });

    it("earns nothing and refuses POINTS when the pharmacy turned loyalty off", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 100, reason: "Bono" });
      await loyalty.updateSettings(scope, { enabled: false });
      const sale = await sell(customerId, 4, [{ method: "CASH", amountBob: "50.0000" }]);
      expect(sale.loyalty).toBeNull();
      const refused = await rejection(sell(customerId, 1, [{ method: "POINTS", amountBob: "1.0000" }, { method: "CASH", amountBob: "11.5000" }]));
      expect(refused.error).toBeInstanceOf(BadRequestException);
      expect(refused.body.code).toBe("LOYALTY_DISABLED");
      expect(await balance(customerId)).toBe(100);
    });

    it("replaying the same idempotency key does not earn twice", async () => {
      const customerId = await newCustomer();
      const input = {
        idempotencyKey: "same-key", cashShiftId: shiftId, warehouseId, customerId,
        payments: [{ method: "CASH", amountBob: "50.0000" }],
        lines: [{ presentationId, quantity: 4, unitPriceBob: "12.5000" }]
      };
      const first = await sales.confirm(scope, input);
      const second = await sales.confirm(scope, input);
      expect(second.id).toBe(first.id);
      expect(await balance(customerId)).toBe(5);
    });
  });

  describe("POS: redeeming with the POINTS payment", () => {
    it("pays part of the sale with points: no drawer effect, earns on the rest, balance reflects both", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 100, reason: "Bono" }); // worth 10.00 BOB
      const sale = await sell(customerId, 3, [
        { method: "POINTS", amountBob: "10.0000" },
        { method: "CASH", amountBob: "27.5000" }
      ]);
      expect(sale.loyalty).toEqual({ earned: 2, redeemed: 100, balance: 2 });
      expect(sale.payments.map((p) => [p.method, p.amountBob, p.reference])).toEqual([
        ["POINTS", "10.0000", null],
        ["CASH", "27.5000", null]
      ]);
      expect(await expectedCash()).toBe("127.5000");
      expect((await movements(customerId)).map((m) => [m.kind, m.points])).toEqual([["ADJUST", 100], ["REDEEM", -100], ["EARN", 2]]);
      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.loyalty).toEqual({ earned: 2, redeemed: 100, balance: 2 });
      expect(detail.payments.find((p) => p.method === "POINTS")).toEqual({ method: "POINTS", amountBob: "10.0000", reference: null, reversed: false });
    });

    it("can pay the whole sale with points and earns nothing", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 125, reason: "Bono" });
      const sale = await sell(customerId, 1, [{ method: "POINTS", amountBob: "12.5000" }]);
      expect(sale.loyalty).toEqual({ earned: 0, redeemed: 125, balance: 0 });
      expect(await expectedCash()).toBe("100.0000");
    });

    it("honors a custom point value", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 20, reason: "Bono" });
      await loyalty.updateSettings(scope, { pointValueBob: "0.5" });
      const sale = await sell(customerId, 1, [{ method: "POINTS", amountBob: "10.0000" }, { method: "CASH", amountBob: "2.5000" }]);
      expect(sale.loyalty).toEqual({ earned: 0, redeemed: 20, balance: 0 });
    });

    it("rejects invalid POINTS payments and leaves stock, cash and ledger untouched", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 100, reason: "Bono" });
      const cash = [{ method: "CASH", amountBob: "30.0000" }];
      const cases: Array<[string | undefined, Payment[], string, number]> = [
        [undefined, [{ method: "POINTS", amountBob: "1.0000" }, ...cash], "INVALID_INPUT", 400],
        [customerId, [{ method: "POINTS", amountBob: "1.0000", reference: "X" }, ...cash], "INVALID_INPUT", 400],
        [customerId, [{ method: "POINTS", amountBob: "0.0500" }, ...cash], "INVALID_INPUT", 400],
        [customerId, [{ method: "POINTS", amountBob: "1.0000" }, { method: "POINTS", amountBob: "1.0000" }, ...cash], "INVALID_INPUT", 400],
        [customerId, [{ method: "POINTS", amountBob: "10.1000" }, { method: "CASH", amountBob: "30.0000" }], "INSUFFICIENT_POINTS", 400]
      ];
      for (const [customer, payments, code, status] of cases) {
        const { error, body } = await rejection(sell(customer, 3, payments));
        expect((error as { getStatus: () => number }).getStatus()).toBe(status);
        expect(body.code ?? "INVALID_INPUT").toBe(code);
      }
      // Points can never exceed the amount due (non-cash cannot exceed the total).
      await loyalty.adjust(scope, customerId, { points: 900, reason: "Más puntos" });
      const over = await rejection(sell(customerId, 1, [{ method: "POINTS", amountBob: "20.0000" }]));
      expect(over.error).toBeInstanceOf(BadRequestException);
      expect(await balance(customerId)).toBe(1000);
      expect(await expectedCash()).toBe("100.0000");
      expect((await ownerPool.query("select count(*)::int as n from sales")).rows[0].n).toBe(0);
      const stock = await ownerPool.query("select quantity_base::text as q from inventory_balances where batch_id = $1", [batchId]);
      expect(stock.rows[0].q).toBe("1000");
    });
  });

  describe("T3: void and returns", () => {
    it("void gives back redeemed points and reverses the earned ones", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 100, reason: "Bono" });
      const sale = await sell(customerId, 3, [{ method: "POINTS", amountBob: "10.0000" }, { method: "CASH", amountBob: "27.5000" }]);
      expect(await balance(customerId)).toBe(2);
      const voided = await sales.voidSale(scope, sale.id, { idempotencyKey: key(), reason: "Error" }, viewAll);
      expect(voided).toMatchObject({ status: "VOIDED", loyalty: { earnedReversed: 2, redeemedReturned: 100, shortfall: 0 } });
      expect(await balance(customerId)).toBe(100);
      expect((await movements(customerId)).map((m) => [m.kind, m.points])).toEqual([
        ["ADJUST", 100], ["REDEEM", -100], ["EARN", 2], ["REVERSAL", 100], ["REVERSAL", -2]
      ]);
      expect(await expectedCash()).toBe("100.0000");
      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.payments.find((p) => p.method === "POINTS")?.reversed).toBe(true);
    });

    it("void reverses only what the customer still holds and records the shortfall in the reason", async () => {
      const customerId = await newCustomer();
      const first = await sell(customerId, 3, [{ method: "CASH", amountBob: "37.5000" }]); // earns 3
      // The customer spends 3 points (0.30 BOB) on another sale, which earns 1 point.
      await sell(customerId, 1, [{ method: "POINTS", amountBob: "0.3000" }, { method: "CASH", amountBob: "12.2000" }]);
      expect(await balance(customerId)).toBe(1);
      const voided = await sales.voidSale(scope, first.id, { idempotencyKey: key(), reason: "Error" }, viewAll);
      expect(voided).toMatchObject({ loyalty: { earnedReversed: 1, redeemedReturned: 0, shortfall: 2 } });
      expect(await balance(customerId)).toBe(0);
      const reversal = (await movements(customerId)).find((m) => m.kind === "REVERSAL")!;
      expect(reversal.points).toBe(-1);
      expect(reversal.reason).toMatch(/2/);
    });

    it("voiding a sale without customer keeps the response and ledger unchanged", async () => {
      const sale = await sell(undefined, 1, [{ method: "CASH", amountBob: "12.5000" }]);
      const voided = await sales.voidSale(scope, sale.id, { idempotencyKey: key(), reason: "Error" }, viewAll);
      expect(voided).not.toHaveProperty("loyalty");
      expect((await ownerPool.query("select count(*)::int as n from loyalty_movements")).rows[0].n).toBe(0);
    });

    it("void works even if the plan lost crm.loyalty meanwhile (ledger based)", async () => {
      const customerId = await newCustomer();
      const sale = await sell(customerId, 4, [{ method: "CASH", amountBob: "50.0000" }]);
      await setPlan("BASICO");
      const voided = await sales.voidSale(scope, sale.id, { idempotencyKey: key(), reason: "Error" }, viewAll);
      expect(voided).toMatchObject({ loyalty: { earnedReversed: 5 } });
      expect(await balance(customerId)).toBe(0);
    });

    it("partial returns split the refund proportionally to the payment mix (cumulative, floored)", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 100, reason: "Bono" });
      const sale = await sell(customerId, 3, [{ method: "POINTS", amountBob: "10.0000" }, { method: "CASH", amountBob: "27.5000" }]);
      expect(sale.loyalty).toMatchObject({ earned: 2, redeemed: 100 });
      const item = await itemId(sale.id);
      expect(await expectedCash()).toBe("127.5000");

      // 1 of 3 units: 12.5 of 37.5 -> floor(100 * 1/3) = 33 points back (3.30 BOB), 9.20 BOB in cash, floor(2 * 1/3) = 0 earned reversed.
      const first = await sales.registerReturn(scope, sale.id, returnInput(item, 1), viewAll);
      expect(first).toMatchObject({
        refundAmountBob: "12.5000",
        refundMoneyBob: "9.2000",
        refundPointsBob: "3.3000",
        loyalty: { pointsReturned: 33, earnedReversed: 0, shortfall: 0 }
      });
      expect(await expectedCash()).toBe("118.3000");
      expect(await balance(customerId)).toBe(2 + 33);

      // Remaining 2 units close the sale: the rest of the points (67) and of the earned ones (2).
      const second = await sales.registerReturn(scope, sale.id, returnInput(item, 2), viewAll);
      expect(second).toMatchObject({
        saleStatus: "RETURNED",
        refundAmountBob: "25.0000",
        refundMoneyBob: "18.3000",
        refundPointsBob: "6.7000",
        loyalty: { pointsReturned: 67, earnedReversed: 2, shortfall: 0 }
      });
      expect(await expectedCash()).toBe("100.0000");
      expect(await balance(customerId)).toBe(100);

      const detail = await sales.detail(scope, sale.id, viewAll);
      expect(detail.returns.map((r) => [r.refundAmountBob, r.pointsReturned, r.refundPointsBob])).toEqual([
        ["12.5000", 33, "3.3000"],
        ["25.0000", 67, "6.7000"]
      ]);
    });

    it("a return of a sale paid entirely with points moves no money and needs no cash movement", async () => {
      const customerId = await newCustomer();
      await loyalty.adjust(scope, customerId, { points: 125, reason: "Bono" });
      const sale = await sell(customerId, 1, [{ method: "POINTS", amountBob: "12.5000" }]);
      const result = await sales.registerReturn(scope, sale.id, returnInput(await itemId(sale.id), 1), viewAll);
      expect(result).toMatchObject({ refundAmountBob: "12.5000", refundMoneyBob: "0.0000", refundPointsBob: "12.5000", loyalty: { pointsReturned: 125 } });
      expect(await balance(customerId)).toBe(125);
      expect(await expectedCash()).toBe("100.0000");
      expect((await ownerPool.query("select count(*)::int as n from cash_movements")).rows[0].n).toBe(0);
    });

    it("returns on sales with a customer but no points keep refunding the full amount in the chosen method", async () => {
      const customerId = await newCustomer();
      const sale = await sell(customerId, 4, [{ method: "CASH", amountBob: "50.0000" }]); // earns 5
      const result = await sales.registerReturn(scope, sale.id, returnInput(await itemId(sale.id), 2), viewAll);
      expect(result).toMatchObject({ refundAmountBob: "25.0000", refundMoneyBob: "25.0000", refundPointsBob: "0.0000", loyalty: { pointsReturned: 0, earnedReversed: 2 } });
      expect(await expectedCash()).toBe("125.0000");
      expect(await balance(customerId)).toBe(3);
    });

    it("returns without a customer do not expose loyalty and refund as before", async () => {
      const sale = await sell(undefined, 2, [{ method: "CASH", amountBob: "25.0000" }]);
      const result = await sales.registerReturn(scope, sale.id, returnInput(await itemId(sale.id), 1), viewAll);
      expect(result).toMatchObject({ refundAmountBob: "12.5000", refundMoneyBob: "12.5000", refundPointsBob: "0.0000" });
      expect(result).not.toHaveProperty("loyalty");
    });
  });
});
