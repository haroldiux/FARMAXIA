import fastifyCookie from "@fastify/cookie";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
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
import { StockAlertsService } from "../src/analytics/stock-alerts.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { PlatformDatabase } from "../src/saas/platform-database.js";
import { createFixtures } from "./analytics-fixtures.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
const role = (name: string) => withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? role("farmaxia_app");
const testAuthUrl = process.env.DATABASE_AUTH_TEST_URL ?? role("farmaxia_auth");
const testPlatformUrl = process.env.DATABASE_PLATFORM_TEST_URL ?? role("farmaxia_platform");

process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_AUTH_URL = testAuthUrl;

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const platform = new PlatformDatabase(testPlatformUrl);
const analytics = new AnalyticsService(database);
const alerts = new StockAlertsService(database, platform);
const accessTokens = new AccessTokenService();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const fx = createFixtures(ownerPool, 991000);
const { ids } = fx;
const scopeFor = (userId: string, branchId: string, tenant = ids.tenantId): TenantScope => ({ tenantId: tenant, userId, branchId });
const ownerScope = scopeFor(ids.ownerUser, ids.branchA);

/**
 * Branch A: pC sold 10 and no stock (OUT_OF_STOCK); pB sold 60 in 30 days (2/day) with 8 available (LOW_COVERAGE, 4 days);
 * pA sold 30 base with 100 available (fine); pD only a voided sale and one 40 days ago (ignored); pE sold and fully returned (ignored).
 * Branch B: pD sold 4, no stock (OUT_OF_STOCK). Other pharmacy: one out-of-stock presentation.
 */
async function seedScenario(): Promise<void> {
  await fx.seedBase();
  await fx.setPlan("PREMIUM");
  const { branchA, branchB, shiftA, shiftB, warehouseA, warehouseB, pA, pB, pC, pD, pE } = ids;
  await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pC, quantity: 10, factor: 1, unitPrice: 5, unitCostBase: null }], { daysAgo: 2 });
  await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pB, quantity: 30, factor: 1, unitPrice: 10, unitCostBase: null }], { daysAgo: 3 });
  await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pB, quantity: 30, factor: 1, unitPrice: 10, unitCostBase: null }], { daysAgo: 20 });
  await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pA, quantity: 3, factor: 10, unitPrice: 100, unitCostBase: 1.5 }], { daysAgo: 5 });
  await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pD, quantity: 8, factor: 1, unitPrice: 50, unitCostBase: null }], { status: "VOIDED", daysAgo: 2 });
  await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pD, quantity: 8, factor: 1, unitPrice: 50, unitCostBase: null }], { daysAgo: 40 });
  const returned = await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pE, quantity: 10, factor: 1, unitPrice: 1, unitCostBase: null }], { status: "RETURNED", daysAgo: 4 });
  await fx.insertReturn(branchA, shiftA, returned.saleId, returned.itemIds[0]!, 10, 1, 1);
  await fx.insertSale(branchB, shiftB, warehouseB, [{ presentationId: pD, quantity: 4, factor: 1, unitPrice: 50, unitCostBase: null }], { daysAgo: 2 });
  await fx.insertStock(warehouseA, pB, "B-LOW", 8, 0);
  await fx.insertStock(warehouseA, pA, "A-OK", 100, 0);
  // Other pharmacy.
  await fx.setPlan("PREMIUM", ids.otherTenantId);
  await fx.insertSale(ids.otherBranchId, ids.otherShift, ids.otherWarehouse, [{ presentationId: ids.otherPresentation, quantity: 5, factor: 1, unitPrice: 2, unitCostBase: null }], {
    tenant: ids.otherTenantId,
    userId: ids.otherUser,
    daysAgo: 2
  });
}

async function openAlertRows(tenant = ids.tenantId): Promise<Array<{ branch: string; presentation: string; kind: string; days: string | null; available: string; resolved: boolean }>> {
  const result = await ownerPool.query(
    `select branch_id as branch, presentation_id as presentation, kind, days_of_stock::text as days, available_base::text as available, resolved_at is not null as resolved
     from stock_alerts where tenant_id = $1 order by kind, presentation_id, created_at`,
    [tenant]
  );
  return result.rows;
}

