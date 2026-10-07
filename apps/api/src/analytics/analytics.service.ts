import { Inject, Injectable } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { csvCell } from "../controlled/controlled.service.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { featureEnabled, invalid, optionalDate, requireUuid, requiredPeriod } from "../staff/staff.common.js";
import {
  availableStockByPresentation,
  countTickets,
  forEachBranch,
  laPazDay,
  money,
  nearExpiryStock,
  netSalesByPresentation,
  periodDays,
  weeklyNetSales,
  type AnalyticsBranch,
  type AvailableStockRow,
  type NetSalesRow
} from "./analytics-data.js";
import { forecastDemand } from "./analytics-forecast.js";
import { LOW_COVERAGE_DAYS, VELOCITY_DAYS, findShortages, type Shortage } from "./analytics-stockouts.js";

export type AbcClass = "A" | "B" | "C";

export interface AbcItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  /** Net units sold, in the presentation's own unit. */
  units: number;
  revenueBob: string;
  sharePercent: string;
  cumulativePercent: string;
  class: AbcClass;
}

export interface AbcReport {
  from: string;
  to: string;
  branchId: string | null;
  totalRevenueBob: string;
  summary: Record<AbcClass, number>;
  items: AbcItem[];
}

export interface RotationItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  soldBase: number;
  avgDailyBase: number;
  availableBase: number;
  /** Null when nothing sold in the period. */
  daysOfInventory: number | null;
  cogsBob: string;
  /** Available stock at the current average cost; null without a recorded cost. */
  stockValueBob: string | null;
  /** Cost of goods sold in the period / current stock value; null when the stock value is unknown or zero. */
  turnover: number | null;
  flags: Array<"NO_MOVEMENT">;
}

export interface RotationReport {
  from: string;
  to: string;
  days: number;
  branchId: string | null;
  items: RotationItem[];
}

export type ProfitabilityGroup = "product" | "laboratory" | "branch";

export interface ProfitabilityRow {
  /** Product id, lower-cased laboratory ("" for none) or branch id. */
  key: string;
  name: string;
  units: number;
  revenueBob: string;
  /** Cost of the lines with a known cost (snapshot, or current average cost when the snapshot is missing). */
  costBob: string;
  /** Revenue of the lines with a known cost minus their cost; null when no line has a cost. */
  marginBob: string | null;
  marginPercent: string | null;
  /** Percent of the revenue whose cost is an estimate (current average cost instead of a snapshot). */
  estimatedShare: string;
  /** Revenue of lines with neither snapshot nor current cost (excluded from the margin). */
  uncostedRevenueBob: string;
}

export interface ProfitabilityReport {
  from: string;
  to: string;
  groupBy: ProfitabilityGroup;
  branchId: string | null;
  totals: Omit<ProfitabilityRow, "key" | "name">;
  rows: ProfitabilityRow[];
}

export interface AnalyticsQuery {
  from?: string;
  to?: string;
  branchId?: string;
  groupBy?: string;
  horizonDays?: string;
}

export interface StockoutItem extends Shortage {
  branchId: string;
  branchName: string;
}

export interface StockoutsReport {
  branchId: string | null;
  velocityDays: number;
  lowCoverageDays: number;
  items: StockoutItem[];
}

export interface DashboardTopProduct {
  productId: string;
  productName: string;
  units: number;
  revenueBob: string;
  sharePercent: string;
}

export interface DashboardReport {
  from: string;
  to: string;
  branchId: string | null;
  netSalesBob: string;
  tickets: number;
  averageTicketBob: string;
  /** Net units sold, each in its presentation's own unit. */
  units: number;
  topProducts: DashboardTopProduct[];
  /** Out-of-stock (branch, presentation) pairs right now (D74). */
  outOfStockCount: number;
  nearExpiry: { days: number; units: number; valueBob: string; uncostedUnits: number };
  /** False when the plan lacks analytics.profitability: margin figures are then null. */
  marginAvailable: boolean;
  marginBob: string | null;
  marginPercent: string | null;
}

export interface WeekPoint {
  weekStart: string;
  units: number;
}

