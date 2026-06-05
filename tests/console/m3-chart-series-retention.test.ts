/**
 * M3: ограничение chartSeries в памяти и tail-clip без копии полного префикса.
 * Запуск: npx tsx tests/console/m3-chart-series-retention.test.ts
 */
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
import type { TradingDayRecord } from '../../src/data/domain/TradingDaySession';
import {
  CHART_SERIES_STORE_MAX_BARS,
  trimChartSeriesBundleForStorage,
  trimSortedBarsToMaxCount,
} from '../../src/logic/modules/market/chartSeriesRetention';
import {
  buildChartLineByTimeframeFromBundle,
  type MarketChartSeriesBundle,
} from '../../src/logic/modules/market/chartWindows';
import {
  CHART_DAY_1M_BAR_COUNT,
  CHART_WEEK_5M_BAR_COUNT,
} from '../../src/logic/modules/market/chartTimeframes';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { sliceTailAtOrBeforeEpoch } from '../../src/logic/modules/market/priceSeries';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import { createMarketModuleState } from '../../src/logic/modules/market/state';
import { exitCode, printResult } from './runner';

const M = 'M3-retention';
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

function barsJson(lines: readonly { t: number; c: number }[]): string {
  return JSON.stringify(lines.map((p) => ({ t: p.t, c: p.c })));
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

run('trimSortedBarsToMaxCount: 10_000 баров → cap, последний сохранён', () => {
  const bars = Array.from({ length: 10_000 }, (_, i) => ({
    t: (i + 1) * 60_000,
    o: i,
    h: i,
    l: i,
    c: i,
    v: 1,
  }));
  const cap = CHART_SERIES_STORE_MAX_BARS.minute;
  const trimmed = trimSortedBarsToMaxCount(bars, cap);
  if (trimmed.length !== cap) {
    throw new Error(`ожидали ${cap} баров, получили ${trimmed.length}`);
  }
  if (trimmed[trimmed.length - 1]?.c !== 9999) {
    throw new Error('последний бар должен сохраниться');
  }
});

run('sliceTailAtOrBeforeEpoch: не копирует весь префикс', () => {
  const bars = Array.from({ length: 700 }, (_, i) => {
    const c = 100 + i * 0.1;
    return { t: (i + 1) * 60_000, o: c, h: c, l: c, c, v: 1 };
  });
  const epochMs = 10_000_000_000;
  const tail = sliceTailAtOrBeforeEpoch(bars, epochMs, CHART_DAY_1M_BAR_COUNT);
  if (tail.length !== CHART_DAY_1M_BAR_COUNT) {
    throw new Error(`ожидали ${CHART_DAY_1M_BAR_COUNT} баров, получили ${tail.length}`);
  }
  const fullClip = bars.slice(0, bars.length);
  const oldStyle = fullClip.slice(-CHART_DAY_1M_BAR_COUNT);
  if (barsJson(tail) !== barsJson(oldStyle)) {
    throw new Error('tail-clip должен совпадать с slice(-N) на полном префиксе');
  }
});

run('trimChartSeriesBundle: parity 1d fallback без календаря', () => {
  const longSeries = Array.from({ length: 700 }, (_, i) => {
    const t = (i + 1) * 60_000;
    const c = 100 + i * 0.1;
    return { t, o: c, h: c, l: c, c, v: 1 };
  });
  const bundle: MarketChartSeriesBundle = {
    minute: { DEMO: longSeries },
    dailyClose: { DEMO: longSeries },
    fiveMinute: { DEMO: longSeries },
    thirtyMinute: { DEMO: longSeries },
    oneHour: { DEMO: longSeries },
    weekly: { DEMO: longSeries },
  };
  const epochMs = 10_000_000_000;
  const before = buildChartLineByTimeframeFromBundle('DEMO', bundle, epochMs, null);
  const trimmed = trimChartSeriesBundleForStorage(bundle);
  if ((trimmed.minute.DEMO?.length ?? 0) > CHART_SERIES_STORE_MAX_BARS.minute) {
    throw new Error('minute ряд должен быть обрезан');
  }
  const after = buildChartLineByTimeframeFromBundle('DEMO', trimmed, epochMs, null);
  for (const tf of ['1d', '1w', '1m', '6m', '1y'] as const) {
    if (barsJson(before[tf]) !== barsJson(after[tf])) {
      throw new Error(`расхождение tf=${tf} после trim storage`);
    }
  }
});

run('trimChartSeriesBundle: parity котировок на хвосте ряда', () => {
  const longSeries = Array.from({ length: 700 }, (_, i) => ({
    t: (i + 1) * 60_000,
    o: 10 + i * 0.01,
    h: 10 + i * 0.01,
    l: 10 + i * 0.01,
    c: 10 + i * 0.01,
    v: 1,
  }));
  const epochMs = 700 * 60_000;
  const full = createMarketModuleState(demoItems, {
    minute: { DEMO: longSeries },
    dailyClose: { DEMO: longSeries },
    fiveMinute: { DEMO: longSeries },
    thirtyMinute: { DEMO: longSeries },
    oneHour: { DEMO: longSeries },
    weekly: { DEMO: longSeries },
  });
  applyMarketQuotesForSimulationEpoch(full, epochMs, null);
  const trimmedBundle = trimChartSeriesBundleForStorage(full.chartSeries);
  const trimmed = createMarketModuleState(demoItems, trimmedBundle);
  applyMarketQuotesForSimulationEpoch(trimmed, epochMs, null);
  const a = full.assetsBySymbol.DEMO;
  const b = trimmed.assetsBySymbol.DEMO;
  if (a.currentPriceRub !== b.currentPriceRub) {
    throw new Error(
      `цена: до trim ${a.currentPriceRub}, после ${b.currentPriceRub}`
    );
  }
  if (a.chartLineByTimeframe['1d'].length !== b.chartLineByTimeframe['1d'].length) {
    throw new Error('длина 1d линии должна совпадать');
  }
});

const SESSION_LEN_MS = 8 * 60 * 60_000 + 50 * 60_000;

run('trimChartSeriesBundle: parity 1d с TradingCalendar', () => {
  const sessionStart = Date.UTC(2024, 5, 3, 7, 0);
  const sessionEnd = sessionStart + SESSION_LEN_MS;
  const calendar = TradingCalendar.fromRecords([
    {
      mskDateYyyymmdd: '20240603',
      sessionStartEpochMs: sessionStart,
      sessionEndEpochMs: sessionEnd,
      tickersWithData: ['DEMO'],
    } satisfies TradingDayRecord,
  ]);
  const sparseBars = Array.from({ length: 650 }, (_, i) => {
    const t = sessionStart - (650 - i) * 60_000;
    const c = 100 + i * 0.01;
    return { t, o: c, h: c, l: c, c, v: 1 };
  });
  const bundle: MarketChartSeriesBundle = {
    minute: { DEMO: sparseBars },
    dailyClose: { DEMO: [] },
    fiveMinute: { DEMO: [] },
    thirtyMinute: { DEMO: [] },
    oneHour: { DEMO: [] },
    weekly: { DEMO: [] },
  };
  const epochMs = sessionEnd - 60_000;
  const before = buildChartLineByTimeframeFromBundle(
    'DEMO',
    bundle,
    epochMs,
    calendar
  );
  const trimmed = trimChartSeriesBundleForStorage(bundle);
  const after = buildChartLineByTimeframeFromBundle(
    'DEMO',
    trimmed,
    epochMs,
    calendar
  );
  if (barsJson(before['1d']) !== barsJson(after['1d'])) {
    throw new Error('1d с календарём должен совпадать до/после trim');
  }
});

run('trimChartSeriesBundle: parity 1w (5m) с календарём на 6 сессий', () => {
  const DAY = 86_400_000;
  const sessionStart0 = Date.UTC(2024, 5, 3, 7, 0);
  const records: TradingDayRecord[] = Array.from({ length: 6 }, (_, i) => ({
    mskDateYyyymmdd: `2024060${3 + i}`,
    sessionStartEpochMs: sessionStart0 + i * DAY,
    sessionEndEpochMs: sessionStart0 + i * DAY + SESSION_LEN_MS,
    tickersWithData: ['DEMO'],
  }));
  const calendar = TradingCalendar.fromRecords(records);
  const lastSession = calendar.getDay(5)!;
  const epochMs = lastSession.sessionEndEpochMs - 5 * 60_000;
  const fiveMinStep = 5 * 60_000;
  const barCount =
    CHART_WEEK_5M_BAR_COUNT + Math.ceil(CHART_DAY_1M_BAR_COUNT / 5) + 80;
  const fiveSeries = Array.from({ length: barCount }, (_, i) => {
    const t = epochMs - (barCount - 1 - i) * fiveMinStep;
    const c = 100;
    return { t, o: c, h: c, l: c, c, v: 10 };
  });
  const bundle: MarketChartSeriesBundle = {
    minute: { DEMO: [] },
    dailyClose: { DEMO: [] },
    fiveMinute: { DEMO: fiveSeries },
    thirtyMinute: { DEMO: [] },
    oneHour: { DEMO: [] },
    weekly: { DEMO: [] },
  };
  const before = buildChartLineByTimeframeFromBundle(
    'DEMO',
    bundle,
    epochMs,
    calendar
  );
  const trimmed = trimChartSeriesBundleForStorage(bundle);
  const after = buildChartLineByTimeframeFromBundle(
    'DEMO',
    trimmed,
    epochMs,
    calendar
  );
  if (before['1w'].length !== CHART_WEEK_5M_BAR_COUNT) {
    throw new Error(
      `1w до trim: ожидали ${CHART_WEEK_5M_BAR_COUNT} точек, получили ${before['1w'].length}`
    );
  }
  if (after['1w'].length !== before['1w'].length) {
    throw new Error(
      `1w после trim: длина ${after['1w'].length}, до trim ${before['1w'].length}`
    );
  }
  if (barsJson(before['1w']) !== barsJson(after['1w'])) {
    throw new Error('1w линия должна совпадать до/после trim storage');
  }
});

exitCode(failures);