describe("F18 analytics T4: stockouts and shortage alerts", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await database.close();
    await platform.close();
    await ownerPool.end();
  });
  beforeEach(async () => {
    fx.resetCounter();
    await ownerPool.query("truncate table tenants, users cascade");
    await seedScenario();
  });

  describe("stockouts report (D74)", () => {
    it("lists out-of-stock (sold in 30 days, available 0) and low-coverage (<7 days) items per branch with suggested quantity", async () => {
      const report = await analytics.stockouts(ownerScope, {});
      expect(report.lowCoverageDays).toBe(7);
      expect(report.items.map((item) => [item.branchId, item.presentationId, item.kind])).toEqual([
        [ids.branchA, ids.pC, "OUT_OF_STOCK"],
        [ids.branchB, ids.pD, "OUT_OF_STOCK"],
        [ids.branchA, ids.pB, "LOW_COVERAGE"]
      ]);
      expect(report.items[0]).toMatchObject({ branchName: "Central", productName: "Prod C", presentationName: "Unidad", availableBase: 0, avgDailyBase: 0.33, daysOfInventory: 0, suggestedBase: 10, baseUnitFactor: 1 });
      expect(report.items[1]).toMatchObject({ branchName: "Sur", availableBase: 0, suggestedBase: 4 });
      expect(report.items[2]).toMatchObject({ availableBase: 8, avgDailyBase: 2, daysOfInventory: 4, suggestedBase: 52 });
    });

    it("ignores voided sales, sales older than 30 days, fully returned sales and healthy coverage", async () => {
      const report = await analytics.stockouts(ownerScope, { branchId: ids.branchA });
      const presentations = report.items.map((item) => item.presentationId);
      expect(presentations).not.toContain(ids.pA); // 100 available / 1 per day
      expect(presentations).not.toContain(ids.pD); // voided + old only (in A)
      expect(presentations).not.toContain(ids.pE); // fully returned
      expect(report.items).toHaveLength(2);
    });

    it("filters by branch and rejects branches the user cannot access", async () => {
      const onlyB = await analytics.stockouts(ownerScope, { branchId: ids.branchB });
      expect(onlyB.items.map((item) => item.presentationId)).toEqual([ids.pD]);
      await expect(analytics.stockouts(scopeFor(ids.plainUser, ids.branchA), { branchId: ids.branchB })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(analytics.stockouts(ownerScope, { branchId: ids.otherBranchId })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("scheduler scan", () => {
    it("opens one alert per branch/presentation/kind and is idempotent", async () => {
      const first = await alerts.scan();
      expect(first).toEqual({ tenants: 2, created: 4, resolved: 0 });
      const rows = await openAlertRows();
      expect(rows.map((row) => [row.branch, row.presentation, row.kind])).toEqual([
        [ids.branchA, ids.pB, "LOW_COVERAGE"],
        [ids.branchA, ids.pC, "OUT_OF_STOCK"],
        [ids.branchB, ids.pD, "OUT_OF_STOCK"]
      ]);
      expect(rows[0]).toMatchObject({ days: "4.0", available: "8" });
      expect((await openAlertRows(ids.otherTenantId)).map((row) => row.presentation)).toEqual([ids.otherPresentation]);

      expect(await alerts.scan()).toEqual({ tenants: 2, created: 0, resolved: 0 });
      expect(await openAlertRows()).toHaveLength(3);
    });

    it("resolves alerts that no longer apply and swaps LOW_COVERAGE for OUT_OF_STOCK when stock reaches zero", async () => {
      await alerts.scan();
      await fx.insertStock(ids.warehouseA, ids.pC, "C-NEW", 50, 0);
      await ownerPool.query("update inventory_balances set quantity_base = 0 where quantity_base = 8");
      const second = await alerts.scan();
      expect(second).toEqual({ tenants: 2, created: 1, resolved: 2 });
      const rows = await openAlertRows();
      expect(rows.filter((row) => !row.resolved).map((row) => [row.presentation, row.kind])).toEqual([
        [ids.pB, "OUT_OF_STOCK"],
        [ids.pD, "OUT_OF_STOCK"]
      ]);
      expect(rows.filter((row) => row.resolved).map((row) => [row.presentation, row.kind])).toEqual([
        [ids.pB, "LOW_COVERAGE"],
        [ids.pC, "OUT_OF_STOCK"]
      ]);
    });

    it("skips pharmacies whose plan lacks analytics.profitability", async () => {
      await fx.setPlan("BASICO");
      await fx.setPlan("PROFESIONAL", ids.otherTenantId);
      const result = await alerts.scan();
      expect(result).toEqual({ tenants: 1, created: 1, resolved: 0 });
      expect(await openAlertRows()).toEqual([]);
      expect(await openAlertRows(ids.otherTenantId)).toHaveLength(1);
    });

    it("only reads sales: the platform role cannot write them", async () => {
      await expect(platform.withTransaction((client) => client.query("update sales set status = 'VOIDED'"))).rejects.toMatchObject({ code: "42501" });
      await expect(platform.withTransaction((client) => client.query("delete from sale_items"))).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("alerts list and acknowledge", () => {
    it("lists open alerts of every accessible branch, acknowledges idempotently and keeps resolved ones in 'all'", async () => {
      await alerts.scan();
      const open = await alerts.list(ownerScope, { status: "open" });
      expect(open.items).toHaveLength(3);
      expect(open.unacknowledged).toBe(3);
      expect(open.items.every((item) => item.resolvedAt === null)).toBe(true);
      const outOfStock = open.items.find((item) => item.presentationId === ids.pC)!;
      expect(outOfStock).toMatchObject({ branchId: ids.branchA, branchName: "Central", productName: "Prod C", presentationName: "Unidad", kind: "OUT_OF_STOCK", availableBase: 0, acknowledgedAt: null });

      const acknowledged = await alerts.acknowledge(ownerScope, outOfStock.id);
      expect(acknowledged.id).toBe(outOfStock.id);
      expect((await alerts.acknowledge(ownerScope, outOfStock.id)).acknowledgedAt).toBe(acknowledged.acknowledgedAt);
      expect((await alerts.list(ownerScope, { status: "open" })).unacknowledged).toBe(2);

      const onlyB = await alerts.list(ownerScope, { status: "open", branchId: ids.branchB });
      expect(onlyB.items.map((item) => item.presentationId)).toEqual([ids.pD]);

      await fx.insertStock(ids.warehouseA, ids.pC, "C-NEW", 50, 0);
      await alerts.scan();
      expect((await alerts.list(ownerScope, { status: "open" })).items).toHaveLength(2);
      const all = await alerts.list(ownerScope, { status: "all" });
      expect(all.items).toHaveLength(3);
      expect(all.items.find((item) => item.id === outOfStock.id)!.resolvedAt).not.toBeNull();
      await expect(alerts.acknowledge(ownerScope, outOfStock.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it("never exposes or acknowledges another pharmacy's alerts, and rejects bad ids", async () => {
      await alerts.scan();
      const foreign = await ownerPool.query<{ id: string }>("select id from stock_alerts where tenant_id = $1", [ids.otherTenantId]);
      await expect(alerts.acknowledge(ownerScope, foreign.rows[0]!.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(alerts.acknowledge(ownerScope, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundException);
      const own = await alerts.list(ownerScope, { status: "all" });
      expect(own.items.map((item) => item.id)).not.toContain(foreign.rows[0]!.id);
      await expect(alerts.list(ownerScope, { status: "open", branchId: ids.otherBranchId })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(alerts.list(ownerScope, { status: "bogus" })).rejects.toMatchObject({ response: { field: "status" } });
    });
  });

  describe("HTTP gates", () => {
    let app: NestFastifyApplication;
    afterAll(async () => {
      await app?.close();
    });

    async function call(method: "GET" | "POST", url: string, userId: string): Promise<{ status: number; body: unknown }> {
      if (!app) {
        const { AppModule } = await import("../src/app.module.js");
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleRef.createNestApplication(new FastifyAdapter());
        await app.register(fastifyCookie);
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
      }
      const response = await app.inject({ method, url, headers: { authorization: `Bearer ${await accessTokens.issue(scopeFor(userId, ids.branchA))}` } });
      return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
    }

    it("requires analytics.read and analytics.profitability for stockouts and alerts", async () => {
      expect((await call("GET", "/api/v1/analytics/stockouts", ids.plainUser)).status).toBe(403);
      expect((await call("GET", "/api/v1/analytics/stock-alerts", ids.plainUser)).status).toBe(403);
      const stockouts = await call("GET", "/api/v1/analytics/stockouts", ids.ownerUser);
      expect(stockouts.status).toBe(200);
      expect((stockouts.body as { items: unknown[] }).items).toHaveLength(3);

      await alerts.scan();
      const listed = await call("GET", "/api/v1/analytics/stock-alerts?status=open", ids.ownerUser);
      expect(listed.status).toBe(200);
      const first = (listed.body as { items: Array<{ id: string }> }).items[0]!;
      expect((await call("POST", `/api/v1/analytics/stock-alerts/${first.id}/acknowledge`, ids.plainUser)).status).toBe(403);
      expect((await call("POST", `/api/v1/analytics/stock-alerts/${first.id}/acknowledge`, ids.ownerUser)).status).toBe(201);

      await fx.setPlan("PROFESIONAL");
      expect((await call("GET", "/api/v1/analytics/stockouts", ids.ownerUser)).status).toBe(200);
      await fx.setPlan("BASICO");
      expect((await call("GET", "/api/v1/analytics/stockouts", ids.ownerUser)).status).toBe(403);
      expect((await call("GET", "/api/v1/analytics/stock-alerts", ids.ownerUser)).status).toBe(403);
      expect((await call("POST", `/api/v1/analytics/stock-alerts/${first.id}/acknowledge`, ids.ownerUser)).status).toBe(403);
    }, 60_000);
  });
});
