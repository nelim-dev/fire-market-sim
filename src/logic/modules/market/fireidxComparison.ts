import type { MarketPriceBar } from './priceSeries';
import { lastBarIndexAtOrBefore } from './priceSeries';

export const FIREIDX_COMPARISON_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

export type FireidxComparisonMode = 'earliest-available' | 'rolling-1y';

export type FireidxComparisonBaseline = {
  readonly baselineEpochMs: number;
  readonly indexBaseline: number;
  readonly indexNow: number;
  readonly mode: FireidxComparisonMode;
};

export function computeReturnPct(now: number, baseline: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(baseline) || baseline <= 0) {
    return 0;
  }
  return ((now / baseline - 1) * 100);
}

export function computeExcessReturnPct(
  portfolioNow: number,
  portfolioBaseline: number,
  indexNow: number,
  indexBaseline: number
): number {
  return (
    computeReturnPct(portfolioNow, portfolioBaseline) -
    computeReturnPct(indexNow, indexBaseline)
  );
}

/**
 * Якорь сравнения с FIREIDX: rolling 1y или самая ранняя дневная свеча.
 */
export function resolveFireidxComparisonBaseline(
  dailyBars: readonly MarketPriceBar[],
  nowEpochMs: number
): FireidxComparisonBaseline | null {
  if (dailyBars.length === 0) return null;

  const nowIdx = lastBarIndexAtOrBefore(dailyBars, nowEpochMs);
  if (nowIdx < 0) return null;
  const indexNow = dailyBars[nowIdx]!.c;
  if (!Number.isFinite(indexNow) || indexNow <= 0) return null;

  const firstBar = dailyBars[0]!;
  const targetEpochMs = nowEpochMs - FIREIDX_COMPARISON_HORIZON_MS;

  let baselineIdx: number;
  let mode: FireidxComparisonMode;
  if (firstBar.t > targetEpochMs) {
    baselineIdx = 0;
    mode = 'earliest-available';
  } else {
    baselineIdx = lastBarIndexAtOrBefore(dailyBars, targetEpochMs);
    if (baselineIdx < 0) {
      baselineIdx = 0;
      mode = 'earliest-available';
    } else {
      mode = 'rolling-1y';
    }
  }

  const baselineBar = dailyBars[baselineIdx]!;
  const indexBaseline = baselineBar.c;
  if (!Number.isFinite(indexBaseline) || indexBaseline <= 0) return null;

  return {
    baselineEpochMs: baselineBar.t,
    indexBaseline,
    indexNow,
    mode,
  };
}
