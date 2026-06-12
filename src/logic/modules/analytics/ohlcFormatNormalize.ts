import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';
import {
  ANALYTICS_MACRO_TICKERS,
  ANALYTICS_OHLC_KOPECK_SCALE_SYMBOLS,
} from './modelConstants';

const INTEGER_EPS = 1e-4;

/** EU in npz uses integer 69934=70.434 rub scale — do not ÷100. BR matches npz as-is. */
const NEVER_SCALE = new Set<string>([...ANALYTICS_MACRO_TICKERS]);

function isIntegerLike(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - Math.round(value)) <= INTEGER_EPS;
}

/** Session uses integer OHLC only (no kopeck decimals in fractional part). */
export function minutesUseIntegerOhlcOnly(minutes: readonly MarketPriceBar[]): boolean {
  if (minutes.length === 0) {
    return false;
  }
  for (const row of minutes) {
    for (const v of [row.o, row.h, row.l, row.c]) {
      if (!Number.isFinite(v)) {
        continue;
      }
      if (!isIntegerLike(v)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * ÷100 when .txt stores rub+kopecks as integer without decimal point.
 * EU: npz already uses 70455-style integers — never scale.
 * VTBR: all integer-only session bars → ÷100 (4652 → 46.52, 8704 → 87.04).
 */
export function resolveAnalyticsOhlcScale(
  symbol: string,
  minutes: readonly MarketPriceBar[]
): number {
  const sym = symbol.toUpperCase();
  if (NEVER_SCALE.has(sym)) {
    return 1;
  }
  if (!minutesUseIntegerOhlcOnly(minutes)) {
    return 1;
  }
  if (
    !ANALYTICS_OHLC_KOPECK_SCALE_SYMBOLS.includes(
      sym as (typeof ANALYTICS_OHLC_KOPECK_SCALE_SYMBOLS)[number]
    )
  ) {
    return 1;
  }
  return 100;
}

export function normalizeAnalyticsOhlcPrice(price: number, scale: number): number {
  if (!Number.isFinite(price) || scale === 1) {
    return Number.isFinite(price) ? price : 0;
  }
  return price / scale;
}

export function normalizeAnalyticsMinuteBar(
  bar: MarketPriceBar,
  scale: number
): MarketPriceBar {
  if (scale === 1) {
    return bar;
  }
  return {
    ...bar,
    o: normalizeAnalyticsOhlcPrice(bar.o, scale),
    h: normalizeAnalyticsOhlcPrice(bar.h, scale),
    l: normalizeAnalyticsOhlcPrice(bar.l, scale),
    c: normalizeAnalyticsOhlcPrice(bar.c, scale),
  };
}

export function normalizeAnalyticsMinuteBars(
  symbol: string,
  minutes: readonly MarketPriceBar[]
): MarketPriceBar[] {
  const scale = resolveAnalyticsOhlcScale(symbol, minutes);
  if (scale === 1) {
    return minutes.map((b) => ({ ...b }));
  }
  return minutes.map((b) => normalizeAnalyticsMinuteBar(b, scale));
}

/** Seed close from SQLite — scale when day minutes imply kopeck integer format. */
export function normalizeAnalyticsSeedClose(
  symbol: string,
  close: number,
  minutesForDay: readonly MarketPriceBar[] = []
): number {
  if (minutesForDay.length > 0) {
    return normalizeAnalyticsOhlcPrice(close, resolveAnalyticsOhlcScale(symbol, minutesForDay));
  }
  const sym = symbol.toUpperCase();
  if (
    NEVER_SCALE.has(sym) ||
    !isIntegerLike(close) ||
    !ANALYTICS_OHLC_KOPECK_SCALE_SYMBOLS.includes(
      sym as (typeof ANALYTICS_OHLC_KOPECK_SCALE_SYMBOLS)[number]
    )
  ) {
    return close;
  }
  return close / 100;
}
