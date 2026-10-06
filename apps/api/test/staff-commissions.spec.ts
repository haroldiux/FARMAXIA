import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { StaffCommissionsService } from "../src/staff/staff-commissions.service.js";

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

const id = (n: number) => `00000000-0000-4000-8000-${String(930000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const otherTenantId = id(3);
const legalEntityId = id(2);
const branchId = id(11);
const sellerA = id(21);
const sellerB = id(22);
const registerId = id(31);
const cashShiftId = id(32);
const warehouseId = id(33);
const categoryOne = id(41);
const categoryTwo = id(42);
const productOne = id(51); // category one, product rule 10%
const productTwo = id(52); // category one, category rule 5%
const productThree = id(53); // category two, default rule 2%
const presentationOne = id(61);
const presentationTwo = id(62);
const presentationThree = id(63);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const commissions = new StaffCommissionsService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const managerScope: TenantScope = { tenantId, userId: sellerA, branchId };
const sellerBScope: TenantScope = { tenantId, userId: sellerB, branchId };

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

async function rejection(promise: Promise<unknown>): Promise<{ error: unknown; body: Record<string, unknown> }> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).not.toBeNull();
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return { error, body: (response ?? {}) as Record<string, unknown> };
}

let saleCounter = 0;
async function insertSale(
  seller: string,
  lines: Array<{ presentationId: string; quantity: number; unitPrice: number }>,
  options: { status?: string; daysAgo?: number } = {}
): Promise<{ saleId: string; itemIds: string[] }> {
  saleCounter += 1;
  const status = options.status ?? "CONFIRMED";
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const sale = await ownerPool.query<{ id: string }>(
    `insert into sales (tenant_id, branch_id, cash_shift_id, warehouse_id, status, total_amount_bob, paid_amount_bob, sale_number,
                        created_by_user_id, created_at, voided_at, voided_by_user_id, void_reason)
     values ($1, $2, $3, $4, $5::varchar, $6, $6, $7, $8, now() - make_interval(days => $9),
             case when $5::varchar = 'VOIDED' then now() end, case when $5::varchar = 'VOIDED' then $8::uuid end, case when $5::varchar = 'VOIDED' then 'Error' end)
     returning id`,
    [tenantId, branchId, cashShiftId, warehouseId, status, total, `V-${saleCounter}`, seller, options.daysAgo ?? 1]
  );
  const itemIds: string[] = [];
  for (const line of lines) {
    const item = await ownerPool.query<{ id: string }>(
      `insert into sale_items (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob)
       values ($1, $2, $3, $4, $5, $5, $6, $7) returning id`,
      [tenantId, branchId, sale.rows[0]!.id, line.presentationId, line.quantity, line.unitPrice, line.quantity * line.unitPrice]
    );
    itemIds.push(item.rows[0]!.id);
  }
  return { saleId: sale.rows[0]!.id, itemIds };
}

async function insertReturn(saleId: string, itemId: string, quantity: number, unitPrice: number): Promise<void> {
  saleCounter += 1;
  const amount = quantity * unitPrice;
  const ret = await ownerPool.query<{ id: string }>(
    `insert into sale_returns (tenant_id, branch_id, sale_id, return_number, refund_method, refund_amount_bob, reason, restock, cash_shift_id, created_by_user_id)
     values ($1, $2, $3, $4, 'CASH', $5, 'Devolución', false, $6, $7) returning id`,
    [tenantId, branchId, saleId, `D-${saleCounter}`, amount, cashShiftId, sellerA]
  );
  await ownerPool.query(
    `insert into sale_return_items (tenant_id, branch_id, sale_return_id, sale_item_id, quantity, quantity_base, unit_price_bob, line_total_bob)
     values ($1, $2, $3, $4, $5, $5, $6, $7)`,
    [tenantId, branchId, ret.rows[0]!.id, itemId, quantity, unitPrice, amount]
  );
}

/** Seller A: S1 (P1 2x50, P2 1x40, P3 1x20; 1 unit of P1 returned), S2 voided, S3 outside the period. Seller B: one P2 sale of 40. */
async function seedSales(): Promise<void> {
  const s1 = await insertSale(sellerA, [
    { presentationId: presentationOne, quantity: 2, unitPrice: 50 },
    { presentationId: presentationTwo, quantity: 1, unitPrice: 40 },
    { presentationId: presentationThree, quantity: 1, unitPrice: 20 }
  ], { status: "PARTIALLY_RETURNED" });
  await insertReturn(s1.saleId, s1.itemIds[0]!, 1, 50);
  await insertSale(sellerA, [{ presentationId: presentationOne, quantity: 2, unitPrice: 50 }], { status: "VOIDED" });
  await insertSale(sellerA, [{ presentationId: presentationOne, quantity: 5, unitPrice: 50 }], { daysAgo: 60 });
  await insertSale(sellerB, [{ presentationId: presentationTwo, quantity: 1, unitPrice: 40 }]);
}

async function seedRules(): Promise<void> {
  await commissions.createRule(managerScope, { scope: "DEFAULT", ratePercent: 2 });
  await commissions.createRule(managerScope, { scope: "CATEGORY", targetId: categoryOne, ratePercent: "5" });
  await commissions.createRule(managerScope, { scope: "PRODUCT", targetId: productOne, ratePercent: "10.00" });
}

describe("F16 staff commissions (T3)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  beforeEach(async () => {
    saleCounter = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'staff-comm', 'Farmacia Comisiones'), ($2, 'staff-comm-2', 'Otra Farmacia')", [tenantId, otherTenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Comisiones SRL', '7009301')", [legalEntityId, tenantId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [branchId, tenantId, legalEntityId]);
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash) values ($1, 'comm-a@example.test', 'Ana Vendedora', 'x'), ($2, 'comm-b@example.test', 'Beto Vendedor', 'x')`,
      [sellerA, sellerB]
    );
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $3, $4)", [sellerA, sellerB, tenantId, branchId]);
    await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')", [warehouseId, tenantId, branchId]);
    await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)", [registerId, tenantId, branchId]);
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '90 days', now() + interval '8 hours', 'SCHEDULED', $5)`,
      [cashShiftId, tenantId, branchId, registerId, sellerA]
    );
    await ownerPool.query("insert into product_categories (id, tenant_id, name) values ($1, $3, 'Analgésicos'), ($2, $3, 'Higiene')", [categoryOne, categoryTwo, tenantId]);
    await ownerPool.query(
      `insert into products (id, tenant_id, name, category_id) values ($1, $4, 'Producto Uno', $5), ($2, $4, 'Producto Dos', $5), ($3, $4, 'Producto Tres', $6)`,
      [productOne, productTwo, productThree, tenantId, categoryOne, categoryTwo]
    );
    await ownerPool.query(
      `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values
         ($1, $4, $5, 'Caja x 10', 10), ($2, $4, $6, 'Caja x 20', 20), ($3, $4, $7, 'Frasco', 1)`,
      [presentationOne, presentationTwo, presentationThree, tenantId, productOne, productTwo, productThree]
    );
    await setPlan("PROFESIONAL");
  });

  describe("rules", () => {
    it("creates, lists, updates and deletes rules with precedence scopes", async () => {
      await seedRules();
      const rules = await commissions.listRules(managerScope);
      expect(rules.map((r) => [r.scope, r.ratePercent, r.targetName])).toEqual([
        ["DEFAULT", "2.00", null],
        ["CATEGORY", "5.00", "Analgésicos"],
        ["PRODUCT", "10.00", "Producto Uno"]
      ]);
      const product = rules.find((r) => r.scope === "PRODUCT")!;
      const updated = await commissions.updateRule(managerScope, product.id, { ratePercent: "12.5", isActive: false });
      expect(updated).toMatchObject({ ratePercent: "12.50", isActive: false });
      await commissions.deleteRule(managerScope, product.id);
      expect(await commissions.listRules(managerScope)).toHaveLength(2);
      expect((await rejection(commissions.deleteRule(managerScope, product.id))).error).toBeInstanceOf(NotFoundException);
    });

    it("validates rate, scope/target and rejects duplicates", async () => {
      const cases: Array<[unknown, string]> = [
        [{ scope: "DEFAULT", ratePercent: 101 }, "ratePercent"],
        [{ scope: "DEFAULT", ratePercent: -1 }, "ratePercent"],
        [{ scope: "DEFAULT", ratePercent: "abc" }, "ratePercent"],
        [{ scope: "DEFAULT", ratePercent: 1.234 }, "ratePercent"],
        [{ scope: "WEEKEND", ratePercent: 1 }, "scope"],
        [{ scope: "DEFAULT", targetId: categoryOne, ratePercent: 1 }, "targetId"],
        [{ scope: "PRODUCT", ratePercent: 1 }, "targetId"],
        [{ scope: "PRODUCT", targetId: id(777), ratePercent: 1 }, "targetId"]
      ];
      for (const [input, field] of cases) {
        const { error, body } = await rejection(commissions.createRule(managerScope, input as never));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.field).toBe(field);
      }
      await commissions.createRule(managerScope, { scope: "DEFAULT", ratePercent: 1 });
      const duplicate = await rejection(commissions.createRule(managerScope, { scope: "DEFAULT", ratePercent: 3 }));
      expect(duplicate.error).toBeInstanceOf(ConflictException);
      expect(duplicate.body.code).toBe("RULE_EXISTS");
      await commissions.createRule(managerScope, { scope: "PRODUCT", targetId: productOne, ratePercent: 3 });
      expect((await rejection(commissions.createRule(managerScope, { scope: "PRODUCT", targetId: productOne, ratePercent: 4 }))).body.code).toBe("RULE_EXISTS");
    });

    it("isolates rules between tenants through RLS", async () => {
      await commissions.createRule(managerScope, { scope: "DEFAULT", ratePercent: 2 });
      await ownerPool.query("insert into commission_rules (tenant_id, scope, rate_percent) values ($1, 'DEFAULT', 9)", [otherTenantId]);
      const own = await database.withScope(managerScope, (c) => c.query("select tenant_id from commission_rules"));
      expect(own.rows.map((r: { tenant_id: string }) => r.tenant_id)).toEqual([tenantId]);
    });
  });

  describe("report", () => {
    it("applies product > category > default precedence, nets returns and excludes voided and out-of-period sales", async () => {
      await seedRules();
      await seedSales();
      const report = await commissions.report(managerScope, period);
      expect(report.multilevelApplied).toBe(false);
      const ana = report.sellers.find((s) => s.userId === sellerA)!;
      expect(ana.userName).toBe("Ana Vendedora");
      expect(ana.netSalesBob).toBe("110.00");
      expect(ana.commissionBob).toBe("7.40");
      const byProduct = Object.fromEntries(ana.lines.map((l) => [l.productName, l]));
      expect(byProduct["Producto Uno"]).toMatchObject({ lineTotalBob: "100.00", returnedBob: "50.00", netBob: "50.00", ratePercent: "10.00", rateSource: "PRODUCT", commissionBob: "5.00" });
      expect(byProduct["Producto Dos"]).toMatchObject({ netBob: "40.00", ratePercent: "5.00", rateSource: "CATEGORY", commissionBob: "2.00" });
      expect(byProduct["Producto Tres"]).toMatchObject({ netBob: "20.00", ratePercent: "2.00", rateSource: "DEFAULT", commissionBob: "0.40" });
      expect(ana.lines).toHaveLength(3);
      const beto = report.sellers.find((s) => s.userId === sellerB)!;
      expect(beto.commissionBob).toBe("2.00");
      expect(report.totalCommissionBob).toBe("9.40");
    });

    it("ignores inactive rules and pays nothing without any rule", async () => {
      await seedSales();
      const none = await commissions.report(managerScope, period);
      expect(none.totalCommissionBob).toBe("0.00");
      expect(none.sellers[0]!.lines[0]!.rateSource).toBe("NONE");
      await seedRules();
      const rules = await commissions.listRules(managerScope);
      await commissions.updateRule(managerScope, rules.find((r) => r.scope === "PRODUCT")!.id, { isActive: false });
      const report = await commissions.report(managerScope, period);
      const ana = report.sellers.find((s) => s.userId === sellerA)!;
      expect(ana.lines.find((l) => l.productName === "Producto Uno")).toMatchObject({ rateSource: "CATEGORY", ratePercent: "5.00" });
    });

    it("overrides the line rate with the reached tier only on Premium and only when higher", async () => {
      await seedRules();
      await seedSales();
      await setPlan("PREMIUM");
      await commissions.createTier(managerScope, { minNetSalesBob: 100, ratePercent: 6 });
      await commissions.createTier(managerScope, { minNetSalesBob: 5000, ratePercent: 20 });
      const report = await commissions.report(managerScope, period);
      expect(report.multilevelApplied).toBe(true);
      const ana = report.sellers.find((s) => s.userId === sellerA)!;
      expect(ana.tierRatePercent).toBe("6.00");
      const byProduct = Object.fromEntries(ana.lines.map((l) => [l.productName, l]));
      expect(byProduct["Producto Uno"]).toMatchObject({ ratePercent: "10.00", rateSource: "PRODUCT", commissionBob: "5.00" });
      expect(byProduct["Producto Dos"]).toMatchObject({ ratePercent: "6.00", rateSource: "TIER", commissionBob: "2.40" });
      expect(byProduct["Producto Tres"]).toMatchObject({ ratePercent: "6.00", rateSource: "TIER", commissionBob: "1.20" });
      expect(ana.commissionBob).toBe("8.60");
      const beto = report.sellers.find((s) => s.userId === sellerB)!;
      expect(beto.tierRatePercent).toBeNull();
      expect(beto.commissionBob).toBe("2.00");

      await setPlan("PROFESIONAL");
      const simple = await commissions.report(managerScope, period);
      expect(simple.multilevelApplied).toBe(false);
      expect(simple.sellers.find((s) => s.userId === sellerA)!.commissionBob).toBe("7.40");
    });

    it("validates the period and lets a seller read only their own commissions", async () => {
      await seedRules();
      await seedSales();
      expect((await rejection(commissions.report(managerScope, { from: "2026-02-31", to: "2026-03-01" }))).body.field).toBe("from");
      expect((await rejection(commissions.report(managerScope, { from: period.to, to: period.from }))).body.field).toBe("to");
      expect((await rejection(commissions.report(managerScope, {} as never))).body.field).toBe("from");
      const mine = await commissions.myReport(sellerBScope, period);
      expect(mine.sellers.map((s) => s.userId)).toEqual([sellerB]);
      expect(mine.totalCommissionBob).toBe("2.00");
      const none = await commissions.myReport(managerScope, { from: isoDay(-400), to: isoDay(-300) });
      expect(none.sellers).toEqual([]);
    });
  });

  describe("tiers", () => {
    it("manages tiers on Premium and rejects them on Profesional", async () => {
      expect((await rejection(commissions.createTier(managerScope, { minNetSalesBob: 100, ratePercent: 5 }))).body).toMatchObject({
        code: "PLAN_FEATURE_RESTRICTED",
        feature: "staff.commissions.multilevel"
      });
      expect((await rejection(commissions.listTiers(managerScope))).body.code).toBe("PLAN_FEATURE_RESTRICTED");

      await setPlan("PREMIUM");
      const tier = await commissions.createTier(managerScope, { minNetSalesBob: "1000", ratePercent: "8" });
      expect(tier).toMatchObject({ minNetSalesBob: "1000.00", ratePercent: "8.00" });
      await commissions.createTier(managerScope, { minNetSalesBob: 100, ratePercent: 4 });
      expect((await commissions.listTiers(managerScope)).map((t) => t.minNetSalesBob)).toEqual(["100.00", "1000.00"]);
      expect((await rejection(commissions.createTier(managerScope, { minNetSalesBob: 100, ratePercent: 9 }))).body.code).toBe("TIER_EXISTS");
      expect((await rejection(commissions.createTier(managerScope, { minNetSalesBob: -5, ratePercent: 9 }))).body.field).toBe("minNetSalesBob");
      expect((await rejection(commissions.createTier(managerScope, { minNetSalesBob: 5, ratePercent: 120 }))).body.field).toBe("ratePercent");
      const updated = await commissions.updateTier(managerScope, tier.id, { ratePercent: 9.5 });
      expect(updated.ratePercent).toBe("9.50");
      await commissions.deleteTier(managerScope, tier.id);
      expect(await commissions.listTiers(managerScope)).toHaveLength(1);
    });
  });

  describe("plan gating", () => {
    it("returns 403 PLAN_FEATURE_RESTRICTED on BASICO for rules and reports", async () => {
      await setPlan("BASICO");
      for (const call of [
        () => commissions.listRules(managerScope),
        () => commissions.createRule(managerScope, { scope: "DEFAULT", ratePercent: 1 }),
        () => commissions.report(managerScope, period),
        () => commissions.myReport(managerScope, period)
      ]) {
        const { error, body } = await rejection(call());
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(body).toMatchObject({ code: "PLAN_FEATURE_RESTRICTED", feature: "staff.commissions" });
      }
    });
  });
});
