import fastifyCookie from "@fastify/cookie";
import { ForbiddenException } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenService } from "../src/auth/access-token.service.js";
import { AnalyticsService } from "../src/analytics/analytics.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
const role = (name: string) =>
  withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? role("farmaxia_app");
const testAuthUrl = process.env.DATABASE_AUTH_TEST_URL ?? role("farmaxia_auth");

// Needed only for the HTTP-level gate tests, which boot the real AppModule.
process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_AUTH_URL = testAuthUrl;

const id = (n: number) => `00000000-0000-4000-8000-${String(990000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchA = id(11);
const branchB = id(12);
const ownerUser = id(21); // analytics.read, member of A and B
const branchAOnlyUser = id(22); // analytics.read, member of A only
const plainUser = id(23); // no analytics.read, member of A
const warehouseA = id(31);
const warehouseB = id(32);
const registerA = id(41);
const shiftA = id(42);
const registerB = id(43);
const shiftB = id(44);
const productA = id(51);
const productB = id(52);
const productC = id(53);
const productD = id(54);
const productE = id(55);
const pA = id(61); // Caja x 10 (factor 10), laboratory "Bago"
const pB = id(62); // Blister (factor 1), laboratory " bago "
const pC = id(63); // no laboratory, no cost
const pD = id(64); // laboratory "Vita", sold in branch B
const pE = id(65); // stock without sales
const roleAnalytics = id(71);
const roleNone = id(72);

const otherTenantId = id(101);
const otherLegalEntityId = id(102);
const otherBranchId = id(111);
const otherUser = id(121);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const analytics = new AnalyticsService(database);
const accessTokens = new AccessTokenService();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scopeFor = (userId: string, branchId: string, tenant = tenantId): TenantScope => ({ tenantId: tenant, userId, branchId });
const ownerScope = scopeFor(ownerUser, branchA);

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
const period = { from: isoDay(-3), to: isoDay(0) }; // 4 inclusive days

async function setPlan(planCode: string, tenant = tenantId): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenant]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query("insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())", [
    tenant,
    plan.rows[0]!.id
  ]);
}

let counter = 0;
async function insertSale(
  branch: string,
  shift: string,
  warehouse: string,
  lines: Array<{ presentationId: string; quantity: number; factor: number; unitPrice: number; unitCostBase: number | null }>,
  status = "CONFIRMED"
): Promise<{ saleId: string; itemIds: string[] }> {
  counter += 1;
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const sale = await ownerPool.query<{ id: string }>(
    `insert into sales (tenant_id, branch_id, cash_shift_id, warehouse_id, status, total_amount_bob, paid_amount_bob, sale_number,
                        created_by_user_id, created_at, voided_at, voided_by_user_id, void_reason)
     values ($1, $2, $3, $4, $5::varchar, $6, $6, $7, $8, now() - interval '1 day',
             case when $5::varchar = 'VOIDED' then now() end, case when $5::varchar = 'VOIDED' then $8::uuid end, case when $5::varchar = 'VOIDED' then 'Error' end)
     returning id`,
    [tenantId, branch, shift, warehouse, status, total, `A-${counter}`, ownerUser]
  );
  const itemIds: string[] = [];
  for (const line of lines) {
    const item = await ownerPool.query<{ id: string }>(
      `insert into sale_items (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob, unit_cost_base_bob)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [tenantId, branch, sale.rows[0]!.id, line.presentationId, line.quantity, line.quantity * line.factor, line.unitPrice, line.quantity * line.unitPrice, line.unitCostBase]
    );
    itemIds.push(item.rows[0]!.id);
  }
  return { saleId: sale.rows[0]!.id, itemIds };
}

