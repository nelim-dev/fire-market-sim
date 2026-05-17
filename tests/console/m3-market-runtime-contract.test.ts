/**
 * M3: инварианты текущего runtime-контракта рынка (manual pipeline + static macro + orderBook).
 * Запуск: npx tsx tests/console/m3-market-runtime-contract.test.ts
 */
import { LogicManager } from '../../src/logic/managers/LogicManager';
import marketInstrumentCatalogJson from '../../src/data/generated/marketInstrumentCatalog.json';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import { selectMarketInstrumentCatalog } from '../../src/logic/modules/market/selectors';
import { EMPTY_MARKET_MACRO_SNAPSHOT } from '../../src/logic/modules/market/macro';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { MACRO_BRENT_SYMBOL } from '../../src/logic/modules/market/macroSymbols';
import { exitCode, printResult } from './runner';

const M = 'M3';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

run('catalog-source: MarketModule использует generated marketInstrumentCatalog.json', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const runtimeCatalog = selectMarketInstrumentCatalog(state);
  const generated = (
    marketInstrumentCatalogJson as { items?: MarketInstrumentCatalogItem[] }
  ).items ?? [];
  if (runtimeCatalog.length !== generated.length) {
    throw new Error(
      `размер каталога runtime=${runtimeCatalog.length}, generated=${generated.length}`
    );
  }
  const runtimeSymbols = new Set(runtimeCatalog.map((i) => i.symbol.toUpperCase()));
  for (const item of generated) {
    if (!runtimeSymbols.has(item.symbol.toUpperCase())) {
      throw new Error(`в runtime-каталоге нет инструмента из generated json: ${item.symbol}`);
    }
  }
});

run('macro-empty: без баров macroSnapshot остаётся null', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  applyMarketQuotesForSimulationEpoch(state.market, state.simulationEpochMs + 60_000);
  const macro = state.market.macroSnapshot;
  if (
    macro.brentUsd !== EMPTY_MARKET_MACRO_SNAPSHOT.brentUsd ||
    macro.usdRub !== EMPTY_MARKET_MACRO_SNAPSHOT.usdRub
  ) {
    throw new Error('без данных brent/usd должны оставаться null');
  }
});

run('macro-dynamic: при барах BR macroSnapshot.brentUsd обновляется', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const epoch = state.simulationEpochMs;
  state.market.chartSeries.minute[MACRO_BRENT_SYMBOL] = [
    { t: epoch - 60_000, o: 50, h: 51, l: 49, c: 50, v: 1 },
    { t: epoch, o: 51, h: 52, l: 50, c: 51.5, v: 1 },
  ];
  applyMarketQuotesForSimulationEpoch(state.market, epoch);
  if (state.market.macroSnapshot.brentUsd !== 51.5) {
    throw new Error(
      `ожидали brentUsd=51.5, получили ${state.market.macroSnapshot.brentUsd}`
    );
  }
});

run('orderBook-placeholder: у каждого актива есть bids/asks массивы', () => {
  const lm = new LogicManager();
  const assets = Object.values(lm.getState().market.assetsBySymbol);
  if (assets.length === 0) {
    throw new Error('ожидали хотя бы один актив в market.assetsBySymbol');
  }
  for (const asset of assets) {
    if (!Array.isArray(asset.orderBook.bids) || !Array.isArray(asset.orderBook.asks)) {
      throw new Error(`orderBook некорректен для ${asset.symbol}`);
    }
  }
});

exitCode(failures);

