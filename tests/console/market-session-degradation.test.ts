/**
 * Реалистичный профиль деградации: «ранняя сессия» vs «длинная история daily».
 * Запуск: npx tsx tests/console/market-session-degradation.test.ts
 */
import {
  FIREIDX_SYMBOL,
  updateCompositeIndex,
} from '../../src/logic/modules/market/compositeIndex';
import { advanceFireidxBatchUpToEpoch } from '../../src/logic/modules/market/fireidxSeries';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import {
  buildChartLineByTimeframeFromBundle,
  precomputeChartSlotsForEpoch,
} from '../../src/logic/modules/market/chartWindows';
import { CHART_ALL_DISPLAY_MAX } from '../../src/logic/modules/market/chartTimeframes';
import type { MarketPriceBar } from '../../src/logic/modules/market/priceSeries';
import { createMarketModuleState } from '../../src/logic/modules/market/state';
import { loadInstrumentDetailsCatalog } from '../../src/logic/modules/market/instrumentDetails';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import marketInstrumentCatalogJson from '../../src/data/generated/marketInstrumentCatalog.json';
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
import type { TradingDayRecord } from '../../src/data/domain/TradingDaySession';
import { exitCode, printResult } from './runner';

const M = 'DEG';
let failures = 0;
let testNum = 0;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const T0 = 1_580_000_000_000;

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

function minuteBar(t: number, c: number): MarketPriceBar {
  return { t, o: c, h: c, l: c, c, v: 1_000 };
}

function benchMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function makeCalendar(anchorEpochMs: number, numDays: number): TradingCalendar {
  const SESSION_MS = 390 * MINUTE_MS;
  const records: TradingDayRecord[] = [];
  let t = anchorEpochMs;
  for (let i = 0; i < numDays; i += 1) {
    records.unshift({
      mskDateYyyymmdd: `2020${String((i % 12) + 1).padStart(2, '0')}15`,
      sessionStartEpochMs: t - SESSION_MS,
      sessionEndEpochMs: t,
      tickersWithData: [],
    });
    t -= DAY_MS;
  }
  return TradingCalendar.fromRecords(records);
}

function buildProductionLikeMarket(dailyBarCount: number) {
  const STOCKS = Array.from({ length: 50 }, (_, i) => `STK${String(i).padStart(2, '0')}`);
  const selected = 'STK00';
  const minuteSeries: Record<string, MarketPriceBar[]> = {};
  const dailySeries: Record<string, MarketPriceBar[]> = {};
  const fiveMinSeries: Record<string, MarketPriceBar[]> = {};
  const thirtyMinSeries: Record<string, MarketPriceBar[]> = {};
  const oneHourSeries: Record<string, MarketPriceBar[]> = {};

  const sessionBase = T0 + dailyBarCount * DAY_MS;

  for (const sym of STOCKS) {
    const seed = sym.charCodeAt(3) + sym.charCodeAt(4);
    const base = 100 + seed;
    const daily: MarketPriceBar[] = [];
    for (let i = 0; i < dailyBarCount; i += 1) {
      daily.push(minuteBar(T0 + i * DAY_MS, base + i * 0.02));
    }
    const minute: MarketPriceBar[] = [];
    for (let i = 0; i < 530; i += 1) {
      minute.push(minuteBar(sessionBase - (530 - i) * MINUTE_MS, base + 5 + i * 0.001));
    }
    minuteSeries[sym] = minute;
    dailySeries[sym] = daily;
    fiveMinSeries[sym] = minute.filter((_, i) => i % 5 === 0);
    thirtyMinSeries[sym] = minute.filter((_, i) => i % 30 === 0);
    oneHourSeries[sym] = minute.filter((_, i) => i % 60 === 0);
  }

  const items = [
    ...STOCKS.map((sym) => ({
      assetKind: 'stock' as const,
      ticker: sym,
      symbol: sym,
      displayName: sym,
      isin: `ISIN-${sym}`,
      sourceFilePath: '',
    })),
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'F',
      sourceFilePath: '',
    },
  ];

  const market = createMarketModuleState(items, {
    minute: minuteSeries,
    dailyClose: dailySeries,
    fiveMinute: fiveMinSeries,
    thirtyMinute: thirtyMinSeries,
    oneHour: oneHourSeries,
  });
  market.compositeIndex = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    sessionBase,
    null
  );
  return { market, selected, sessionBase };
}

