/**
 * M3 шаг 5: селекторы каталога и стабильная сортировка по assetKind + ticker.
 * Запуск: npx tsx tests/console/m3-catalog-selectors.test.ts
 */
import { LogicManager } from '../../src/logic/managers/LogicManager';
import {
  compareInstrumentByKindThenTicker,
  sortInstrumentCatalog,
} from '../../src/logic/modules/market/catalogSort';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import {
  selectMarketCatalogSectionsOrdered,
  selectMarketInstrumentCatalog,
  selectMarketInstrumentsByAssetKind,
} from '../../src/logic/modules/market/selectors';
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

run('sortInstrumentCatalog: порядок bond < fund < index < stock, затем тикер', () => {
  const items: MarketInstrumentCatalogItem[] = [
    {
      assetKind: 'stock',
      ticker: 'ZZZ',
      symbol: 'ZZZ',
      displayName: 'Z',
      isin: 'TBD-ZZZ',
      sourceFilePath: 'tickers/ZZZ.txt',
    },
    {
      assetKind: 'index',
      ticker: 'AAA',
      symbol: 'AAA',
      displayName: 'A',
      isin: 'TBD-AAA',
      sourceFilePath: 'indexes/AAA.txt',
    },
    {
      assetKind: 'stock',
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'TBD-SBER',
      sourceFilePath: 'tickers/SBER.txt',
    },
  ];
  const sorted = sortInstrumentCatalog(items);
  const keys = sorted.map((i) => `${i.assetKind}:${i.ticker}`);
  if (keys.join('|') !== 'index:AAA|stock:SBER|stock:ZZZ') {
    throw new Error(`ожидали index:AAA|stock:SBER|stock:ZZZ, получили ${keys.join('|')}`);
  }
});

run('compareInstrumentByKindThenTicker согласован с Array.sort', () => {
  const a: MarketInstrumentCatalogItem = {
    assetKind: 'bond',
    ticker: 'X',
    symbol: 'X',
    displayName: 'X',
    isin: 'TBD-X',
    sourceFilePath: 'bonds/X.txt',
  };
  const b: MarketInstrumentCatalogItem = {
    assetKind: 'stock',
    ticker: 'A',
    symbol: 'A',
    displayName: 'A',
    isin: 'TBD-A',
    sourceFilePath: 'tickers/A.txt',
  };
  if ([a, b].sort(compareInstrumentByKindThenTicker)[0].assetKind !== 'bond') {
    throw new Error('bond должен идти перед stock');
  }
});

run('LogicManager: каталог отсортирован по виду и тикеру', () => {
  const lm = new LogicManager();
  const catalog = selectMarketInstrumentCatalog(lm.getState());
  for (let i = 1; i < catalog.length; i++) {
    const prev = catalog[i - 1];
    const cur = catalog[i];
    if (compareInstrumentByKindThenTicker(prev, cur) > 0) {
      throw new Error(
        `нарушен порядок на индексе ${i}: ${prev.assetKind}/${prev.ticker} > ${cur.assetKind}/${cur.ticker}`
      );
    }
  }
});

run('selectMarketInstrumentsByAssetKind(stock): только акции', () => {
  const lm = new LogicManager();
  const stocks = selectMarketInstrumentsByAssetKind('stock')(lm.getState());
  if (stocks.length === 0) {
    throw new Error('ожидали хотя бы одну акцию в сгенерированном каталоге');
  }
  if (!stocks.every((i) => i.assetKind === 'stock')) {
    throw new Error('в выборке stock попали не-stock');
  }
});

run('selectMarketCatalogSectionsOrdered: порядок секций stock → bond → fund → index', () => {
  const lm = new LogicManager();
  const sections = selectMarketCatalogSectionsOrdered(lm.getState());
  const kinds = sections.map((s) => s.assetKind).join(',');
  if (kinds !== 'stock,bond,fund,index') {
    throw new Error(`ожидали stock,bond,fund,index, получили ${kinds}`);
  }
});

exitCode(failures);
