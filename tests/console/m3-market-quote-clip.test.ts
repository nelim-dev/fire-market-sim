/**
 * M3: обрезка ряда по simulationEpochMs и расчёт цены/дневного изменения.
 * Запуск: npx tsx tests/console/m3-market-quote-clip.test.ts
 */
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { lastBarIndexAtOrBefore } from '../../src/logic/modules/market/priceSeries';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import { createMarketModuleState } from '../../src/logic/modules/market/state';
import { CHART_DAY_1M_BAR_COUNT } from '../../src/logic/modules/market/chartTimeframes';
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
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

run('1d fallback (без TradingCalendar): окно = N последних 1m-баров', () => {
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
  applyMarketQuotesForSimulationEpoch(state, 10_000_000_000);
  const pts = state.assetsBySymbol.DEMO.chartLineByTimeframe['1d'];
  if (pts.length !== CHART_DAY_1M_BAR_COUNT) {
    throw new Error(
      `ожидали ${CHART_DAY_1M_BAR_COUNT} точек (fallback без calendar), получили ${pts.length}`
    );
  }
});

run(
  '1d forward-fill: редкие бары растягиваются до полной сессии (calendar-based)',
  () => {
    const DAY = 86_400_000;
    const sessionStart = Date.UTC(2024, 5, 3, 7, 0); // 10:00 МСК (UTC+3) → 07:00 UTC
    const sessionEnd = sessionStart + 8 * 60 * 60_000 + 50 * 60_000; // 530 мин = +8ч 50м
    const calendar = TradingCalendar.fromRecords([
      {
        mskDateYyyymmdd: '20240531',
        sessionStartEpochMs: sessionStart - 3 * DAY,
        sessionEndEpochMs: sessionStart - 3 * DAY + 8 * 60 * 60_000 + 50 * 60_000,
        tickersWithData: ['DEMO'],
      },
      {
        mskDateYyyymmdd: '20240603',
        sessionStartEpochMs: sessionStart,
        sessionEndEpochMs: sessionEnd,
        tickersWithData: ['DEMO'],
      },
    ]);
    // Всего 3 реальных бара за сессию (редкие сделки) + 1 за день до неё:
    const sparseBars = [
      {
        t: sessionStart - 3 * DAY + 2 * 60_000,
        o: 100,
        h: 100,
        l: 100,
        c: 100,
        v: 10,
      },
      { t: sessionStart + 5 * 60_000, o: 101, h: 101, l: 101, c: 101, v: 5 },
      { t: sessionStart + 60 * 60_000, o: 102, h: 102, l: 102, c: 102, v: 5 },
      { t: sessionEnd - 30 * 60_000, o: 103, h: 103, l: 103, c: 103, v: 5 },
    ];
    const state = createMarketModuleState(demoItems, {
      minute: { DEMO: sparseBars },
      dailyClose: { DEMO: sparseBars },
      fiveMinute: { DEMO: sparseBars },
      thirtyMinute: { DEMO: sparseBars },
      oneHour: { DEMO: sparseBars },
      weekly: { DEMO: sparseBars },
    });
    applyMarketQuotesForSimulationEpoch(state, sessionEnd, calendar);
    const pts = state.assetsBySymbol.DEMO.chartLineByTimeframe['1d'];
    if (pts.length !== CHART_DAY_1M_BAR_COUNT) {
      throw new Error(
        `1d: ожидали ${CHART_DAY_1M_BAR_COUNT} слотов forward-fill, получили ${pts.length}`
      );
    }
    // Все слоты должны попадать в текущую торговую сессию (sessionStart..sessionEnd).
    for (const p of pts) {
      if (p.t < sessionStart || p.t > sessionEnd) {
        throw new Error(
          `слот вне сессии: t=${p.t}, sessionStart=${sessionStart}, sessionEnd=${sessionEnd}`
        );
      }
    }
    // Последний слот = последний реальный бар (sessionEnd-30m, c=103).
    if (pts[pts.length - 1].c !== 103) {
      throw new Error(
        `последний слот должен быть последним реальным close=103, получили ${pts[pts.length - 1].c}`
      );
    }
    // До первого реального бара (sessionStart+5m) carry-init = 100 (из предыдущей сессии).
    if (pts[0].c !== 100) {
      throw new Error(
        `первый слот должен carry-forward'нуть close=100 из предыдущей сессии, получили ${pts[0].c}`
      );
    }
  }
);

exitCode(failures);
