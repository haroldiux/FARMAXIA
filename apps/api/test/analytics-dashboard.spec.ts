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
import { laPazDay } from "../src/analytics/analytics-data.js";
import { forecastDemand } from "../src/analytics/analytics-forecast.js";
import { AnalyticsService } from "../src/analytics/analytics.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
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

process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_AUTH_URL = testAuthUrl;

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const analytics = new AnalyticsService(database);
const accessTokens = new AccessTokenService();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const fx = createFixtures(ownerPool, 992000);
const { ids } = fx;
const scopeFor = (userId: string, branchId: string, tenant = ids.tenantId): TenantScope => ({ tenantId: tenant, userId, branchId });
const ownerScope = scopeFor(ids.ownerUser, ids.branchA);

function addDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const today = laPazDay(0);
const thisMonday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
/** Monday of week k (0 = oldest) of the last 8 complete weeks. */
const weekStart = (k: number) => addDays(thisMonday, -7 * (8 - k));

describe("F18 analytics T5: forecast math (pure)", () => {
  it("flat series: forecast equals the average and projects constant demand", () => {
    const result = forecastDemand({ weekly: Array(8).fill(14), horizonDays: 30, availableBase: 20 });
    expect(result.movingAverage).toBe(14);
    expect(result.trendPerWeek).toBeCloseTo(0, 10);
    expect(result.weeklyForecast).toEqual([14, 14, 14, 14, 14]);
    expect(result.projectedDemand).toBeCloseTo(60, 1); // 4 weeks x 14 + 2 days x 2
    expect(result.daysUntilStockout).toBe(10); // 2 per day, 20 available
  });

  it("rising series continues the least-squares trend from the 4-week moving average", () => {
    const result = forecastDemand({ weekly: [10, 20, 30, 40, 50, 60, 70, 80], horizonDays: 30, availableBase: 200 });
    expect(result.movingAverage).toBe(65);
    expect(result.trendPerWeek).toBeCloseTo(10, 6);
    expect(result.weeklyForecast.slice(0, 3).map((value) => Math.round(value))).toEqual([90, 100, 110]);
    expect(result.projectedDemand).toBeCloseTo(457.1, 1); // 90+100+110+120 + 130 x 2/7
    expect(result.daysUntilStockout).toBe(15);
  });

  it("falling series never forecasts negative demand and has no stockout date", () => {
    const toZero = forecastDemand({ weekly: [40, 30, 20, 10, 0, 0, 0, 0], horizonDays: 30, availableBase: 5 });
    expect(toZero.weeklyForecast.every((value) => value === 0)).toBe(true);
    expect(toZero.projectedDemand).toBe(0);
    expect(toZero.daysUntilStockout).toBeNull();
    const steep = forecastDemand({ weekly: [80, 70, 60, 50, 40, 30, 20, 10], horizonDays: 30, availableBase: 5 });
    expect(Math.min(...steep.weeklyForecast)).toBe(0);
    expect(steep.daysUntilStockout).toBeNull();
  });

  it("handles no demand, no stock and very long coverage", () => {
    expect(forecastDemand({ weekly: Array(8).fill(0), horizonDays: 30, availableBase: 10 }).daysUntilStockout).toBeNull();
    expect(forecastDemand({ weekly: Array(8).fill(7), horizonDays: 30, availableBase: 0 }).daysUntilStockout).toBe(0);
    expect(forecastDemand({ weekly: Array(8).fill(7), horizonDays: 30, availableBase: 1_000_000 }).daysUntilStockout).toBeNull();
    expect(forecastDemand({ weekly: Array(8).fill(7), horizonDays: 7, availableBase: 100 }).weeklyForecast).toEqual([7]);
  });
});