/** Один production-like tick (lazy catalog + FIREIDX chain). */
function simulateProductionTick(input: {
  market: ReturnType<typeof createMarketModuleState>;
  epoch: number;
  calendar: TradingCalendar;
  selected: string;
  mskDate: string;
}): { catalogMs: number; fireidxMs: number; totalMs: number } {
  const { market, epoch, calendar, selected, mskDate } = input;
  const t0 = performance.now();

  const catalogMs = benchMs(() => {
    applyMarketQuotesForSimulationEpoch(market, epoch, calendar, {
      excludeSymbols: [FIREIDX_SYMBOL],
      fullChartLineSymbols: [selected],
    });
  });

  const fireidxMs = benchMs(() => {
    const batch = advanceFireidxBatchUpToEpoch({
      chartSeries: market.chartSeries,
      catalog: market.instrumentCatalog,
      compositeIndex: market.compositeIndex,
      details: market.details,
      simulationEpochMs: epoch,
      calendar,
      runtime: market.fireidxRuntime,
      sessionMskDateYyyymmdd: mskDate,
    });
    market.compositeIndex = updateCompositeIndex(
      batch.compositeIndex,
      market.instrumentCatalog,
      market.assetsBySymbol,
      market.details,
      epoch,
      calendar
    );
  });

  return {
    catalogMs,
    fireidxMs,
    totalMs: performance.now() - t0,
  };
}

function avgTickMs(
  dailyBarCount: number,
  ticks: number
): {
  catalogMs: number;
  fireidxMs: number;
  totalMs: number;
  dailyLen: number;
  allLineLen: number;
} {
  const { market, selected, sessionBase } = buildProductionLikeMarket(dailyBarCount);
  const calendar = makeCalendar(sessionBase, Math.max(600, dailyBarCount + 50));
  const mskDate = calendar.readonlyDays[calendar.dayCount - 1]!.mskDateYyyymmdd;
  let catalog = 0;
  let fireidx = 0;
  let total = 0;
  for (let i = 0; i < ticks; i += 1) {
    const epoch = sessionBase + i * MINUTE_MS;
    const s = simulateProductionTick({
      market,
      epoch,
      calendar,
      selected,
      mskDate,
    });
    catalog += s.catalogMs;
    fireidx += s.fireidxMs;
    total += s.totalMs;
  }
  const preSlots = precomputeChartSlotsForEpoch(calendar, sessionBase);
  const lines = buildChartLineByTimeframeFromBundle(
    selected,
    market.chartSeries,
    sessionBase,
    calendar,
    preSlots
  );
  return {
    catalogMs: catalog / ticks,
    fireidxMs: fireidx / ticks,
    totalMs: total / ticks,
    dailyLen: market.chartSeries.dailyClose[selected]?.length ?? 0,
    allLineLen: lines.all.length,
  };
}

run('диагностика: `all` line capped при росте dailyClose', () => {
  const { market, selected, sessionBase } = buildProductionLikeMarket(1200);
  const calendar = makeCalendar(sessionBase, 1300);
  const preSlots = precomputeChartSlotsForEpoch(calendar, sessionBase);
  const lines = buildChartLineByTimeframeFromBundle(
    selected,
    market.chartSeries,
    sessionBase,
    calendar,
    preSlots
  );
  const dailyLen = market.chartSeries.dailyClose[selected]?.length ?? 0;
  console.log(
    `  [DEG] dailyClose=${dailyLen} → chart all points=${lines.all.length} (cap=${CHART_ALL_DISPLAY_MAX})`
  );
  if (dailyLen < 1000) {
    throw new Error('ожидали длинный dailyClose в фикстуре');
  }
  if (lines.all.length > CHART_ALL_DISPLAY_MAX) {
    throw new Error(
      `all line должна быть ≤${CHART_ALL_DISPLAY_MAX}, получили ${lines.all.length}`
    );
  }
});

