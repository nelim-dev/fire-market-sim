/**
 * Листинг / погашение: видимость в обзоре рынка и отклонение торговли.
 */
import { LogicManager } from '../../src/logic/managers/LogicManager';
import {
  isInstrumentActiveOnMarket,
  resolveFirstTradeEpochMs,
} from '../../src/logic/modules/market/instrumentLifecycle';
import { createMarketModuleState } from '../../src/logic/modules/market/state';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import { selectMarketOverviewRows } from '../../src/logic/modules/uiState/selectors';
import { exitCode, printResult } from './runner';

const M = 'M3';
let failures = 0;
let testNum = 0;

const RU000A1089K2 = 'RU000A1089K2';
/** Первая строка bonds/RU000A1089K2.txt: 2024-04-12 12:49:00 MSK */
const RU000A1089K2_FIRST_TRADE_MS = 1_712_915_340_000;
/** MATDATE из marketInstrumentDetailsCatalog */
const RU000A1089K2_MATURITY_MS = 1_791_493_200_000;

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

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

function bondCatalogItem(): MarketInstrumentCatalogItem {
  return {
    assetKind: 'bond',
    ticker: RU000A1089K2,
    symbol: RU000A1089K2,
    displayName: RU000A1089K2,
    isin: RU000A1089K2,
    sourceFilePath: 'bonds/RU000A1089K2.txt',
  };
}

function marketWithRusBondMeta() {
  const market = createMarketModuleState([bondCatalogItem()]);
  market.details.instrumentMetaBySymbol[RU000A1089K2] = {
    isBond: true,
    initialFaceValueRub: 1000,
    faceUnit: 'CNY',
    maturityEpochMs: RU000A1089K2_MATURITY_MS,
    firstTradeEpochMs: RU000A1089K2_FIRST_TRADE_MS,
    isin: RU000A1089K2,
    groupRaw: 'stock_bonds',
  };
  market.assetsBySymbol[RU000A1089K2]!.maturityEpochMs = RU000A1089K2_MATURITY_MS;
  return market;
}

run('до листинга облигация не активна на рынке', () => {
  const market = marketWithRusBondMeta();
  const beforeListing = RU000A1089K2_FIRST_TRADE_MS - 60_000;
  assert(
    !isInstrumentActiveOnMarket(market, RU000A1089K2, beforeListing),
    'до firstTradeEpochMs инструмент скрыт'
  );
});

run('после листинга и до погашения облигация активна', () => {
  const market = marketWithRusBondMeta();
  const mid = RU000A1089K2_FIRST_TRADE_MS + 86_400_000;
  assert(
    isInstrumentActiveOnMarket(market, RU000A1089K2, mid),
    'между листингом и погашением инструмент виден'
  );
});

run('на дату погашения и после — не активна', () => {
  const market = marketWithRusBondMeta();
  assert(
    !isInstrumentActiveOnMarket(market, RU000A1089K2, RU000A1089K2_MATURITY_MS),
    'на maturityEpochMs скрыта'
  );
  assert(
    !isInstrumentActiveOnMarket(
      market,
      RU000A1089K2,
      RU000A1089K2_MATURITY_MS + 86_400_000
    ),
    'после погашения скрыта'
  );
});

run('resolveFirstTradeEpochMs берёт значение из метаданных', () => {
  const market = marketWithRusBondMeta();
  assert(
    resolveFirstTradeEpochMs(RU000A1089K2, market) === RU000A1089K2_FIRST_TRADE_MS,
    'firstTrade из каталога'
  );
});

run('selectMarketOverviewRows скрывает RU000A1089K2 до листинга при старте 2020', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const hasBond = state.market.instrumentCatalog.some(
    (i) => i.symbol.toUpperCase() === RU000A1089K2
  );
  if (!hasBond) {
    return;
  }
  const meta = state.market.details.instrumentMetaBySymbol[RU000A1089K2];
  if (meta?.firstTradeEpochMs == null) {
    throw new Error(
      'запустите npm run gen:instrument-details для firstTradeEpochMs'
    );
  }
  if (state.simulationEpochMs >= meta.firstTradeEpochMs) {
    return;
  }
  lm.dispatchCommand({
    type: 'uiState/set-market-overview-filters',
    patch: {
      showAvailable: true,
      showLocked: true,
      assetKindFilter: 'all',
      searchQuery: RU000A1089K2,
    },
  });
  const { available, locked } = selectMarketOverviewRows(lm.getState());
  const rows = [...available, ...locked];
  assert(
    !rows.some((r) => r.symbol === RU000A1089K2),
    'до листинга не должен попадать в обзор'
  );
});

run('trading: INSTRUMENT_NOT_TRADING до листинга', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const meta = state.market.details.instrumentMetaBySymbol[RU000A1089K2];
  if (!meta?.firstTradeEpochMs || state.simulationEpochMs >= meta.firstTradeEpochMs) {
    return;
  }
  const asset = state.market.assetsBySymbol[RU000A1089K2];
  if (!asset || asset.assetKind !== 'bond') {
    return;
  }
  lm.dispatchCommand({
    type: 'education/unlock-symbol',
    symbol: RU000A1089K2,
  });
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol: RU000A1089K2,
    quantity: asset.lotSize,
    source: 'right-panel',
  });
  const rejection = lm.getState().trading.lastRejection;
  assert(
    rejection?.reason === 'INSTRUMENT_NOT_TRADING',
    `ожидался INSTRUMENT_NOT_TRADING, получено ${rejection?.reason}`
  );
});

process.exit(exitCode(failures));
