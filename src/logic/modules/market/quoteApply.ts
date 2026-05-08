import type { MarketModuleState } from './state';
import { CHART_TIMEFRAME_IDS } from './chartTimeframes';
import { buildChartLineByTimeframeFromBundle } from './chartWindows';
import {
  computePeriodReturnPct,
  computePriceAndDailyChange,
  lastBarIndexAtOrBefore,
} from './priceSeries';

const PSEUDO_ORDERBOOK_QTY = 1_000;

/** Обновляет цену, дневное изменение и срезы графика по всем инструментам. */
export function applyMarketQuotesForSimulationEpoch(
  market: MarketModuleState,
  simulationEpochMs: number
): void {
  for (const item of market.instrumentCatalog) {
    const sym = item.symbol.toUpperCase();
    const minute = market.chartSeries.minute[sym] ?? [];
    const daily = market.chartSeries.dailyClose[sym] ?? [];
    const asset = market.assetsBySymbol[sym];
    if (!asset) {
      continue;
    }
    const minuteLastIdx = lastBarIndexAtOrBefore(minute, simulationEpochMs);
    const minutePriceRub = minuteLastIdx >= 0 ? minute[minuteLastIdx].c : null;
    const lastIdx = lastBarIndexAtOrBefore(daily, simulationEpochMs);
    const { currentPriceRub: dailyPriceRub, dailyChangePct } = computePriceAndDailyChange(
      daily,
      lastIdx
    );
    const effectivePriceRub =
      minutePriceRub ?? dailyPriceRub ?? asset.currentPriceRub ?? 100;
    const lines = buildChartLineByTimeframeFromBundle(
      sym,
      market.chartSeries,
      simulationEpochMs
    );
    let periodChanged = false;
    const nextPeriod = { ...asset.periodChangePctByTimeframe };
    for (const id of CHART_TIMEFRAME_IDS) {
      const nextValue = computePeriodReturnPct(lines[id]);
      if (nextValue !== asset.periodChangePctByTimeframe[id]) {
        periodChanged = true;
      }
      nextPeriod[id] = nextValue;
    }
    const chartChanged = CHART_TIMEFRAME_IDS.some(
      (id) => asset.chartLineByTimeframe[id] !== lines[id]
    );
    const nextOrderBook = {
      bids: [{ priceRub: effectivePriceRub, qty: PSEUDO_ORDERBOOK_QTY }],
      asks: [{ priceRub: effectivePriceRub, qty: PSEUDO_ORDERBOOK_QTY }],
    };
    const orderBookChanged =
      asset.orderBook.bids[0]?.priceRub !== nextOrderBook.bids[0]?.priceRub ||
      asset.orderBook.bids[0]?.qty !== nextOrderBook.bids[0]?.qty ||
      asset.orderBook.asks[0]?.priceRub !== nextOrderBook.asks[0]?.priceRub ||
      asset.orderBook.asks[0]?.qty !== nextOrderBook.asks[0]?.qty;
    if (
      !chartChanged &&
      !periodChanged &&
      !orderBookChanged &&
      asset.currentPriceRub === effectivePriceRub &&
      asset.dailyChangePct === dailyChangePct
    ) {
      continue;
    }
    market.assetsBySymbol[sym] = {
      ...asset,
      currentPriceRub: effectivePriceRub,
      dailyChangePct,
      chartLineByTimeframe: lines,
      periodChangePctByTimeframe: nextPeriod,
      orderBook: nextOrderBook,
    };
  }
}