export interface ForecastItem {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  /** Net revenue of the 8-week window (ranking criterion). */
  revenueBob: string;
  /** Net base units per complete La Paz week, oldest first. */
  history: WeekPoint[];
  /** Forecast base units for each week of the horizon. */
  forecast: WeekPoint[];
  movingAverage: number;
  trendPerWeek: number;
  projectedDemandBase: number;
  availableBase: number;
  daysUntilStockout: number | null;
  stockoutDate: string | null;
}

export interface ForecastReport {
  branchId: string | null;
  horizonDays: number;
  historyFrom: string;
  historyTo: string;
  weekStarts: string[];
  items: ForecastItem[];
}

const NO_LABORATORY = "Sin laboratorio";
const NEAR_EXPIRY_DAYS = 30;
const TOP_PRODUCTS = 10;
const FORECAST_WEEKS = 8;
const FORECAST_ITEMS = 20;
const DEFAULT_HORIZON_DAYS = 30;
const MAX_HORIZON_DAYS = 90;
const DEFAULT_ROTATION_DAYS = 30;
const GROUPS: readonly ProfitabilityGroup[] = ["product", "laboratory", "branch"];

function branchFilter(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireUuid(value, "branchId");
}

function percent(part: number, whole: number): string {
  return whole > 0 ? money((part / whole) * 100) : "0.00";
}

/** Cost and revenue figures of a net-sales row after applying the snapshot / current-cost rule (D72). */
function costing(row: NetSalesRow): { cost: number; costedRevenue: number; estimatedRevenue: number; uncostedRevenue: number } {
  const hasCurrentCost = row.averageCost !== null;
  return {
    cost: row.snapshotCost + (hasCurrentCost ? row.unsnapshotBase * (row.averageCost as number) : 0),
    costedRevenue: row.snapshotRevenue + (hasCurrentCost ? row.unsnapshotRevenue : 0),
    estimatedRevenue: hasCurrentCost ? row.unsnapshotRevenue : 0,
    uncostedRevenue: hasCurrentCost ? 0 : row.unsnapshotRevenue
  };
}

function horizonFilter(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_HORIZON_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_HORIZON_DAYS) {
    throw invalid("horizonDays", `El horizonte debe ser un entero entre 1 y ${MAX_HORIZON_DAYS} días.`);
  }
  return days;
}

