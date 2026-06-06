import { LogicManager } from '../../src/logic/managers/LogicManager';
import { FIREIDX_SYMBOL } from '../../src/logic/modules/market/compositeIndex';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';

/** Акция из демо-портфеля; после update() стакан сохраняется только для selectedSymbol. */
export const TRADING_TEST_STOCK_SYMBOL = 'SBER';

/**
 * M4 console tests run outside Electron (no SQLite hydrate).
 * `MarketModule.update()` builds pseudo-orderbooks only for `fullChartLineSymbols`
 * (selected instrument in UI). Fresh LogicManager has empty books otherwise.
 */
export function bootstrapTradableStockMarket(lm: LogicManager): void {
  lm.dispatchCommand({
    type: 'uiState/select-instrument',
    symbol: TRADING_TEST_STOCK_SYMBOL,
  });
  const state = lm.getState();
  applyMarketQuotesForSimulationEpoch(state.market, state.simulationEpochMs, null, {
    excludeSymbols: [FIREIDX_SYMBOL],
    fullChartLineSymbols: [TRADING_TEST_STOCK_SYMBOL],
  });
}

export function createLogicManagerWithTradableMarket(): LogicManager {
  const lm = new LogicManager();
  bootstrapTradableStockMarket(lm);
  return lm;
}

export function pickTradableSymbolForBuy(lm: LogicManager): string {
  const state = lm.getState();
  const trySymbol = (sym: string): boolean => {
    const asset = state.market.assetsBySymbol[sym];
    return (
      !!asset &&
      asset.assetKind === 'stock' &&
      sym !== FIREIDX_SYMBOL &&
      Number.isFinite(asset.currentPriceRub) &&
      (asset.currentPriceRub ?? 0) > 0 &&
      (asset.orderBook.asks[0]?.qty ?? 0) > 0
    );
  };

  const selected = state.uiState.selectedSymbol?.toUpperCase();
  if (selected && trySymbol(selected)) {
    return selected;
  }

  const symbol = state.market.instrumentCatalog
    .filter(
      (row) =>
        row.assetKind === 'stock' &&
        row.symbol.toUpperCase() !== FIREIDX_SYMBOL
    )
    .map((row) => row.symbol.toUpperCase())
    .find((sym) => trySymbol(sym));

  if (!symbol) {
    throw new Error('не найден инструмент для покупки');
  }
  return symbol;
}

export function pickTradableSymbolForSell(lm: LogicManager): string {
  const state = lm.getState();
  const trySymbol = (sym: string): boolean => {
    const asset = state.market.assetsBySymbol[sym];
    return (
      !!asset &&
      asset.assetKind !== 'index' &&
      Number.isFinite(asset.currentPriceRub) &&
      (asset.currentPriceRub ?? 0) > 0 &&
      (asset.orderBook.bids[0]?.qty ?? 0) > 0
    );
  };

  const selected = state.uiState.selectedSymbol?.toUpperCase();
  if (selected && trySymbol(selected) && state.portfolio.positions.some(
    (p) => p.ticker.toUpperCase() === selected
  )) {
    return selected;
  }

  const symbol = state.portfolio.positions
    .map((p) => p.ticker.toUpperCase())
    .find((sym) => trySymbol(sym));

  if (!symbol) {
    throw new Error('не найден инструмент для продажи');
  }
  return symbol;
}