run('деградация: ранняя сессия (50 daily) vs зрелая (800 daily)', () => {
  const TICKS = 30;
  const early = avgTickMs(50, TICKS);
  const mature = avgTickMs(800, TICKS);

  console.log('  [DEG] ── production-like tick (lazy 50 + FIREIDX) ──');
  console.log(
    `  [DEG] early  daily=${early.dailyLen}: catalog=${early.catalogMs.toFixed(2)}ms fireidx=${early.fireidxMs.toFixed(2)}ms total=${early.totalMs.toFixed(2)}ms allPts=${early.allLineLen}`
  );
  console.log(
    `  [DEG] mature daily=${mature.dailyLen}: catalog=${mature.catalogMs.toFixed(2)}ms fireidx=${mature.fireidxMs.toFixed(2)}ms total=${mature.totalMs.toFixed(2)}ms allPts=${mature.allLineLen}`
  );

  const totalRatio = mature.totalMs / Math.max(early.totalMs, 0.01);
  console.log(`  [DEG] total slowdown ratio mature/early: ${totalRatio.toFixed(2)}×`);

  if (mature.allLineLen > CHART_ALL_DISPLAY_MAX + 1) {
    throw new Error('all line не capped на зрелой сессии');
  }
  if (totalRatio > 4) {
    throw new Error(
      `деградация total/tick >4× (${totalRatio.toFixed(2)}×): early=${early.totalMs.toFixed(2)} mature=${mature.totalMs.toFixed(2)}`
    );
  }
});

run('изоляция: рост `all` без downsample был бы линейным (контрольный замер)', () => {
  const { market, selected, sessionBase } = buildProductionLikeMarket(1500);
  const calendar = makeCalendar(sessionBase, 1600);
  const preSlots = precomputeChartSlotsForEpoch(calendar, sessionBase);
  const ms = benchMs(() => {
    buildChartLineByTimeframeFromBundle(
      selected,
      market.chartSeries,
      sessionBase,
      calendar,
      preSlots
    );
  });
  console.log(
    `  [DEG] full 6TF build при daily=1500: ${ms.toFixed(2)} ms (all capped → ≤${CHART_ALL_DISPLAY_MAX} pts)`
  );
  if (ms > 25) {
    throw new Error(`hot chart build слишком медленный после cap: ${ms.toFixed(2)} ms`);
  }
});

run('FIREIDX chain — стабильна при росте daily (не должна доминировать)', () => {
  const early = avgTickMs(50, 20);
  const mature = avgTickMs(800, 20);
  const fireidxRatio = mature.fireidxMs / Math.max(early.fireidxMs, 0.01);
  console.log(
    `  [DEG] FIREIDX ms/tick early=${early.fireidxMs.toFixed(2)} mature=${mature.fireidxMs.toFixed(2)} ratio=${fireidxRatio.toFixed(2)}×`
  );
  if (fireidxRatio > 2.5) {
    throw new Error(
      `FIREIDX chain растёт с daily (${fireidxRatio.toFixed(2)}×) — проверьте refreshFireidxDaily`
    );
  }
});

run('реальный каталог (51 инстр., 23 облигации): lazy tick vs зрелый daily', () => {
  const items = (marketInstrumentCatalogJson as { items: MarketInstrumentCatalogItem[] })
    .items;
  const selected =
    items.find((i) => i.assetKind === 'stock')?.symbol.toUpperCase() ?? 'SBER';
  const dailyBarCount = 600;
  const sessionBase = T0 + dailyBarCount * DAY_MS;
  const minuteSeries: Record<string, MarketPriceBar[]> = {};
  const dailySeries: Record<string, MarketPriceBar[]> = {};

  for (const item of items) {
    const sym = item.symbol.toUpperCase();
    const base = 100 + sym.charCodeAt(0);
    const daily: MarketPriceBar[] = [];
    for (let i = 0; i < dailyBarCount; i += 1) {
      daily.push(minuteBar(T0 + i * DAY_MS, base + i * 0.01));
    }
    dailySeries[sym] = daily;
    const minute: MarketPriceBar[] = [];
    for (let i = 0; i < 530; i += 1) {
      minute.push(minuteBar(sessionBase - (530 - i) * MINUTE_MS, base + 3));
    }
    minuteSeries[sym] = minute;
  }

  const market = createMarketModuleState(items, {
    minute: minuteSeries,
    dailyClose: dailySeries,
  });
  market.details = loadInstrumentDetailsCatalog();
  market.compositeIndex = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    sessionBase,
    null
  );

  const calendar = makeCalendar(sessionBase, 650);
  const mskDate = calendar.readonlyDays[calendar.dayCount - 1]!.mskDateYyyymmdd;
  const TICKS = 25;
  let catalog = 0;
  let fireidx = 0;
  let total = 0;
  for (let i = 0; i < TICKS; i += 1) {
    const epoch = sessionBase + i * MINUTE_MS;
    const s = simulateProductionTick({
      market,
      epoch,
      calendar,
      selected,
      mskDate,
    });
    catalog += s.catalogMs;
    fireidx += s.fireidxMs;
    total += s.totalMs;
  }
  console.log(
    `  [DEG] REAL catalog (${items.length} items): catalog=${(catalog / TICKS).toFixed(2)}ms fireidx=${(fireidx / TICKS).toFixed(2)}ms total=${(total / TICKS).toFixed(2)}ms daily=${dailyBarCount} sel=${selected}`
  );
  if (total / TICKS > 8) {
    throw new Error(
      `real catalog tick >8ms (${(total / TICKS).toFixed(2)}ms) — регрессия perf`
    );
  }
});