async function insertReturn(branch: string, shift: string, saleId: string, itemId: string, quantity: number, factor: number, unitPrice: number): Promise<void> {
  counter += 1;
  const amount = quantity * unitPrice;
  const ret = await ownerPool.query<{ id: string }>(
    `insert into sale_returns (tenant_id, branch_id, sale_id, return_number, refund_method, refund_amount_bob, reason, restock, cash_shift_id, created_by_user_id)
     values ($1, $2, $3, $4, 'CASH', $5, 'Devolución', false, $6, $7) returning id`,
    [tenantId, branch, saleId, `R-${counter}`, amount, shift, ownerUser]
  );
  await ownerPool.query(
    `insert into sale_return_items (tenant_id, branch_id, sale_return_id, sale_item_id, quantity, quantity_base, unit_price_bob, line_total_bob)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, branch, ret.rows[0]!.id, itemId, quantity, quantity * factor, unitPrice, amount]
  );
}

async function insertStock(
  warehouse: string,
  presentationId: string,
  lot: string,
  quantity: number,
  reserved: number,
  options: { expiresInDays?: number; status?: string } = {}
): Promise<void> {
  const batch = await ownerPool.query<{ id: string }>(
    `insert into inventory_batches (tenant_id, presentation_id, lot_code, expires_on, unit_cost, status)
     values ($1, $2, $3, current_date + $4::int, 1.0000, $5) returning id`,
    [tenantId, presentationId, lot, options.expiresInDays ?? 300, options.status ?? "AVAILABLE"]
  );
  await ownerPool.query(
    "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, $4, $5)",
    [tenantId, warehouse, batch.rows[0]!.id, quantity, reserved]
  );
}

async function seedTenant(): Promise<void> {
  await ownerPool.query(
    `insert into permissions (code, description, label, module, sort_order)
     values ('analytics.read', 'Read analytics reports', 'Ver analítica del negocio', 'Analítica', 79)
     on conflict (code) do nothing`
  );
  await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'analytics', 'Farmacia Analitica'), ($2, 'analytics-other', 'Otra Farmacia')", [tenantId, otherTenantId]);
  await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Analitica SRL', '9909001'), ($3, $4, 'Otra SRL', '9909002')", [
    legalEntityId,
    tenantId,
    otherLegalEntityId,
    otherTenantId
  ]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $3, $4, 'MAIN', 'Central'), ($2, $3, $4, 'SUR', 'Sur')", [branchA, branchB, tenantId, legalEntityId]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'OTRA', 'Otra')", [otherBranchId, otherTenantId, otherLegalEntityId]);
  await ownerPool.query(
    `insert into users (id, email, display_name, password_hash) values
       ($1, 'an-owner@example.test', 'Duena', 'x'), ($2, 'an-a@example.test', 'Solo A', 'x'),
       ($3, 'an-plain@example.test', 'Sin permiso', 'x'), ($4, 'an-other@example.test', 'Otra', 'x')`,
    [ownerUser, branchAOnlyUser, plainUser, otherUser]
  );
  await ownerPool.query(
    `insert into user_branch_memberships (user_id, tenant_id, branch_id) values
       ($1, $4, $5), ($1, $4, $6), ($2, $4, $5), ($3, $4, $5)`,
    [ownerUser, branchAOnlyUser, plainUser, tenantId, branchA, branchB]
  );
  await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [otherUser, otherTenantId, otherBranchId]);
  await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $3, 'analista'), ($2, $3, 'sin-analitica')", [roleAnalytics, roleNone, tenantId]);
  await ownerPool.query("insert into role_permissions (role_id, permission_code) values ($1, 'analytics.read')", [roleAnalytics]);
  await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $4, $5), ($2, $4, $5), ($3, $4, $6)", [
    ownerUser,
    branchAOnlyUser,
    plainUser,
    tenantId,
    roleAnalytics,
    roleNone
  ]);
  await ownerPool.query(
    "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $3, $4, 'Central', 'CENTRAL'), ($2, $3, $5, 'Sur', 'CENTRAL')",
    [warehouseA, warehouseB, tenantId, branchA, branchB]
  );
  await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $3, $4, 'CAJA-1', true), ($2, $3, $5, 'CAJA-2', true)", [registerA, registerB, tenantId, branchA, branchB]);
  await ownerPool.query(
    `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
     values ($1, $5, $6, $2, now() - interval '30 days', now() + interval '8 hours', 'SCHEDULED', $7),
            ($3, $5, $8, $4, now() - interval '30 days', now() + interval '8 hours', 'SCHEDULED', $7)`,
    [shiftA, registerA, shiftB, registerB, tenantId, branchA, ownerUser, branchB]
  );
  await ownerPool.query(
    `insert into products (id, tenant_id, name, laboratory) values
       ($1, $6, 'Prod A', 'Bago'), ($2, $6, 'Prod B', ' bago '), ($3, $6, 'Prod C', null), ($4, $6, 'Prod D', 'Vita'), ($5, $6, 'Prod E', 'Vita')`,
    [productA, productB, productC, productD, productE, tenantId]
  );
  await ownerPool.query(
    `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values
       ($1, $7, $2, 'Caja x 10', 10), ($3, $7, $4, 'Blister', 1), ($5, $7, $6, 'Unidad', 1)`,
    [pA, productA, pB, productB, pC, productC, tenantId]
  );
  await ownerPool.query(
    `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $5, $2, 'Unidad', 1), ($3, $5, $4, 'Unidad', 1)`,
    [pD, productD, pE, productE, tenantId]
  );
  // Average cost per base unit (current): pA 2.00, pB 3.00, pD 1.00; pC has none.
  await ownerPool.query(
    "insert into presentation_costs (tenant_id, presentation_id, average_unit_cost, last_unit_cost) values ($1, $2, 2, 2), ($1, $3, 3, 3), ($1, $4, 1, 1)",
    [tenantId, pA, pB, pD]
  );

  // Branch A: S1 pA 7 boxes @100 (snapshot 1.50/base), S2 pB 5 @10 with 1 returned (no snapshot), S3 pC 2 @5 (no snapshot, no cost),
  // S4 voided pA 100 @100 (must be ignored). Branch B: S5 pD 3 @50 (snapshot 0.80).
  await insertSale(branchA, shiftA, warehouseA, [{ presentationId: pA, quantity: 7, factor: 10, unitPrice: 100, unitCostBase: 1.5 }]);
  const partial = await insertSale(branchA, shiftA, warehouseA, [{ presentationId: pB, quantity: 5, factor: 1, unitPrice: 10, unitCostBase: null }], "PARTIALLY_RETURNED");
  await insertReturn(branchA, shiftA, partial.saleId, partial.itemIds[0]!, 1, 1, 10);
  await insertSale(branchA, shiftA, warehouseA, [{ presentationId: pC, quantity: 2, factor: 1, unitPrice: 5, unitCostBase: null }]);
  await insertSale(branchA, shiftA, warehouseA, [{ presentationId: pA, quantity: 100, factor: 10, unitPrice: 100, unitCostBase: 1.5 }], "VOIDED");
  await insertSale(branchB, shiftB, warehouseB, [{ presentationId: pD, quantity: 3, factor: 1, unitPrice: 50, unitCostBase: 0.8 }]);

  // Stock. pA: 140 physical - 20 reserved = 120 available; an expired and a quarantined batch must not count.
  await insertStock(warehouseA, pA, "A-OK", 140, 20);
  await insertStock(warehouseA, pA, "A-EXP", 30, 0, { expiresInDays: -1 });
  await insertStock(warehouseA, pA, "A-QUA", 30, 0, { status: "QUARANTINED" });
  await insertStock(warehouseA, pB, "B-OK", 20, 0);
  await insertStock(warehouseA, pE, "E-OK", 10, 0);
  await insertStock(warehouseB, pD, "D-OK", 30, 0);
}

describe("F18 analytics (T1-T3)", () => {
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
    await seedTenant();
    await setPlan("PREMIUM");
  });

  describe("ABC matrix", () => {
    it("classifies presentations by net revenue (voided excluded, returns netted) with cumulative A<=80, B<=95, C", async () => {
      const report = await analytics.abc(ownerScope, period);
      expect(report.totalRevenueBob).toBe("900.00");
      expect(report.items.map((item) => [item.presentationId, item.class])).toEqual([
        [pA, "A"],
        [pD, "B"],
        [pB, "C"],
        [pC, "C"]
      ]);
      expect(report.items[0]).toMatchObject({ productName: "Prod A", presentationName: "Caja x 10", units: 7, revenueBob: "700.00", sharePercent: "77.78", cumulativePercent: "77.78" });
      expect(report.items[1]).toMatchObject({ units: 3, revenueBob: "150.00", sharePercent: "16.67", cumulativePercent: "94.44" });
      expect(report.items[2]).toMatchObject({ units: 4, revenueBob: "40.00", sharePercent: "4.44", cumulativePercent: "98.89" });
      expect(report.items[3]).toMatchObject({ units: 2, revenueBob: "10.00", cumulativePercent: "100.00" });
      expect(report.summary).toEqual({ A: 1, B: 1, C: 2 });
    });

    it("filters by branch and always puts the top item in class A", async () => {
      const report = await analytics.abc(ownerScope, { ...period, branchId: branchA });
      expect(report.totalRevenueBob).toBe("750.00");
      expect(report.items.map((item) => item.presentationId)).toEqual([pA, pB, pC]);
      expect(report.items[0]!.class).toBe("A");
      const single = await analytics.abc(scopeFor(ownerUser, branchA), { ...period, branchId: branchB });
      expect(single.items.map((item) => [item.presentationId, item.class])).toEqual([[pD, "A"]]);
    });

    it("requires a valid period", async () => {
      await expect(analytics.abc(ownerScope, { from: "2026-01-01" })).rejects.toMatchObject({ response: { field: "to" } });
      await expect(analytics.abc(ownerScope, { from: "2026-02-01", to: "2026-01-01" })).rejects.toMatchObject({ response: { field: "to" } });
    });
  });

  describe("branch access and tenant isolation", () => {
    it("covers only the branches the user belongs to and rejects others", async () => {
      const onlyA = scopeFor(branchAOnlyUser, branchA);
      const report = await analytics.abc(onlyA, period);
      expect(report.items.map((item) => item.presentationId)).toEqual([pA, pB, pC]);
      await expect(analytics.abc(onlyA, { ...period, branchId: branchB })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("never sees another pharmacy", async () => {
      await setPlan("PREMIUM", otherTenantId);
      const report = await analytics.abc(scopeFor(otherUser, otherBranchId, otherTenantId), period);
      expect(report.items).toEqual([]);
      await expect(analytics.abc(ownerScope, { ...period, branchId: otherBranchId })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("rotation", () => {
    it("computes average daily units, available stock, days of inventory, turnover and NO_MOVEMENT", async () => {
      const report = await analytics.rotation(ownerScope, period);
      expect(report.days).toBe(4);
      const byId = new Map(report.items.map((item) => [item.presentationId, item]));
      // pA: 70 base sold in 4 days = 17.5/day; available 140 - 20 reserved (expired and quarantined excluded) = 120.
      expect(byId.get(pA)).toMatchObject({ soldBase: 70, avgDailyBase: 17.5, availableBase: 120, daysOfInventory: 6.9, cogsBob: "105.00", stockValueBob: "240.00", turnover: 0.44, flags: [] });
      // pB: 4 net base, 1/day, 20 available, COGS estimated with current cost 3.00 = 12.
      expect(byId.get(pB)).toMatchObject({ soldBase: 4, avgDailyBase: 1, availableBase: 20, daysOfInventory: 20, cogsBob: "12.00", stockValueBob: "60.00", turnover: 0.2 });
      // pD is sold and stocked in branch B, included when all accessible branches are summed.
      expect(byId.get(pD)).toMatchObject({ soldBase: 3, avgDailyBase: 0.75, availableBase: 30, daysOfInventory: 40 });
      // pC sold, out of stock, no cost at all.
      expect(byId.get(pC)).toMatchObject({ availableBase: 0, daysOfInventory: 0, stockValueBob: null, turnover: null });
      // pE has stock and no sales.
      expect(byId.get(pE)).toMatchObject({ soldBase: 0, availableBase: 10, daysOfInventory: null, flags: ["NO_MOVEMENT"] });
    });

    it("defaults to the last 30 days and filters by branch", async () => {
      const report = await analytics.rotation(ownerScope, { branchId: branchA });
      expect(report.days).toBe(30);
      expect(report.items.map((item) => item.presentationId)).not.toContain(pD);
      const pa = report.items.find((item) => item.presentationId === pA)!;
      expect(pa.avgDailyBase).toBe(2.33); // 70 / 30
    });
  });

  describe("profitability", () => {
    it("groups by product using the snapshot, falling back to the current average cost (estimated)", async () => {
      const report = await analytics.profitability(ownerScope, { ...period, groupBy: "product" });
      const byName = new Map(report.rows.map((row) => [row.name, row]));
      expect(byName.get("Prod A")).toMatchObject({ revenueBob: "700.00", costBob: "105.00", marginBob: "595.00", marginPercent: "85.00", estimatedShare: "0.00", uncostedRevenueBob: "0.00" });
      expect(byName.get("Prod B")).toMatchObject({ revenueBob: "40.00", costBob: "12.00", marginBob: "28.00", marginPercent: "70.00", estimatedShare: "100.00" });
      expect(byName.get("Prod C")).toMatchObject({ revenueBob: "10.00", costBob: "0.00", marginBob: null, marginPercent: null, uncostedRevenueBob: "10.00" });
      expect(byName.get("Prod D")).toMatchObject({ revenueBob: "150.00", costBob: "2.40", marginBob: "147.60", marginPercent: "98.40" });
      expect(report.totals).toMatchObject({ revenueBob: "900.00", costBob: "119.40", marginBob: "770.60", uncostedRevenueBob: "10.00" });
    });

    it("groups by laboratory with trimmed, case-insensitive names and 'Sin laboratorio'", async () => {
      const report = await analytics.profitability(ownerScope, { ...period, groupBy: "laboratory" });
      const byName = new Map(report.rows.map((row) => [row.name, row]));
      expect([...byName.keys()].sort()).toEqual(["Bago", "Sin laboratorio", "Vita"]);
      expect(byName.get("Bago")).toMatchObject({ revenueBob: "740.00", costBob: "117.00", marginBob: "623.00", marginPercent: "84.19", estimatedShare: "5.41" });
      expect(byName.get("Sin laboratorio")).toMatchObject({ revenueBob: "10.00", marginBob: null });
      expect(byName.get("Vita")).toMatchObject({ revenueBob: "150.00", marginBob: "147.60" });
    });

    it("groups by branch", async () => {
      const report = await analytics.profitability(ownerScope, { ...period, groupBy: "branch" });
      const byId = new Map(report.rows.map((row) => [row.key, row]));
      expect(byId.get(branchA)).toMatchObject({ name: "Central", revenueBob: "750.00", costBob: "117.00", marginBob: "623.00", marginPercent: "84.19" });
      expect(byId.get(branchB)).toMatchObject({ name: "Sur", revenueBob: "150.00", costBob: "2.40", marginBob: "147.60" });
    });

    it("exports the report as CSV with a BOM, CRLF lines and the Spanish header", async () => {
      const exported = await analytics.profitabilityCsv(ownerScope, { ...period, groupBy: "laboratory" });
      expect(exported.filename).toBe(`rentabilidad-laboratory-${period.from}-${period.to}.csv`);
      const lines = exported.csv.replace(/\uFEFF/, "").trimEnd().split(/\r\n/);
      expect(lines[0]).toBe("Grupo,Unidades,Ingresos (Bs),Costo (Bs),Margen (Bs),Margen %,Estimado %,Sin costo (Bs)");
      expect(lines).toContain("Bago,11,740.00,117.00,623.00,84.19,5.41,0.00");
      expect(lines).toContain("Sin laboratorio,2,10.00,0.00,,,0.00,10.00");
    });

    it("rejects an unknown groupBy", async () => {
      await expect(analytics.profitability(ownerScope, { ...period, groupBy: "color" })).rejects.toMatchObject({ response: { field: "groupBy" } });
    });
  });

  describe("HTTP gates", () => {
    let app: NestFastifyApplication;
    afterAll(async () => {
      await app?.close();
    });

    async function get(url: string, userId: string, branchId = branchA): Promise<number> {
      if (!app) {
        const { AppModule } = await import("../src/app.module.js");
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleRef.createNestApplication(new FastifyAdapter());
        await app.register(fastifyCookie);
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
      }
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${await accessTokens.issue(scopeFor(userId, branchId))}` }
      });
      return response.statusCode;
    }
    const query = `from=${period.from}&to=${period.to}`;

    it("enforces analytics.read and the plan features per endpoint", async () => {
      // Permission.
      expect(await get(`/api/v1/analytics/abc?${query}`, plainUser)).toBe(403);
      // Premium: everything allowed.
      expect(await get(`/api/v1/analytics/abc?${query}`, ownerUser)).toBe(200);
      expect(await get(`/api/v1/analytics/rotation?${query}`, ownerUser)).toBe(200);
      expect(await get(`/api/v1/analytics/profitability?${query}&groupBy=product`, ownerUser)).toBe(200);
      // Profesional: profitability and rotation yes, ABC no.
      await setPlan("PROFESIONAL");
      expect(await get(`/api/v1/analytics/abc?${query}`, ownerUser)).toBe(403);
      expect(await get(`/api/v1/analytics/rotation?${query}`, ownerUser)).toBe(200);
      expect(await get(`/api/v1/analytics/profitability?${query}&groupBy=branch`, ownerUser)).toBe(200);
      // Basico: none of the three.
      await setPlan("BASICO");
      expect(await get(`/api/v1/analytics/abc?${query}`, ownerUser)).toBe(403);
      expect(await get(`/api/v1/analytics/rotation?${query}`, ownerUser)).toBe(403);
      expect(await get(`/api/v1/analytics/profitability?${query}&groupBy=branch`, ownerUser)).toBe(403);
    }, 60_000);
  });
});