describe("F18 analytics T5: dashboard and forecast", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  async function seedDashboard(): Promise<void> {
    await fx.seedBase();
    await fx.setPlan("PREMIUM");
    const { branchA, branchB, shiftA, shiftB, warehouseA, warehouseB, pA, pB, pC, pD, pE } = ids;
    await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pA, quantity: 7, factor: 10, unitPrice: 100, unitCostBase: 1.5 }]);
    const partial = await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pB, quantity: 5, factor: 1, unitPrice: 10, unitCostBase: null }], { status: "PARTIALLY_RETURNED" });
    await fx.insertReturn(branchA, shiftA, partial.saleId, partial.itemIds[0]!, 1, 1, 10);
    await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pC, quantity: 2, factor: 1, unitPrice: 5, unitCostBase: null }]);
    await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pA, quantity: 100, factor: 10, unitPrice: 100, unitCostBase: 1.5 }], { status: "VOIDED" });
    await fx.insertSale(branchB, shiftB, warehouseB, [{ presentationId: pD, quantity: 3, factor: 1, unitPrice: 50, unitCostBase: 0.8 }]);
    await fx.insertStock(warehouseA, pA, "A-FAR", 140, 20);
    await fx.insertStock(warehouseA, pA, "A-NEAR", 10, 0, { expiresInDays: 10 }); // 10 x 2.00 = 20.00
    await fx.insertStock(warehouseA, pA, "A-EXP", 30, 0, { expiresInDays: -1 }); // already expired: not "near"
    await fx.insertStock(warehouseA, pA, "A-QUA", 30, 0, { expiresInDays: 5, status: "QUARANTINED" });
    await fx.insertStock(warehouseA, pB, "B-OK", 20, 0, { expiresInDays: 45 }); // beyond 30 days
    await fx.insertStock(warehouseA, pB, "B-NEAR", 5, 0, { expiresInDays: 25 }); // 5 x 3.00 = 15.00
    await fx.insertStock(warehouseA, pE, "E-NEAR", 4, 0, { expiresInDays: 5 }); // no cost recorded
    await fx.insertStock(warehouseB, pD, "D-OK", 30, 0);
  }

  describe("dashboard", () => {
    const period = { from: addDays(today, -3), to: today };
    beforeEach(async () => {
      fx.resetCounter();
      await ownerPool.query("truncate table tenants, users cascade");
      await seedDashboard();
    });

    it("computes net KPIs (voided excluded, returns netted), top products, out-of-stock count and near-expiry value", async () => {
      const dashboard = await analytics.dashboard(ownerScope, period);
      expect(dashboard).toMatchObject({ from: period.from, to: period.to, branchId: null, netSalesBob: "900.00", tickets: 4, averageTicketBob: "225.00", units: 16, outOfStockCount: 1 });
      expect(dashboard.topProducts.map((row) => [row.productName, row.units, row.revenueBob])).toEqual([
        ["Prod A", 7, "700.00"],
        ["Prod D", 3, "150.00"],
        ["Prod B", 4, "40.00"],
        ["Prod C", 2, "10.00"]
      ]);
      expect(dashboard.topProducts[0]).toMatchObject({ productId: ids.productA, sharePercent: "77.78" });
      expect(dashboard.nearExpiry).toEqual({ days: 30, units: 19, valueBob: "35.00", uncostedUnits: 4 });
    });

    it("adds margin when the plan has analytics.profitability, reusing the profitability logic", async () => {
      const dashboard = await analytics.dashboard(ownerScope, period);
      const profitability = await analytics.profitability(ownerScope, { ...period, groupBy: "product" });
      expect(dashboard.marginAvailable).toBe(true);
      expect(dashboard.marginBob).toBe(profitability.totals.marginBob);
      expect(dashboard.marginPercent).toBe(profitability.totals.marginPercent);
      expect(dashboard.marginBob).toBe("770.60");
      expect(dashboard.marginPercent).toBe("86.58");
    });

    it("omits the margin on plans without analytics.profitability", async () => {
      await fx.setPlan("BASICO");
      const dashboard = await analytics.dashboard(ownerScope, period);
      expect(dashboard).toMatchObject({ marginAvailable: false, marginBob: null, marginPercent: null, netSalesBob: "900.00", tickets: 4 });
    });

    it("filters by branch, rejects inaccessible branches and requires a period", async () => {
      const a = await analytics.dashboard(ownerScope, { ...period, branchId: ids.branchA });
      expect(a).toMatchObject({ netSalesBob: "750.00", tickets: 3, units: 13, outOfStockCount: 1 });
      expect(a.nearExpiry.valueBob).toBe("35.00");
      const b = await analytics.dashboard(ownerScope, { ...period, branchId: ids.branchB });
      expect(b).toMatchObject({ netSalesBob: "150.00", tickets: 1, averageTicketBob: "150.00", outOfStockCount: 0 });
      expect(b.nearExpiry).toMatchObject({ units: 0, valueBob: "0.00" });
      await expect(analytics.dashboard(scopeFor(ids.plainUser, ids.branchA), { ...period, branchId: ids.branchB })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(analytics.dashboard(ownerScope, { from: period.from })).rejects.toMatchObject({ response: { field: "to" } });
    });

    it("returns zeros for a pharmacy without sales", async () => {
      await fx.setPlan("BASICO", ids.otherTenantId);
      const other = await analytics.dashboard(scopeFor(ids.otherUser, ids.otherBranchId, ids.otherTenantId), period);
      expect(other).toMatchObject({ netSalesBob: "0.00", tickets: 0, averageTicketBob: "0.00", units: 0, outOfStockCount: 0, topProducts: [] });
    });
  });

  describe("forecast", () => {
    beforeEach(async () => {
      fx.resetCounter();
      await ownerPool.query("truncate table tenants, users cascade");
      await fx.seedBase();
      await fx.setPlan("PREMIUM");
      const { branchA, branchB, shiftA, shiftB, warehouseA, warehouseB, pB, pC, pD } = ids;
      const rising = [10, 20, 30, 40, 50, 60, 70, 80];
      const falling = [40, 30, 20, 10, 0, 0, 0, 0];
      for (let k = 0; k < 8; k += 1) {
        const day = addDays(weekStart(k), 2);
        await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pB, quantity: rising[k]!, factor: 1, unitPrice: 10, unitCostBase: null }], { day });
        if (falling[k]! > 0) await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pC, quantity: falling[k]!, factor: 1, unitPrice: 5, unitCostBase: null }], { day });
        if (k === 4) {
          const returned = await fx.insertSale(branchB, shiftB, warehouseB, [{ presentationId: pD, quantity: 20, factor: 1, unitPrice: 50, unitCostBase: null }], { day, status: "PARTIALLY_RETURNED" });
          await fx.insertReturn(branchB, shiftB, returned.saleId, returned.itemIds[0]!, 6, 1, 50);
        } else {
          await fx.insertSale(branchB, shiftB, warehouseB, [{ presentationId: pD, quantity: 14, factor: 1, unitPrice: 50, unitCostBase: null }], { day });
        }
      }
      // Ignored: voided sale inside the window and a sale of the current (incomplete) week.
      await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pB, quantity: 500, factor: 1, unitPrice: 10, unitCostBase: null }], { day: addDays(weekStart(7), 3), status: "VOIDED" });
      await fx.insertSale(branchA, shiftA, warehouseA, [{ presentationId: pB, quantity: 999, factor: 1, unitPrice: 10, unitCostBase: null }], { day: thisMonday });
      await fx.insertStock(warehouseA, pB, "B-STOCK", 200, 0);
      await fx.insertStock(warehouseB, pD, "D-STOCK", 30, 0);
    });

    it("builds 8 complete La Paz weeks of net units per top presentation with moving average + trend forecast", async () => {
      const report = await analytics.forecast(ownerScope, {});
      expect(report.horizonDays).toBe(30);
      expect(report.weekStarts).toEqual(Array.from({ length: 8 }, (_, k) => weekStart(k)));
      expect(report.historyFrom).toBe(weekStart(0));
      expect(report.historyTo).toBe(addDays(thisMonday, -1));
      expect(report.items.map((item) => item.presentationId)).toEqual([ids.pD, ids.pB, ids.pC]); // by revenue: 5600, 3600, 500

      const [flat, rising, falling] = report.items as [(typeof report.items)[number], (typeof report.items)[number], (typeof report.items)[number]];
      expect(flat.history.map((point) => point.units)).toEqual([14, 14, 14, 14, 14, 14, 14, 14]); // week 5 is 20 - 6 returned
      expect(flat.history[0]).toEqual({ weekStart: weekStart(0), units: 14 });
      expect(flat).toMatchObject({ productName: "Prod D", revenueBob: "5600.00", movingAverage: 14, projectedDemandBase: 60, availableBase: 30, daysUntilStockout: 15, stockoutDate: addDays(today, 15) });
      expect(flat.forecast).toHaveLength(5);
      expect(flat.forecast[0]).toEqual({ weekStart: thisMonday, units: 14 });

      expect(rising.history.map((point) => point.units)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]); // voided and current week ignored
      expect(rising).toMatchObject({ movingAverage: 65, availableBase: 200, daysUntilStockout: 15, stockoutDate: addDays(today, 15) });
      expect(rising.trendPerWeek).toBeCloseTo(10, 6);
      expect(rising.projectedDemandBase).toBeCloseTo(457.1, 1);
      expect(rising.forecast.map((point) => Math.round(point.units)).slice(0, 3)).toEqual([90, 100, 110]);

      expect(falling.history.map((point) => point.units)).toEqual([40, 30, 20, 10, 0, 0, 0, 0]);
      expect(falling).toMatchObject({ projectedDemandBase: 0, availableBase: 0, daysUntilStockout: null, stockoutDate: null });
      expect(falling.forecast.every((point) => point.units === 0)).toBe(true);
    });

    it("filters by branch, honours horizonDays and validates it", async () => {
      const branchA = await analytics.forecast(ownerScope, { branchId: ids.branchA, horizonDays: "7" });
      expect(branchA.horizonDays).toBe(7);
      expect(branchA.items.map((item) => item.presentationId)).toEqual([ids.pB, ids.pC]);
      expect(branchA.items[0]!.forecast).toHaveLength(1);
      expect(branchA.items[0]!.projectedDemandBase).toBeCloseTo(90, 1);
      await expect(analytics.forecast(ownerScope, { horizonDays: "0" })).rejects.toMatchObject({ response: { field: "horizonDays" } });
      await expect(analytics.forecast(ownerScope, { horizonDays: "400" })).rejects.toMatchObject({ response: { field: "horizonDays" } });
      await expect(analytics.forecast(ownerScope, { horizonDays: "abc" })).rejects.toMatchObject({ response: { field: "horizonDays" } });
      await expect(analytics.forecast(scopeFor(ids.plainUser, ids.branchA), { branchId: ids.branchB })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("never mixes another pharmacy", async () => {
      const other = await analytics.forecast(scopeFor(ids.otherUser, ids.otherBranchId, ids.otherTenantId), {});
      expect(other.items).toEqual([]);
    });
  });

  describe("HTTP gates", () => {
    let app: NestFastifyApplication;
    afterAll(async () => {
      await app?.close();
    });
    beforeEach(async () => {
      fx.resetCounter();
      await ownerPool.query("truncate table tenants, users cascade");
      await seedDashboard();
    });

    async function get(url: string, userId: string): Promise<{ status: number; body: Record<string, unknown> }> {
      if (!app) {
        const { AppModule } = await import("../src/app.module.js");
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleRef.createNestApplication(new FastifyAdapter());
        await app.register(fastifyCookie);
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
      }
      const response = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${await accessTokens.issue(scopeFor(userId, ids.branchA))}` } });
      return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : {} };
    }
    const query = `from=${addDays(today, -3)}&to=${today}`;

    it("dashboard works on every plan (margin only with profitability) and forecast needs analytics.abc", async () => {
      expect((await get(`/api/v1/analytics/dashboard?${query}`, ids.plainUser)).status).toBe(403);
      expect((await get("/api/v1/analytics/forecast", ids.plainUser)).status).toBe(403);

      const premium = await get(`/api/v1/analytics/dashboard?${query}`, ids.ownerUser);
      expect(premium.status).toBe(200);
      expect(premium.body).toMatchObject({ marginAvailable: true, marginBob: "770.60" });
      expect((await get("/api/v1/analytics/forecast", ids.ownerUser)).status).toBe(200);

      await fx.setPlan("PROFESIONAL");
      expect((await get(`/api/v1/analytics/dashboard?${query}`, ids.ownerUser)).body).toMatchObject({ marginAvailable: true });
      expect((await get("/api/v1/analytics/forecast", ids.ownerUser)).status).toBe(403);

      await fx.setPlan("BASICO");
      const basico = await get(`/api/v1/analytics/dashboard?${query}`, ids.ownerUser);
      expect(basico.status).toBe(200);
      expect(basico.body).toMatchObject({ marginAvailable: false, marginBob: null, marginPercent: null, netSalesBob: "900.00" });
      expect((await get("/api/v1/analytics/forecast", ids.ownerUser)).status).toBe(403);
    }, 60_000);
  });
});
