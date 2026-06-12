import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';

export type PredictedCloseRange = {
  minClose: number;
  maxClose: number;
};

/** Min/max close over all generated prediction bars (5m session grid). */
export function computePredictedCloseRange(
  bars: readonly MarketPriceBar[]
): PredictedCloseRange | null {
  let minClose = Infinity;
  let maxClose = -Infinity;
  for (const bar of bars) {
    const c = bar.c;
    if (!Number.isFinite(c) || c <= 0) {
      continue;
    }
    if (c < minClose) {
      minClose = c;
    }
    if (c > maxClose) {
      maxClose = c;
    }
  }
  if (!Number.isFinite(minClose) || !Number.isFinite(maxClose)) {
    return null;
  }
  return { minClose, maxClose };
}
