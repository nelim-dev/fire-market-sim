import type { ChartTimeframeId } from './chartTimeframes';
import { CHART_TIMEFRAME_IDS } from './chartTimeframes';

/** Одна точка дневного ряда (время — конец торговой сессии по календарю, цена — закрытие). */
export type MarketPriceBar = {
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
};

export function emptyChartLinesByTimeframe(): Record<
  ChartTimeframeId,
  readonly MarketPriceBar[]
> {
  const out = {} as Record<ChartTimeframeId, readonly MarketPriceBar[]>;
  for (const id of CHART_TIMEFRAME_IDS) {
    out[id] = [];
  }
  return out;
}

export function emptyPeriodChangeByTimeframe(): Record<
  ChartTimeframeId,
  number | null
> {
  const out = {} as Record<ChartTimeframeId, number | null>;
  for (const id of CHART_TIMEFRAME_IDS) {
    out[id] = null;
  }
  return out;
}

/** Индекс последнего бара с t <= epochMs, либо -1. */
export function lastBarIndexAtOrBefore(
  bars: readonly MarketPriceBar[],
  epochMs: number
): number {
  if (bars.length === 0) {
    return -1;
  }
  let ans = -1;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= epochMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Бары с t <= epochMs; при `maxTail` — только последние `maxTail` из этого префикса
 * (без копирования всего префикса от начала истории).
 */
export function sliceTailAtOrBeforeEpoch(
  bars: readonly MarketPriceBar[],
  epochMs: number,
  maxTail?: number
): readonly MarketPriceBar[] {
  const hi = lastBarIndexAtOrBefore(bars, epochMs);
  if (hi < 0) {
    return [];
  }
  const lo =
    maxTail !== undefined && maxTail > 0 ? Math.max(0, hi - maxTail + 1) : 0;
  return bars.slice(lo, hi + 1);
}

/** Доходность за видимый отрезок: (последнее − первое) / первое закрытие, в %. */
export function computePeriodReturnPct(
  bars: readonly MarketPriceBar[]
): number | null {
  if (bars.length < 2) {
    return null;
  }
  const first = bars[0].c;
  const last = bars[bars.length - 1].c;
  if (first === 0 || !Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }
  return ((last - first) / first) * 100;
}

export function computePriceAndDailyChange(
  bars: readonly MarketPriceBar[],
  lastIdx: number
): { currentPriceRub: number | null; dailyChangePct: number | null } {
  if (lastIdx < 0) {
    return { currentPriceRub: null, dailyChangePct: null };
  }
  const cur = bars[lastIdx].c;
  if (lastIdx === 0) {
    return { currentPriceRub: cur, dailyChangePct: null };
  }
  const prev = bars[lastIdx - 1].c;
  if (prev === 0) {
    return { currentPriceRub: cur, dailyChangePct: null };
  }
  const dailyChangePct = ((cur - prev) / prev) * 100;
  return { currentPriceRub: cur, dailyChangePct };
}

/**
 * Прореживание для отображения (storage dailyClose не меняется).
 * Сохраняет первую и последнюю точку диапазона.
 */
export function downsampleBarsForChartDisplay(
  bars: readonly MarketPriceBar[],
  maxPoints: number
): readonly MarketPriceBar[] {
  if (maxPoints <= 0 || bars.length <= maxPoints) {
    return bars;
  }
  if (maxPoints === 1) {
    return [bars[bars.length - 1]!];
  }
  const out: MarketPriceBar[] = [];
  const lastIdx = bars.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round((i * lastIdx) / (maxPoints - 1));
    out.push(bars[idx]!);
  }
  return out;
}
