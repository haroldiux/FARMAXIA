/**
 * Demand forecast (D75): no machine learning. The level is the moving average of the last 4 weeks and the trend is
 * the least-squares slope over the whole history; the forecast for week k after the history is
 * `MA4 + slope x (k + 1.5)` (the moving average is centered 1.5 weeks before the last observed week) and never negative.
 */

export const FORECAST_MA_WEEKS = 4;
/** Longest stockout projection: stock that outlasts this many days has no projected date. */
export const MAX_STOCKOUT_DAYS = 365;

export interface ForecastInput {
  /** Net weekly units, oldest first. */
  weekly: number[];
  horizonDays: number;
  availableBase: number;
}

export interface ForecastResult {
  movingAverage: number;
  /** Least-squares slope in units per week. */
  trendPerWeek: number;
  /** Forecast units for each of the ceil(horizonDays / 7) weeks after the history. */
  weeklyForecast: number[];
  /** Units expected over exactly `horizonDays` days. */
  projectedDemand: number;
  /** Whole days until the available stock is consumed; 0 when already out; null without demand or beyond a year. */
  daysUntilStockout: number | null;
}

export function leastSquaresSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let variance = 0;
  values.forEach((value, x) => {
    covariance += (x - meanX) * (value - meanY);
    variance += (x - meanX) ** 2;
  });
  return covariance / variance;
}

export function forecastDemand({ weekly, horizonDays, availableBase }: ForecastInput): ForecastResult {
  const recent = weekly.slice(-FORECAST_MA_WEEKS);
  const movingAverage = recent.length === 0 ? 0 : recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const trendPerWeek = leastSquaresSlope(weekly);
  const centerOffset = (recent.length - 1) / 2; // distance from the last observed week to the center of the moving average
  const forecastWeek = (k: number) => Math.max(0, movingAverage + trendPerWeek * (k + centerOffset));

  const weeks = Math.ceil(horizonDays / 7);
  const weeklyForecast = Array.from({ length: weeks }, (_, index) => forecastWeek(index + 1));
  let projected = 0;
  weeklyForecast.forEach((units, index) => {
    projected += (units * Math.min(7, horizonDays - 7 * index)) / 7;
  });

  let daysUntilStockout: number | null = null;
  if (availableBase <= 0) {
    daysUntilStockout = weeklyForecast.some((units) => units > 0) || forecastWeek(weeks + 1) > 0 ? 0 : null;
  } else {
    let consumed = 0;
    for (let day = 1; day <= MAX_STOCKOUT_DAYS; day += 1) {
      consumed += forecastWeek(Math.ceil(day / 7)) / 7;
      if (consumed >= availableBase) {
        daysUntilStockout = day;
        break;
      }
    }
  }
  return { movingAverage: round(movingAverage, 2), trendPerWeek, weeklyForecast, projectedDemand: round(projected, 1), daysUntilStockout };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
