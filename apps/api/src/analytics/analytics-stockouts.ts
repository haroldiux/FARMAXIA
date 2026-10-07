import type { AvailableStockRow, NetSalesRow } from "./analytics-data.js";

/** D74: velocity window, coverage threshold and the target coverage used for the suggested quantity. */
export const VELOCITY_DAYS = 30;
export const LOW_COVERAGE_DAYS = 7;
export const COVERAGE_TARGET_DAYS = 30;

export type ShortageKind = "OUT_OF_STOCK" | "LOW_COVERAGE";

export interface Shortage {
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  kind: ShortageKind;
  availableBase: number;
  avgDailyBase: number;
  /** 0 when out of stock; 1 decimal otherwise. */
  daysOfInventory: number;
  /** Base units to buy to cover COVERAGE_TARGET_DAYS at the current velocity. */
  suggestedBase: number;
}

/**
 * Current shortages of ONE branch from its last-30-days net sales and available stock (D74): out of stock when
 * nothing is available but net units sold in the window are positive; low coverage when days of inventory < 7.
 */
export function findShortages(sales: NetSalesRow[], stock: AvailableStockRow[]): Shortage[] {
  const available = new Map(stock.map((row) => [row.presentationId, row.availableBase]));
  const shortages: Shortage[] = [];
  for (const sale of sales) {
    const soldBase = Math.max(sale.base, 0);
    if (soldBase <= 0) continue;
    const availableBase = available.get(sale.presentationId) ?? 0;
    const avgDaily = soldBase / VELOCITY_DAYS;
    const days = availableBase / avgDaily;
    const kind: ShortageKind | null = availableBase <= 0 ? "OUT_OF_STOCK" : days < LOW_COVERAGE_DAYS ? "LOW_COVERAGE" : null;
    if (!kind) continue;
    shortages.push({
      presentationId: sale.presentationId,
      productId: sale.productId,
      productName: sale.productName,
      presentationName: sale.presentationName,
      baseUnitFactor: sale.baseUnitFactor,
      kind,
      availableBase,
      avgDailyBase: Math.round(avgDaily * 100) / 100,
      daysOfInventory: kind === "OUT_OF_STOCK" ? 0 : Math.round(days * 10) / 10,
      suggestedBase: Math.max(Math.ceil(avgDaily * COVERAGE_TARGET_DAYS - availableBase - 1e-9), 0)
    });
  }
  return shortages;
}
