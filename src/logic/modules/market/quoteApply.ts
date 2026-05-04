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
    const sym = item.symbol;
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
    asset.currentPriceRub = currentPriceRub;
    asset.dailyChangePct = dailyChangePct;
    const lines = buildChartLineByTimeframeFromBundle(
      sym,
      market.chartSeries,
      simulationEpochMs
    );
    asset.chartLineByTimeframe = lines;
    for (const id of CHART_TIMEFRAME_IDS) {
      asset.periodChangePctByTimeframe[id] = computePeriodReturnPct(lines[id]);
    }
  }
}
