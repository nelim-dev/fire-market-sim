import type { ChartTimeframeId } from './chartTimeframes';
import {
  CHART_6M_SLIDING_1H_BAR_COUNT,
  CHART_ALL_SLIDING_WEEKLY_BAR_COUNT,
  CHART_DAY_SLIDING_1M_BAR_COUNT,
  CHART_MONTH_SLIDING_30M_BAR_COUNT,
  CHART_WEEK_SLIDING_5M_BAR_COUNT,
  CHART_YEAR_SLIDING_DAILY_BAR_COUNT,
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

function tailBars(
  bars: readonly MarketPriceBar[],
  max: number
): readonly MarketPriceBar[] {
  if (bars.length <= max) {
    return bars;
  }
  return bars.slice(bars.length - max);
}

/**
 * Срезы линии графика по таймфрейму (см. план M3 п.6.2): обрезка по epoch и выбор ряда.
 * Каждый таймфрейм — скользящее окно последних N свечей внутри календарного горизонта.
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
  const wk = bundle.weekly[sym] ?? [];

  const out = emptyChartLinesByTimeframe();

  const clipped1m = clipToEpochSorted(minute, epochMs);
  out['1d'] = tailBars(clipped1m, CHART_DAY_SLIDING_1M_BAR_COUNT);

  const clipped5 = clipToEpochSorted(m5, epochMs);

  const wFrom = epochMs - 10 * DAY_MS;
  out['1w'] = tailBars(
    filterByTimeRange(clipped5, wFrom, epochMs),
    CHART_WEEK_SLIDING_5M_BAR_COUNT
  );

  const mFrom = epochMs - 30 * DAY_MS;
  out['1m'] = tailBars(
    filterByTimeRange(clipToEpochSorted(m30, epochMs), mFrom, epochMs),
    CHART_MONTH_SLIDING_30M_BAR_COUNT
  );

  const hFrom = epochMs - 180 * DAY_MS;
  out['6m'] = tailBars(
    filterByTimeRange(clipToEpochSorted(h1, epochMs), hFrom, epochMs),
    CHART_6M_SLIDING_1H_BAR_COUNT
  );

  const yFrom = epochMs - 365 * DAY_MS;
  out['1y'] = tailBars(
    filterByTimeRange(clipToEpochSorted(daily, epochMs), yFrom, epochMs),
    CHART_YEAR_SLIDING_DAILY_BAR_COUNT
  );

  out.all = tailBars(clipToEpochSorted(wk, epochMs), CHART_ALL_SLIDING_WEEKLY_BAR_COUNT);

  return out;
}