run('burst: 10 ticks за rAF (как GameLoop maxStepsPerFrame=10)', () => {
  const { market, selected, sessionBase } = buildProductionLikeMarket(400);
  market.details = loadInstrumentDetailsCatalog();
  const calendar = makeCalendar(sessionBase, 500);
  const mskDate = calendar.readonlyDays[calendar.dayCount - 1]!.mskDateYyyymmdd;
  const STEPS = 10;
  const epoch0 = sessionBase;
  const frameMs = benchMs(() => {
    for (let i = 0; i < STEPS; i += 1) {
      simulateProductionTick({
        market,
        epoch: epoch0 + i * MINUTE_MS,
        calendar,
        selected,
        mskDate,
      });
    }
  });
  const perTick = frameMs / STEPS;
  console.log(
    `  [DEG] burst ${STEPS}× tick: frame=${frameMs.toFixed(1)}ms (~${perTick.toFixed(2)}ms/tick) → rAF budget 16ms`
  );
  if (frameMs > 16) {
    console.log(
      `  [DEG] ⚠ frame ${frameMs.toFixed(0)}ms > 16ms — ожидаем [Violation] rAF при catch-up`
    );
  }
  if (frameMs / STEPS > 12) {
    throw new Error(`burst per-tick слишком высокий: ${(frameMs / STEPS).toFixed(2)}ms`);
  }
});

run('burst REAL catalog: 10 ticks за rAF', () => {
  const items = (marketInstrumentCatalogJson as { items: MarketInstrumentCatalogItem[] })
    .items;
  const selected =
    items.find((i) => i.assetKind === 'stock')?.symbol.toUpperCase() ?? 'SBER';
  const dailyBarCount = 600;
  const sessionBase = T0 + dailyBarCount * DAY_MS;
  const minuteSeries: Record<string, MarketPriceBar[]> = {};
  const dailySeries: Record<string, MarketPriceBar[]> = {};
  for (const item of items) {
    const sym = item.symbol.toUpperCase();
    const base = 100 + sym.charCodeAt(0);
    const daily: MarketPriceBar[] = [];
    for (let i = 0; i < dailyBarCount; i += 1) {
      daily.push(minuteBar(T0 + i * DAY_MS, base + i * 0.01));
    }
    dailySeries[sym] = daily;
    const minute: MarketPriceBar[] = [];
    for (let i = 0; i < 530; i += 1) {
      minute.push(minuteBar(sessionBase - (530 - i) * MINUTE_MS, base + 3));
    }
    minuteSeries[sym] = minute;
  }
  const market = createMarketModuleState(items, {
    minute: minuteSeries,
    dailyClose: dailySeries,
  });
  market.details = loadInstrumentDetailsCatalog();
  market.compositeIndex = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    sessionBase,
    null
  );
  const calendar = makeCalendar(sessionBase, 650);
  const mskDate = calendar.readonlyDays[calendar.dayCount - 1]!.mskDateYyyymmdd;
  const STEPS = 10;
  const frameMs = benchMs(() => {
    for (let i = 0; i < STEPS; i += 1) {
      simulateProductionTick({
        market,
        epoch: sessionBase + i * MINUTE_MS,
        calendar,
        selected,
        mskDate,
      });
    }
  });
  console.log(
    `  [DEG] REAL burst ${STEPS}×: frame=${frameMs.toFixed(1)}ms (~${(frameMs / STEPS).toFixed(2)}ms/tick)`
  );
  if (frameMs > 50) {
    console.log(
      `  [DEG] ⚠ REAL frame ${frameMs.toFixed(0)}ms — совпадает с [Violation] rAF 50–145ms в Electron`
    );
  }
});

exitCode(failures);
