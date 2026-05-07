/**
 * M3: обрезка ряда по simulationEpochMs и расчёт цены/дневного изменения.
 * Запуск: npx tsx tests/console/m3-market-quote-clip.test.ts
 */
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { lastBarIndexAtOrBefore } from '../../src/logic/modules/market/priceSeries';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import { createMarketModuleState } from '../../src/logic/modules/market/state';
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

const demoItems: MarketInstrumentCatalogItem[] = [
  {
    assetKind: 'stock',
    ticker: 'DEMO',
    symbol: 'DEMO',
    displayName: 'DEMO',
    isin: 'TBD-DEMO',
    sourceFilePath: 'tickers/DEMO.txt',
  },
];

const bars = [
  { t: 1000, o: 10, h: 10, l: 10, c: 10, v: 100 },
  { t: 2000, o: 12, h: 12, l: 12, c: 12, v: 120 },
  { t: 3000, o: 11, h: 11, l: 11, c: 11, v: 110 },
] as const;

run('lastBarIndexAtOrBefore: граница включительно', () => {
  if (lastBarIndexAtOrBefore(bars, 999) !== -1) {
    throw new Error('до первого бара');
  }
  if (lastBarIndexAtOrBefore(bars, 1000) !== 0) {
    throw new Error('ровно на первом баре');
  }
  if (lastBarIndexAtOrBefore(bars, 2500) !== 1) {
    throw new Error('между вторым и третьим');
  }
  if (lastBarIndexAtOrBefore(bars, 3000) !== 2) {
    throw new Error('на последнем баре');
  }
  if (lastBarIndexAtOrBefore(bars, 4000) !== 2) {
    throw new Error('после последнего');
  }
});

run('applyMarketQuotesForSimulationEpoch: цена и график не выходят за epoch', () => {
  const series = [...bars];
  const state = createMarketModuleState(demoItems, {
    minute: { DEMO: series },
    dailyClose: { DEMO: series },
    fiveMinute: { DEMO: series },
    thirtyMinute: { DEMO: series },
    oneHour: { DEMO: series },
    weekly: { DEMO: series },
  });
  applyMarketQuotesForSimulationEpoch(state, 2500);
  const a = state.assetsBySymbol.DEMO;
  if (a.currentPriceRub !== 12) {
    throw new Error(`цена 12, получили ${a.currentPriceRub}`);
  }
  if (a.dailyChangePct === null) {
    throw new Error('должно быть дневное изменение относительно предыдущего бара');
  }
  for (const tf of ['1d', '1w', '1m', '6m', '1y', 'all'] as const) {
    const pts = a.chartLineByTimeframe[tf];
    for (const p of pts) {
      if (p.t > 2500) {
        throw new Error(`бар в будущем tf=${tf} t=${p.t}`);
      }
    }
  }
  const p1d = a.periodChangePctByTimeframe['1d'];
  if (p1d === null || Math.abs(p1d - 20) > 1e-6) {
    throw new Error(
      `ожидали ~20% за видимый день (10→12), получили periodChangePct 1d=${p1d}`
    );
  }
});

run('1d floor: после календарного разрыва окно не схлопывается', () => {
  const longSeries = Array.from({ length: 700 }, (_, i) => {
    const t = (i + 1) * 60_000;
    const c = 100 + i * 0.1;
    return { t, o: c, h: c, l: c, c, v: 1 };
  });
  const state = createMarketModuleState(demoItems, {
    minute: { DEMO: longSeries },
    dailyClose: { DEMO: longSeries },
    fiveMinute: { DEMO: longSeries },
    thirtyMinute: { DEMO: longSeries },
    oneHour: { DEMO: longSeries },
    weekly: { DEMO: longSeries },
  });
  // Симулируем «разрыв»: текущая дата далеко, календарный диапазон даёт 0 точек.
  applyMarketQuotesForSimulationEpoch(state, 10_000_000_000);
  const pts = state.assetsBySymbol.DEMO.chartLineByTimeframe['1d'];
  if (pts.length !== 540) {
    throw new Error(`ожидали floor=540 точек, получили ${pts.length}`);
  }
});

exitCode(failures);