function shiftDay(day: string, offsetDays: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

interface Accumulator {
  key: string;
  name: string;
  units: number;
  revenue: number;
  cost: number;
  costedRevenue: number;
  estimatedRevenue: number;
  uncostedRevenue: number;
}

function toRow(acc: Omit<Accumulator, "key" | "name">): Omit<ProfitabilityRow, "key" | "name"> {
  return {
    units: acc.units,
    revenueBob: money(acc.revenue),
    costBob: money(acc.cost),
    marginBob: acc.costedRevenue > 0 ? money(acc.costedRevenue - acc.cost) : null,
    marginPercent: acc.costedRevenue > 0 ? percent(acc.costedRevenue - acc.cost, acc.costedRevenue) : null,
    estimatedShare: percent(acc.estimatedRevenue, acc.revenue),
    uncostedRevenueBob: money(acc.uncostedRevenue)
  };
}

/** Margin figures of a set of net-sales rows with the same snapshot / current-cost rule as the profitability report (D72). */
function totalsOf(rows: NetSalesRow[]): Omit<ProfitabilityRow, "key" | "name"> {
  const total = { units: 0, revenue: 0, cost: 0, costedRevenue: 0, estimatedRevenue: 0, uncostedRevenue: 0 };
  for (const row of rows) {
    if (row.units <= 0 && row.revenue <= 0) continue;
    const figures = costing(row);
    total.units += row.units;
    total.revenue += row.revenue;
    total.cost += figures.cost;
    total.costedRevenue += figures.costedRevenue;
    total.estimatedRevenue += figures.estimatedRevenue;
    total.uncostedRevenue += figures.uncostedRevenue;
  }
  return toRow(total);
}

@Injectable()
export class AnalyticsService {
  private readonly features: FeatureService;

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  /** Net sales rows of every accessible branch (or the filtered one) for the period. */
  private async salesByBranch(scope: TenantScope, from: string, to: string, branchId: string | null): Promise<Array<{ branch: AnalyticsBranch; rows: NetSalesRow[] }>> {
    return forEachBranch(this.database, scope, branchId, async (client, branch) => ({
      branch,
      rows: await netSalesByPresentation(client, scope.tenantId, branch.id, from, to)
    }));
  }

  /** ABC classification of presentations by net revenue (D73): A up to 80 % cumulative, B up to 95 %, C the rest. */
  async abc(scope: TenantScope, query: AnalyticsQuery): Promise<AbcReport> {
    const { from, to } = requiredPeriod(query.from, query.to);
    const branchId = branchFilter(query.branchId);
    const merged = new Map<string, NetSalesRow>();
    for (const { rows } of await this.salesByBranch(scope, from, to, branchId)) {
      for (const row of rows) {
        const current = merged.get(row.presentationId);
        merged.set(row.presentationId, current ? { ...current, units: current.units + row.units, revenue: current.revenue + row.revenue } : { ...row });
      }
    }
    const sorted = [...merged.values()]
      .map((row) => ({ row, cents: Math.round(row.revenue * 100) }))
      .filter((entry) => entry.cents > 0)
      .sort((a, b) => b.cents - a.cents || a.row.productName.localeCompare(b.row.productName) || a.row.presentationId.localeCompare(b.row.presentationId));
    const totalCents = sorted.reduce((sum, entry) => sum + entry.cents, 0);
    const summary: Record<AbcClass, number> = { A: 0, B: 0, C: 0 };
    let cumulative = 0;
    const items = sorted.map(({ row, cents }, index): AbcItem => {
      cumulative += cents;
      // Integer comparison (cumulative/total <= 80 %); the top seller is always A even when it alone exceeds 80 %.
      const klass: AbcClass = index === 0 || cumulative * 100 <= 80 * totalCents ? "A" : cumulative * 100 <= 95 * totalCents ? "B" : "C";
      summary[klass] += 1;
      return {
        presentationId: row.presentationId,
        productId: row.productId,
        productName: row.productName,
        presentationName: row.presentationName,
        units: row.units,
        revenueBob: money(cents / 100),
        sharePercent: percent(cents, totalCents),
        cumulativePercent: percent(cumulative, totalCents),
        class: klass
      };
    });
    return { from, to, branchId, totalRevenueBob: money(totalCents / 100), summary, items };
  }

  /** Rotation and days of inventory (D74) per presentation over the period (default: last 30 La Paz days). */
  async rotation(scope: TenantScope, query: AnalyticsQuery): Promise<RotationReport> {
    const hasPeriod = optionalDate(query.from, "from") !== null || optionalDate(query.to, "to") !== null;
    const { from, to } = hasPeriod ? requiredPeriod(query.from, query.to) : { from: laPazDay(-(DEFAULT_ROTATION_DAYS - 1)), to: laPazDay(0) };
    const days = periodDays(from, to);
    const branchId = branchFilter(query.branchId);

    interface Merged {
      info: { presentationId: string; productId: string; productName: string; presentationName: string; baseUnitFactor: number };
      soldBase: number;
      cogs: number;
      availableBase: number;
      averageCost: number | null;
    }
    const merged = new Map<string, Merged>();
    const entry = (info: Merged["info"], averageCost: number | null): Merged => {
      let current = merged.get(info.presentationId);
      if (!current) {
        current = { info, soldBase: 0, cogs: 0, availableBase: 0, averageCost };
        merged.set(info.presentationId, current);
      }
      current.averageCost ??= averageCost;
      return current;
    };
    const perBranch = await forEachBranch(this.database, scope, branchId, async (client, branch) => ({
      sales: await netSalesByPresentation(client, scope.tenantId, branch.id, from, to),
      stock: await availableStockByPresentation(client, scope.tenantId, branch.id)
    }));
    for (const { sales, stock } of perBranch) {
      for (const row of sales) {
        const current = entry(row, row.averageCost);
        current.soldBase += Math.max(row.base, 0);
        current.cogs += costing(row).cost;
      }
      for (const row of stock as AvailableStockRow[]) {
        entry(row, row.averageCost).availableBase += row.availableBase;
      }
    }

    const items: RotationItem[] = [];
    for (const current of merged.values()) {
      if (current.soldBase <= 0 && current.availableBase <= 0) continue;
      const avgDaily = current.soldBase / days;
      const stockValue = current.averageCost === null ? null : current.availableBase * current.averageCost;
      items.push({
        presentationId: current.info.presentationId,
        productId: current.info.productId,
        productName: current.info.productName,
        presentationName: current.info.presentationName,
        baseUnitFactor: current.info.baseUnitFactor,
        soldBase: current.soldBase,
        avgDailyBase: Math.round(avgDaily * 100) / 100,
        availableBase: current.availableBase,
        daysOfInventory: avgDaily > 0 ? Math.round((current.availableBase / avgDaily) * 10) / 10 : null,
        cogsBob: money(current.cogs),
        stockValueBob: stockValue === null ? null : money(stockValue),
        turnover: stockValue !== null && stockValue > 0 ? Math.round((current.cogs / stockValue) * 100) / 100 : null,
        flags: current.availableBase > 0 && current.soldBase <= 0 ? ["NO_MOVEMENT"] : []
      });
    }
    // Soonest to run out first; items without sales (no days) last.
    items.sort(
      (a, b) =>
        (a.daysOfInventory ?? Number.POSITIVE_INFINITY) - (b.daysOfInventory ?? Number.POSITIVE_INFINITY) ||
        a.productName.localeCompare(b.productName) ||
        a.presentationId.localeCompare(b.presentationId)
    );
    return { from, to, days, branchId, items };
  }

  /** Margin by product, laboratory or branch (D72): snapshot cost when present, current average cost otherwise (estimated). */
  async profitability(scope: TenantScope, query: AnalyticsQuery): Promise<ProfitabilityReport> {
    const { from, to } = requiredPeriod(query.from, query.to);
    const groupBy = (query.groupBy ?? "product") as ProfitabilityGroup;
    if (!GROUPS.includes(groupBy)) throw invalid("groupBy", "Agrupe por product, laboratory o branch.");
    const branchId = branchFilter(query.branchId);

    const groups = new Map<string, Accumulator>();
    const total: Accumulator = { key: "", name: "", units: 0, revenue: 0, cost: 0, costedRevenue: 0, estimatedRevenue: 0, uncostedRevenue: 0 };
    for (const { branch, rows } of await this.salesByBranch(scope, from, to, branchId)) {
      for (const row of rows) {
        if (row.units <= 0 && row.revenue <= 0) continue;
        let key: string;
        let name: string;
        if (groupBy === "product") {
          key = row.productId;
          name = row.productName;
        } else if (groupBy === "branch") {
          key = branch.id;
          name = branch.name;
        } else {
          const trimmed = row.laboratory?.trim() ?? "";
          key = trimmed.toLowerCase();
          name = trimmed || NO_LABORATORY;
        }
        let group = groups.get(key);
        if (!group) {
          group = { key, name, units: 0, revenue: 0, cost: 0, costedRevenue: 0, estimatedRevenue: 0, uncostedRevenue: 0 };
          groups.set(key, group);
        } else if (groupBy === "laboratory" && name < group.name) {
          group.name = name; // stable label for spelling variants
        }
        const figures = costing(row);
        for (const target of [group, total]) {
          target.units += row.units;
          target.revenue += row.revenue;
          target.cost += figures.cost;
          target.costedRevenue += figures.costedRevenue;
          target.estimatedRevenue += figures.estimatedRevenue;
          target.uncostedRevenue += figures.uncostedRevenue;
        }
      }
    }
    const rows = [...groups.values()]
      .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
      .map((group): ProfitabilityRow => ({ key: group.key, name: group.name, ...toRow(group) }));
    return { from, to, groupBy, branchId, totals: toRow(total), rows };
  }

  /** Current shortages (D74) of every accessible branch: out of stock first, then the soonest to run out. */
  async stockouts(scope: TenantScope, query: AnalyticsQuery): Promise<StockoutsReport> {
    const branchId = branchFilter(query.branchId);
    const from = laPazDay(-(VELOCITY_DAYS - 1));
    const to = laPazDay(0);
    const perBranch = await forEachBranch(this.database, scope, branchId, async (client, branch) =>
      findShortages(await netSalesByPresentation(client, scope.tenantId, branch.id, from, to), await availableStockByPresentation(client, scope.tenantId, branch.id)).map(
        (shortage): StockoutItem => ({ ...shortage, branchId: branch.id, branchName: branch.name })
      )
    );
    const items = perBranch
      .flat()
      .sort(
        (a, b) =>
          Number(b.kind === "OUT_OF_STOCK") - Number(a.kind === "OUT_OF_STOCK") ||
          a.daysOfInventory - b.daysOfInventory ||
          a.productName.localeCompare(b.productName) ||
          a.branchName.localeCompare(b.branchName)
      );
    return { branchId, velocityDays: VELOCITY_DAYS, lowCoverageDays: LOW_COVERAGE_DAYS, items };
  }

  /** Executive KPIs for the period (reports.basic); margin only when the plan has analytics.profitability. */
  async dashboard(scope: TenantScope, query: AnalyticsQuery): Promise<DashboardReport> {
    const { from, to } = requiredPeriod(query.from, query.to);
    const branchId = branchFilter(query.branchId);
    const withMargin = await featureEnabled(this.features, scope, "analytics.profitability");
    const velocityFrom = laPazDay(-(VELOCITY_DAYS - 1));
    const velocityTo = laPazDay(0);
    const perBranch = await forEachBranch(this.database, scope, branchId, async (client, branch) => {
      const shortages = findShortages(
        await netSalesByPresentation(client, scope.tenantId, branch.id, velocityFrom, velocityTo),
        await availableStockByPresentation(client, scope.tenantId, branch.id)
      );
      return {
        rows: await netSalesByPresentation(client, scope.tenantId, branch.id, from, to),
        tickets: await countTickets(client, scope.tenantId, branch.id, from, to),
        nearExpiry: await nearExpiryStock(client, scope.tenantId, branch.id, NEAR_EXPIRY_DAYS),
        outOfStock: shortages.filter((shortage) => shortage.kind === "OUT_OF_STOCK").length
      };
    });

    const rows = perBranch.flatMap((entry) => entry.rows);
    const tickets = perBranch.reduce((sum, entry) => sum + entry.tickets, 0);
    const netSales = rows.reduce((sum, row) => sum + row.revenue, 0);
    const products = new Map<string, DashboardTopProduct & { revenue: number }>();
    for (const row of rows) {
      const current = products.get(row.productId) ?? { productId: row.productId, productName: row.productName, units: 0, revenueBob: "", sharePercent: "", revenue: 0 };
      current.units += row.units;
      current.revenue += row.revenue;
      products.set(row.productId, current);
    }
    const topProducts = [...products.values()]
      .filter((product) => product.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue || a.productName.localeCompare(b.productName))
      .slice(0, TOP_PRODUCTS)
      .map(({ revenue, ...product }) => ({ ...product, revenueBob: money(revenue), sharePercent: percent(revenue, netSales) }));

    const margin = withMargin ? totalsOf(rows) : null;
    return {
      from,
      to,
      branchId,
      netSalesBob: money(netSales),
      tickets,
      averageTicketBob: tickets > 0 ? money(netSales / tickets) : "0.00",
      units: rows.reduce((sum, row) => sum + row.units, 0),
      topProducts,
      outOfStockCount: perBranch.reduce((sum, entry) => sum + entry.outOfStock, 0),
      nearExpiry: {
        days: NEAR_EXPIRY_DAYS,
        units: perBranch.reduce((sum, entry) => sum + entry.nearExpiry.units, 0),
        valueBob: money(perBranch.reduce((sum, entry) => sum + entry.nearExpiry.value, 0)),
        uncostedUnits: perBranch.reduce((sum, entry) => sum + entry.nearExpiry.uncostedUnits, 0)
      },
      marginAvailable: withMargin,
      marginBob: margin?.marginBob ?? null,
      marginPercent: margin?.marginPercent ?? null
    };
  }

  /** Demand forecast (D75) of the top presentations by recent revenue: last 8 complete La Paz weeks (Monday start). */
  async forecast(scope: TenantScope, query: AnalyticsQuery): Promise<ForecastReport> {
    const branchId = branchFilter(query.branchId);
    const horizonDays = horizonFilter(query.horizonDays);
    const today = laPazDay(0);
    const thisMonday = shiftDay(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const weekStarts = Array.from({ length: FORECAST_WEEKS }, (_, index) => shiftDay(thisMonday, -7 * (FORECAST_WEEKS - index)));
    const historyFrom = weekStarts[0]!;
    const historyTo = shiftDay(thisMonday, -1);

    const perBranch = await forEachBranch(this.database, scope, branchId, async (client, branch) => ({
      weekly: await weeklyNetSales(client, scope.tenantId, branch.id, historyFrom, historyTo),
      stock: await availableStockByPresentation(client, scope.tenantId, branch.id)
    }));
    interface Series {
      info: { presentationId: string; productId: string; productName: string; presentationName: string; baseUnitFactor: number };
      revenue: number;
      byWeek: Map<string, number>;
      available: number;
    }
    const series = new Map<string, Series>();
    for (const { weekly, stock } of perBranch) {
      for (const row of weekly) {
        let current = series.get(row.presentationId);
        if (!current) {
          current = {
            info: { presentationId: row.presentationId, productId: row.productId, productName: row.productName, presentationName: row.presentationName, baseUnitFactor: row.baseUnitFactor },
            revenue: 0,
            byWeek: new Map(),
            available: 0
          };
          series.set(row.presentationId, current);
        }
        current.revenue += row.revenue;
        current.byWeek.set(row.weekStart, (current.byWeek.get(row.weekStart) ?? 0) + row.base);
      }
      for (const row of stock) {
        const current = series.get(row.presentationId);
        if (current) current.available += row.availableBase;
      }
    }
    const items = [...series.values()]
      .filter((entry) => entry.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue || a.info.productName.localeCompare(b.info.productName) || a.info.presentationId.localeCompare(b.info.presentationId))
      .slice(0, FORECAST_ITEMS)
      .map((entry): ForecastItem => {
        const weekly = weekStarts.map((weekStart) => Math.max(entry.byWeek.get(weekStart) ?? 0, 0));
        const result = forecastDemand({ weekly, horizonDays, availableBase: entry.available });
        return {
          ...entry.info,
          revenueBob: money(entry.revenue),
          history: weekStarts.map((weekStart, index) => ({ weekStart, units: weekly[index]! })),
          forecast: result.weeklyForecast.map((units, index) => ({ weekStart: shiftDay(thisMonday, 7 * index), units: Math.round(units * 10) / 10 })),
          movingAverage: result.movingAverage,
          trendPerWeek: Math.round(result.trendPerWeek * 100) / 100,
          projectedDemandBase: result.projectedDemand,
          availableBase: entry.available,
          daysUntilStockout: result.daysUntilStockout,
          stockoutDate: result.daysUntilStockout === null ? null : shiftDay(today, result.daysUntilStockout)
        };
      });
    return { branchId, horizonDays, historyFrom, historyTo, weekStarts, items };
  }

  /** CSV of the profitability report (BOM + CRLF like the controlled book export). */
  async profitabilityCsv(scope: TenantScope, query: AnalyticsQuery): Promise<{ filename: string; csv: string }> {
    const report = await this.profitability(scope, query);
    const header = ["Grupo", "Unidades", "Ingresos (Bs)", "Costo (Bs)", "Margen (Bs)", "Margen %", "Estimado %", "Sin costo (Bs)"];
    const lines = report.rows.map((row) =>
      [row.name, row.units, row.revenueBob, row.costBob, row.marginBob, row.marginPercent, row.estimatedShare, row.uncostedRevenueBob].map(csvCell).join(",")
    );
    return {
      filename: `rentabilidad-${report.groupBy}-${report.from}-${report.to}.csv`,
      csv: `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`
    };
  }
}
