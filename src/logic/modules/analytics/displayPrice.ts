import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';
import { displayPriceRubForSymbol } from '@/logic/domain/eurRubSeriesDisplay';

/** Scale OHLC for analytics charts (model tensor stays raw). */
export function analyticsChartBarsForDisplay(
  symbol: string,
  bars: readonly MarketPriceBar[]
): MarketPriceBar[] {
  const sym = symbol.toUpperCase();
  return bars.map((bar) => ({
    ...bar,
    o: displayPriceRubForSymbol(sym, bar.o),
    h: displayPriceRubForSymbol(sym, bar.h),
    l: displayPriceRubForSymbol(sym, bar.l),
    c: displayPriceRubForSymbol(sym, bar.c),
  }));
}

export function analyticsDisplayCloseRub(symbol: string, seriesClose: number): number {
  return displayPriceRubForSymbol(symbol, seriesClose);
}
