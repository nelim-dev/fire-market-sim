import type { MarketModuleState } from './state';
import { CHART_TIMEFRAME_IDS } from './chartTimeframes';
import { buildChartLineByTimeframeFromBundle } from './chartWindows';
import {
  computePeriodReturnPct,
  computePriceAndDailyChange,
  lastBarIndexAtOrBefore,
} from './priceSeries';

/** Обновляет цену, дневное изменение и срезы графика по всем инструментам. */
export function applyMarketQuotesForSimulationEpoch(
  market: MarketModuleState,
  simulationEpochMs: number
): void {
  for (const item of market.instrumentCatalog) {
    const sym = item.symbol.toUpperCase();
    const daily = market.chartSeries.dailyClose[sym] ?? [];
    const asset = market.assetsBySymbol[sym];
    if (!asset) {
      continue;
    }
    const lastIdx = lastBarIndexAtOrBefore(daily, simulationEpochMs);
    const { currentPriceRub, dailyChangePct } = computePriceAndDailyChange(
      daily,
      lastIdx
    );
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
    if (
      !chartChanged &&
      !periodChanged &&
      asset.currentPriceRub === currentPriceRub &&
      asset.dailyChangePct === dailyChangePct
    ) {
      continue;
    }
    market.assetsBySymbol[sym] = {
      ...asset,
      currentPriceRub,
      dailyChangePct,
      chartLineByTimeframe: lines,
      periodChangePctByTimeframe: nextPeriod,
    };
  }
}
