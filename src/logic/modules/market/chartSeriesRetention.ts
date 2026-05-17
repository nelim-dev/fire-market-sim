import {
  CHART_6M_1H_BAR_COUNT,
  CHART_DAY_1M_BAR_COUNT,
  CHART_MONTH_30M_BAR_COUNT,
  CHART_WEEK_5M_BAR_COUNT,
} from './chartTimeframes';
import type { MarketChartSeriesBundle } from './chartWindows';
import type { MarketPriceBar } from './priceSeries';

/** Запас под carry-init в `buildForwardFilledLine` (бар до первого слота окна). */
const CARRY_BUFFER_BARS = 50;

export const CHART_SERIES_STORE_MAX_BARS = {
  minute: CHART_DAY_1M_BAR_COUNT + CARRY_BUFFER_BARS,
  fiveMinute: CHART_WEEK_5M_BAR_COUNT + CARRY_BUFFER_BARS,
  thirtyMinute: CHART_MONTH_30M_BAR_COUNT + CARRY_BUFFER_BARS,
  oneHour: CHART_6M_1H_BAR_COUNT + CARRY_BUFFER_BARS,
} as const;

/** Оставить последние `maxCount` баров отсортированного ряда. */
export function trimSortedBarsToMaxCount(
  bars: readonly MarketPriceBar[],
  maxCount: number
): readonly MarketPriceBar[] {
  if (maxCount <= 0 || bars.length <= maxCount) {
    return bars;
  }
  return bars.slice(bars.length - maxCount);
}

function trimRecordToMax(
  record: Record<string, readonly MarketPriceBar[]>,
  maxCount: number
): Record<string, readonly MarketPriceBar[]> {
  const out: Record<string, readonly MarketPriceBar[]> = {};
  for (const [key, bars] of Object.entries(record)) {
    out[key] = trimSortedBarsToMaxCount(bars, maxCount);
  }
  return out;
}

/**
 * Ограничить intraday-ряды в хранилище объёмом, достаточным для окон графика.
 * dailyClose / weekly не режем по count — вкладка `all` и дневная история до epoch.
 */
export function trimChartSeriesBundleForStorage(
  bundle: MarketChartSeriesBundle
): MarketChartSeriesBundle {
  return {
    minute: trimRecordToMax(bundle.minute, CHART_SERIES_STORE_MAX_BARS.minute),
    fiveMinute: trimRecordToMax(
      bundle.fiveMinute,
      CHART_SERIES_STORE_MAX_BARS.fiveMinute
    ),
    thirtyMinute: trimRecordToMax(
      bundle.thirtyMinute,
      CHART_SERIES_STORE_MAX_BARS.thirtyMinute
    ),
    oneHour: trimRecordToMax(bundle.oneHour, CHART_SERIES_STORE_MAX_BARS.oneHour),
    dailyClose: bundle.dailyClose,
    weekly: bundle.weekly,
  };
}
