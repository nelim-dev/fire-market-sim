import type { MarketChartSeriesBundle } from './chartWindows';
import {
  loadKeyRateSchedule,
  resolveKeyRatePct,
  type KeyRateSchedule,
} from './keyRateSchedule';
import type { MarketMacroSnapshot } from './macro';
import { MACRO_BRENT_SYMBOL, MACRO_USD_RUB_SYMBOL } from './macroSymbols';
import { lastBarIndexAtOrBefore } from './priceSeries';
import type { MarketPriceBar } from './priceSeries';

function closeAtOrBefore(
  bars: readonly MarketPriceBar[],
  epochMs: number
): number | null {
  const idx = lastBarIndexAtOrBefore(bars, epochMs);
  if (idx < 0) return null;
  const c = bars[idx].c;
  return Number.isFinite(c) ? c : null;
}

export function resolveMacroSnapshot(
  epochMs: number,
  chartSeries: MarketChartSeriesBundle,
  schedule: KeyRateSchedule = loadKeyRateSchedule()
): MarketMacroSnapshot {
  const brentBars = chartSeries.minute[MACRO_BRENT_SYMBOL] ?? [];
  const usdBars = chartSeries.minute[MACRO_USD_RUB_SYMBOL] ?? [];
  return {
    brentUsd: closeAtOrBefore(brentBars, epochMs),
    usdRub: closeAtOrBefore(usdBars, epochMs),
    keyRatePct: resolveKeyRatePct(epochMs, schedule),
  };
}

export function applyMacroSnapshotForEpoch(
  macroSnapshot: MarketMacroSnapshot,
  epochMs: number,
  chartSeries: MarketChartSeriesBundle,
  schedule?: KeyRateSchedule
): MarketMacroSnapshot {
  const next = resolveMacroSnapshot(epochMs, chartSeries, schedule);
  macroSnapshot.brentUsd = next.brentUsd;
  macroSnapshot.usdRub = next.usdRub;
  macroSnapshot.keyRatePct = next.keyRatePct;
  return macroSnapshot;
}
