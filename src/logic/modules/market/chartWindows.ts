import type { ChartTimeframeId } from './chartTimeframes';
import {
  CHART_6M_MIN_1H_BAR_COUNT,
  CHART_ALL_MIN_DAILY_BAR_COUNT,
  CHART_DAY_MIN_1M_BAR_COUNT,
  CHART_MONTH_MIN_30M_BAR_COUNT,
  CHART_WEEK_MIN_5M_BAR_COUNT,
  CHART_YEAR_MIN_DAILY_BAR_COUNT,
} from './chartTimeframes';
import {
  emptyChartLinesByTimeframe,
  lastBarIndexAtOrBefore,
  type MarketPriceBar,
} from './priceSeries';

const DAY_MS = 86_400_000;

/** Срезы рядов рынка (из SQLite через Electron или пусто до гидрации). */
export type MarketChartSeriesBundle = {
  minute: Record<string, readonly MarketPriceBar[]>;
  dailyClose: Record<string, readonly MarketPriceBar[]>;
  fiveMinute: Record<string, readonly MarketPriceBar[]>;
  thirtyMinute: Record<string, readonly MarketPriceBar[]>;
  oneHour: Record<string, readonly MarketPriceBar[]>;
  weekly: Record<string, readonly MarketPriceBar[]>;
};

export function emptyChartSeriesBundle(): MarketChartSeriesBundle {
  return {
    minute: {},
    dailyClose: {},
    fiveMinute: {},
    thirtyMinute: {},
    oneHour: {},
    weekly: {},
  };
}

function clipToEpochSorted(
  bars: readonly MarketPriceBar[],
  epochMs: number
): readonly MarketPriceBar[] {
  const hi = lastBarIndexAtOrBefore(bars, epochMs);
  if (hi < 0) {
    return [];
  }
  return bars.slice(0, hi + 1);
}

function filterByTimeRange(
  bars: readonly MarketPriceBar[],
  fromT: number,
  toT: number
): MarketPriceBar[] {
  const out: MarketPriceBar[] = [];
  for (const b of bars) {
    if (b.t >= fromT && b.t <= toT) {
      out.push(b);
    }
  }
  return out;
}

function withMinBarsFloor(
  fullClipped: readonly MarketPriceBar[],
  ranged: readonly MarketPriceBar[],
  minBars: number
): readonly MarketPriceBar[] {
  if (minBars <= 0 || ranged.length >= minBars) {
    return ranged;
  }
  if (fullClipped.length <= minBars) {
    return fullClipped;
  }
  return fullClipped.slice(fullClipped.length - minBars);
}

/**
 * Срезы линии графика по таймфрейму: обрезка по epoch и выбор агрегата по горизонту.
 * Каноника: 1d->1m, 1w->5m, 1m->30m, 6m->1h, 1y/all->1d.
 */
export function buildChartLineByTimeframeFromBundle(
  symbol: string,
  bundle: MarketChartSeriesBundle,
  epochMs: number
): Record<ChartTimeframeId, readonly MarketPriceBar[]> {
  const sym = symbol.toUpperCase();
  const minute = bundle.minute[sym] ?? [];
  const daily = bundle.dailyClose[sym] ?? [];
  const m5 = bundle.fiveMinute[sym] ?? [];
  const m30 = bundle.thirtyMinute[sym] ?? [];
  const h1 = bundle.oneHour[sym] ?? [];

  const out = emptyChartLinesByTimeframe();

  const clipped1m = clipToEpochSorted(minute, epochMs);
  out['1d'] = withMinBarsFloor(
    clipped1m,
    filterByTimeRange(clipped1m, epochMs - DAY_MS, epochMs),
    CHART_DAY_MIN_1M_BAR_COUNT
  );

  const clipped5 = clipToEpochSorted(m5, epochMs);
  const wFrom = epochMs - 7 * DAY_MS;
  out['1w'] = withMinBarsFloor(
    clipped5,
    filterByTimeRange(clipped5, wFrom, epochMs),
    CHART_WEEK_MIN_5M_BAR_COUNT
  );

  const clipped30 = clipToEpochSorted(m30, epochMs);
  const mFrom = epochMs - 30 * DAY_MS;
  out['1m'] = withMinBarsFloor(
    clipped30,
    filterByTimeRange(clipped30, mFrom, epochMs),
    CHART_MONTH_MIN_30M_BAR_COUNT
  );

  const clipped1h = clipToEpochSorted(h1, epochMs);
  const hFrom = epochMs - 180 * DAY_MS;
  out['6m'] = withMinBarsFloor(
    clipped1h,
    filterByTimeRange(clipped1h, hFrom, epochMs),
    CHART_6M_MIN_1H_BAR_COUNT
  );

  const clippedDaily = clipToEpochSorted(daily, epochMs);
  const yFrom = epochMs - 365 * DAY_MS;
  out['1y'] = withMinBarsFloor(
    clippedDaily,
    filterByTimeRange(clippedDaily, yFrom, epochMs),
    CHART_YEAR_MIN_DAILY_BAR_COUNT
  );

  out.all = withMinBarsFloor(clippedDaily, clippedDaily, CHART_ALL_MIN_DAILY_BAR_COUNT);

  return out;
}
