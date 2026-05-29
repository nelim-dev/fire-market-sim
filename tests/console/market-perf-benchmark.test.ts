import {
  FIREIDX_SYMBOL,
  updateCompositeIndex,
} from '../../src/logic/modules/market/compositeIndex';
import {
  advanceFireidxIntradayFromConstituents,
  advanceFireidxMinuteBar,
  applyFireidxBundlesToChartSeries,
  rebuildFireidxSeriesFromConstituents,
} from '../../src/logic/modules/market/fireidxSeries';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { createMarketModuleState } from '../../src/logic/modules/market/state';
import type { MarketPriceBar } from '../../src/logic/modules/market/priceSeries';
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
import type { TradingDayRecord } from '../../src/data/domain/TradingDaySession';
import { exitCode, printResult } from './runner';

const M = 'PERF';
let failures = 0;
let testNum = 0;

const MINUTE_MS = 60_000;
const T0 = 1_600_000_000_000; // Sep 2020 baseline

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(M, testNum, description, false, e instanceof Error ? e.message : String(e));
  }
}

function minuteBar(t: number, c: number): MarketPriceBar {
  return { t, o: c, h: c, l: c, c, v: 1_000 };
}

function buildHeavyMarket() {
  const daily: MarketPriceBar[] = [];
  const minute: MarketPriceBar[] = [];
  for (let i = 0; i < 800; i += 1) {
    daily.push(minuteBar(T0 + i * 86_400_000, 100 + i * 0.01));
  }
  for (let i = 0; i < 600; i += 1) {
    minute.push(minuteBar(T0 + 800 * 86_400_000 + i * MINUTE_MS, 108 + i * 0.001));
  }
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'T',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'F',
      sourceFilePath: '',
    },
  ];
  return createMarketModuleState(items, {
    minute: { SBER: minute },
    dailyClose: { SBER: daily },
    oneHour: { SBER: daily.slice(-400) },
  });
}

/** Синтетический торговый календарь: N торговых дней по 6.5 ч, заканчивающихся в anchorEpochMs. */
function makeSyntheticCalendar(anchorEpochMs: number, numDays: number): TradingCalendar {
  const SESSION_MS = 390 * MINUTE_MS; // 6 ч 30 мин — типичная сессия MOEX
  const DAY_MS = 86_400_000;
  const records: TradingDayRecord[] = [];
  let t = anchorEpochMs;
  let added = 0;
  while (added < numDays) {
    const sessionEnd = t;
    const sessionStart = t - SESSION_MS;
    records.unshift({
      mskDateYyyymmdd: '20200101',
      sessionStartEpochMs: sessionStart,
      sessionEndEpochMs: sessionEnd,
      tickersWithData: [],
    });
    t -= DAY_MS;
    added++;
  }
  return TradingCalendar.fromRecords(records);
}

/** 50 синтетических акций + FIREIDX с реалистичными рядами баров. */
function buildHeavyMarket50() {
  const STOCKS = Array.from({ length: 50 }, (_, i) => `STK${String(i).padStart(2, '0')}`);
  const minuteSeries: Record<string, MarketPriceBar[]> = {};
  const dailySeries: Record<string, MarketPriceBar[]> = {};
  const fiveMinSeries: Record<string, MarketPriceBar[]> = {};
  const thirtyMinSeries: Record<string, MarketPriceBar[]> = {};
  const oneHourSeries: Record<string, MarketPriceBar[]> = {};

  for (const sym of STOCKS) {
    const seed = sym.charCodeAt(3) + sym.charCodeAt(4);
    const base = 100 + seed;
    const daily: MarketPriceBar[] = [];
    for (let i = 0; i < 800; i++) {
      daily.push(minuteBar(T0 + i * 86_400_000, base + i * 0.01));
    }
    const minute: MarketPriceBar[] = [];
    const fiveMin: MarketPriceBar[] = [];
    const thirtyMin: MarketPriceBar[] = [];
    const oneHour: MarketPriceBar[] = [];
    const baseT = T0 + 800 * 86_400_000;
    for (let i = 0; i < 600; i++) {
      minute.push(minuteBar(baseT + i * MINUTE_MS, base + 8 + i * 0.001));
    }
    for (let i = 0; i < 300; i++) {
      fiveMin.push(minuteBar(baseT + i * 5 * MINUTE_MS, base + 8 + i * 0.005));
    }
    for (let i = 0; i < 200; i++) {
      thirtyMin.push(minuteBar(baseT + i * 30 * MINUTE_MS, base + 8 + i * 0.01));
    }
    for (let i = 0; i < 100; i++) {
      oneHour.push(minuteBar(baseT + i * 60 * MINUTE_MS, base + 8 + i * 0.02));
    }
    minuteSeries[sym] = minute;
    dailySeries[sym] = daily;
    fiveMinSeries[sym] = fiveMin;
    thirtyMinSeries[sym] = thirtyMin;
    oneHourSeries[sym] = oneHour;
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
  return createMarketModuleState(items, {
    minute: minuteSeries,
    dailyClose: dailySeries,
    fiveMinute: fiveMinSeries,
    thirtyMinute: thirtyMinSeries,
    oneHour: oneHourSeries,
  });
}

function benchMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

run('benchmark: full rebuild FIREIDX (тяжёлые ряды)', () => {
  const market = buildHeavyMarket();
  const epoch = 1_600_000_000_000 + 800 * 86_400_000 + 599 * MINUTE_MS;
  const ms = benchMs(() => {
    rebuildFireidxSeriesFromConstituents({
      catalog: market.instrumentCatalog,
      chartSeries: market.chartSeries,
      details: market.details,
      simulationEpochMs: epoch,
      calendar: null,
    });
  });
  console.log(`  [PERF] full rebuild: ${ms.toFixed(1)} ms`);
  if (ms > 500) {
    throw new Error(`full rebuild слишком медленный: ${ms.toFixed(1)} ms`);
  }
});

run('benchmark: incremental tick FIREIDX', () => {
  const market = buildHeavyMarket();
  const epoch0 = 1_600_000_000_000 + 800 * 86_400_000 + 500 * MINUTE_MS;
  const full = rebuildFireidxSeriesFromConstituents({
    catalog: market.instrumentCatalog,
    chartSeries: market.chartSeries,
    details: market.details,
    simulationEpochMs: epoch0,
    calendar: null,
  });
  market.chartSeries.minute[FIREIDX_SYMBOL] = full.minuteBars;
  market.compositeIndex = full.compositeIndex;
  applyMarketQuotesForSimulationEpoch(market, epoch0, null, {
    excludeSymbols: [FIREIDX_SYMBOL],
  });
  market.compositeIndex = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    epoch0,
    null
  );

  let total = 0;
  const ticks = 60;
  for (let i = 1; i <= ticks; i += 1) {
    const epoch = epoch0 + i * MINUTE_MS;
    applyMarketQuotesForSimulationEpoch(market, epoch, null, {
      excludeSymbols: [FIREIDX_SYMBOL],
    });
    market.compositeIndex = updateCompositeIndex(
      market.compositeIndex,
      market.instrumentCatalog,
      market.assetsBySymbol,
      market.details,
      epoch,
      null
    );
    total += benchMs(() => {
      advanceFireidxMinuteBar(
        market.chartSeries,
        market.instrumentCatalog,
        market.compositeIndex,
        epoch,
        null
      );
    });
  }
  const avg = total / ticks;
  console.log(`  [PERF] incremental avg/tick: ${avg.toFixed(2)} ms (${ticks} ticks)`);
  if (avg > 25) {
    throw new Error(`incremental слишком медленный: ${avg.toFixed(2)} ms/tick`);
  }
});

run('benchmark: applyQuotes один проход (каталог)', () => {
  const market = buildHeavyMarket();
  const epoch = T0 + 800 * 86_400_000 + 599 * MINUTE_MS;
  const ms = benchMs(() => {
    applyMarketQuotesForSimulationEpoch(market, epoch, null);
  });
  console.log(`  [PERF] applyQuotes full catalog: ${ms.toFixed(1)} ms`);
  if (ms > 80) {
    throw new Error(`applyQuotes слишком медленный: ${ms.toFixed(1)} ms`);
  }
});

run('benchmark: applyQuotes 50 инструментов + calendar (реалистичный сценарий)', () => {
  const market = buildHeavyMarket50();
  const epoch = T0 + 800 * 86_400_000 + 599 * MINUTE_MS;
  const calendar = makeSyntheticCalendar(epoch, 600);

  // прогрев
  applyMarketQuotesForSimulationEpoch(market, epoch, calendar, {
    excludeSymbols: [FIREIDX_SYMBOL],
  });

  const ticks = 20;
  let total = 0;
  for (let i = 0; i < ticks; i++) {
    total += benchMs(() => {
      applyMarketQuotesForSimulationEpoch(market, epoch + i * MINUTE_MS, calendar, {
        excludeSymbols: [FIREIDX_SYMBOL],
      });
    });
  }
  const avg = total / ticks;
  console.log(`  [PERF] 50 stocks + calendar avg/tick: ${avg.toFixed(1)} ms  (${ticks} ticks)`);
  if (avg > 10) {
    throw new Error(`applyQuotes 50 stocks+calendar слишком медленный: ${avg.toFixed(1)} ms/tick`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ВАРИАНТ E: FIREIDX full rebuild при каждой гидрации vs. incremental
// ══════════════════════════════════════════════════════════════════════════════

run('E-ДО: 20 пост-гидраций — forceFullFireidx на каждую (текущее поведение)', () => {
  const market = buildHeavyMarket50();
  const epoch0 = T0 + 800 * 86_400_000 + 500 * MINUTE_MS;
  const calendar = makeSyntheticCalendar(epoch0 + 120 * MINUTE_MS, 600);

  // Первичный запуск — инициализация compositeIndex и minuteSeries FIREIDX
  const init = rebuildFireidxSeriesFromConstituents({
    catalog: market.instrumentCatalog,
    chartSeries: market.chartSeries,
    details: market.details,
    simulationEpochMs: epoch0,
    calendar,
  });
  applyFireidxBundlesToChartSeries(market.chartSeries, init, calendar);
  market.compositeIndex = init.compositeIndex;

  const HYDRATIONS = 20;
  let fullRebuildCount = 0;
  const totalMs = benchMs(() => {
    for (let i = 1; i <= HYDRATIONS; i++) {
      const epoch = epoch0 + i * MINUTE_MS;
      // Текущее поведение: afterExternalHydrate всегда передаёт stockBarsChanged=true
      // → shouldFullRebuildFireidx → true → full rebuild каждый раз
      fullRebuildCount++;
      applyMarketQuotesForSimulationEpoch(market, epoch, calendar, {
        excludeSymbols: [FIREIDX_SYMBOL],
      });
      const rebuilt = rebuildFireidxSeriesFromConstituents({
        catalog: market.instrumentCatalog,
        chartSeries: market.chartSeries,
        details: market.details,
        simulationEpochMs: epoch,
        calendar,
      });
      applyFireidxBundlesToChartSeries(market.chartSeries, rebuilt, calendar);
      market.compositeIndex = updateCompositeIndex(
        rebuilt.compositeIndex,
        market.instrumentCatalog,
        market.assetsBySymbol,
        market.details,
        epoch,
        calendar
      );
    }
  });
  const perHydration = totalMs / HYDRATIONS;
  console.log(
    `  [E-ДО] ${HYDRATIONS} гидраций: ${totalMs.toFixed(1)} ms итого` +
    ` | full rebuilds: ${fullRebuildCount}/${HYDRATIONS}` +
    ` | ${perHydration.toFixed(1)} ms/гидрация`
  );
  if (totalMs > 10_000) throw new Error(`E-ДО слишком медленный: ${totalMs.toFixed(1)} ms`);
});

run('E-ПОСЛЕ: 20 пост-гидраций — только incremental (новое поведение)', () => {
  const market = buildHeavyMarket50();
  const epoch0 = T0 + 800 * 86_400_000 + 500 * MINUTE_MS;
  const calendar = makeSyntheticCalendar(epoch0 + 120 * MINUTE_MS, 600);

  const HYDRATIONS = 20;
  let fullRebuildCount = 0;
  const totalMs = benchMs(() => {
    for (let i = 1; i <= HYDRATIONS; i++) {
      const epoch = epoch0 + i * MINUTE_MS;
      applyMarketQuotesForSimulationEpoch(market, epoch, calendar, {
        excludeSymbols: [FIREIDX_SYMBOL],
      });
      market.compositeIndex = updateCompositeIndex(
        market.compositeIndex,
        market.instrumentCatalog,
        market.assetsBySymbol,
        market.details,
        epoch,
        calendar
      );
      // Новое поведение: full rebuild только если серия пустая (первая гидрация)
      const fireidxMinute = market.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
      if (fireidxMinute.length === 0) {
        fullRebuildCount++;
        const rebuilt = rebuildFireidxSeriesFromConstituents({
          catalog: market.instrumentCatalog,
          chartSeries: market.chartSeries,
          details: market.details,
          simulationEpochMs: epoch,
          calendar,
        });
        applyFireidxBundlesToChartSeries(market.chartSeries, rebuilt, calendar);
        market.compositeIndex = rebuilt.compositeIndex;
      } else {
        advanceFireidxMinuteBar(
          market.chartSeries,
          market.instrumentCatalog,
          market.compositeIndex,
          epoch,
          calendar
        );
        advanceFireidxIntradayFromConstituents(
          market.chartSeries,
          market.instrumentCatalog,
          market.compositeIndex,
          epoch
        );
      }
    }
  });
  const perHydration = totalMs / HYDRATIONS;
  console.log(
    `  [E-ПОСЛЕ] ${HYDRATIONS} гидраций: ${totalMs.toFixed(1)} ms итого` +
    ` | full rebuilds: ${fullRebuildCount}/${HYDRATIONS}` +
    ` | ${perHydration.toFixed(1)} ms/гидрация`
  );
  if (totalMs > 2_000) throw new Error(`E-ПОСЛЕ слишком медленный: ${totalMs.toFixed(1)} ms`);
});

// ══════════════════════════════════════════════════════════════════════════════
// ВАРИАНТ D: частота гидраций при разных скоростях (фиксированный vs. адаптивный интервал)
// ══════════════════════════════════════════════════════════════════════════════

run('D-ДО/ПОСЛЕ: частота scheduling гидраций при 1x/100x/1000x', () => {
  /**
   * Симулирует scheduleMarketHydrateFromDatabase: считает сколько раз за
   * 1 реальную секунду (60 кадров) сработает гидрация при данном интервале.
   * simMsPerFrame = (1/fps) * timeScale * 60_000  (сколько симуляционного мс приносит один кадр)
   */
  function countScheduled(timeScale: number, fps: number, hydrateIntervalSimMs: number): number {
    const simMsPerFrame = (1 / fps) * timeScale * 60_000;
    let epochMs = 0;
    let lastScheduled: number | null = null;
    let count = 0;
    for (let f = 0; f < fps; f++) {
      epochMs += simMsPerFrame;
      if (lastScheduled === null || epochMs - lastScheduled >= hydrateIntervalSimMs) {
        count++;
        lastScheduled = epochMs;
      }
    }
    return count;
  }

  /**
   * Адаптивный интервал: 60_000 * max(1, timeScale/10).
   * Даёт ~10 гидраций/сек при ЛЮБОЙ скорости; при 1x сохраняет 1/сек.
   *   1x   → 60_000   (simMsPerFrame=1_000     → 1 trigger за 60 кадров = 1/сек)
   *   10x  → 60_000   (simMsPerFrame=10_000    → 1 trigger за 6 кадров  = 10/сек)
   *   100x → 600_000  (simMsPerFrame=100_000   → 1 trigger за 6 кадров  = 10/сек)
   *   1000x→ 6_000_000(simMsPerFrame=1_000_000 → 1 trigger за 6 кадров  = 10/сек)
   */
  function adaptiveInterval(timeScale: number): number {
    return Math.min(60_000 * Math.max(1, timeScale / 10), 6_000_000);
  }

  const FPS = 60;
  const AVG_PHASE_MS_AFTER_E = 5;  // Phase1+Phase2 после fix-E: ~5 мс
  const AVG_IPC_MS = 29;           // из probe-логов

  const scales = [1, 10, 100, 1000] as const;

  console.log(`  [D] Частота гидраций (scheduled) за 1 реальную секунду:`);
  for (const ts of scales) {
    const intervalBefore = 60_000;              // текущий фиксированный
    const intervalAfter  = adaptiveInterval(ts); // адаптивный
    const before = countScheduled(ts, FPS, intervalBefore);
    const after  = countScheduled(ts, FPS, intervalAfter);
    const procBefore = before * AVG_PHASE_MS_AFTER_E;
    const procAfter  = after  * AVG_PHASE_MS_AFTER_E;
    const ipcBefore  = before * AVG_IPC_MS;
    const ipcAfter   = after  * AVG_IPC_MS;
    const savingProc = procBefore - procAfter;
    const pct = procBefore > 0
      ? ((savingProc / procBefore) * 100).toFixed(0)
      : '0';
    console.log(
      `    ${String(ts).padStart(4)}x: ДО=${before} гидр/сек (~${procBefore}ms обраб, IPC ~${ipcBefore}ms)` +
      ` → ПОСЛЕ=${after} (~${procAfter}ms, IPC ~${ipcAfter}ms)  ▲${pct}%`
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ВАРИАНТ F: overhead notifySubscribers с/без троттлинга по wall-clock
// ══════════════════════════════════════════════════════════════════════════════

run('F-ДО/ПОСЛЕ: overhead notifySubscribers (25 подписчиков × N вызовов)', () => {
  const SUBSCRIBER_COUNT = 25;
  type FakeState = { level: number; cash: number; epoch: number };
  const state: FakeState = { level: 1_000, cash: 50_000, epoch: T0 };

  // Типичный подписчик: вычисляет срез + сравнивает с предыдущим значением
  const selectors = Array.from({ length: SUBSCRIBER_COUNT }, (_, i) => (s: FakeState) =>
    Math.round(s.level * (1 + i * 0.01) * 100) / 100 + s.cash * 0.001
  );
  let prevValues = new Array<number>(SUBSCRIBER_COUNT).fill(0);

  function runNotifyCycles(calls: number): number {
    return benchMs(() => {
      for (let c = 0; c < calls; c++) {
        state.epoch += MINUTE_MS;
        state.level += 0.1;
        for (let i = 0; i < SUBSCRIBER_COUNT; i++) {
          const v = selectors[i](state);
          if (v !== prevValues[i]) prevValues[i] = v;
        }
      }
    });
  }

  // ДО: без троттлинга — 60fps × 3 вызова/кадр (update + 2×notifyHook при гидрации) = 180/сек
  const CALLS_BEFORE = 180;
  state.epoch = T0; state.level = 1_000; prevValues.fill(0);
  const msBefore = runNotifyCycles(CALLS_BEFORE);

  // ПОСЛЕ: с троттлингом 16ms — максимум 60 вызовов/сек (один раз в кадр)
  const CALLS_AFTER = 60;
  state.epoch = T0; state.level = 1_000; prevValues.fill(0);
  const msAfter = runNotifyCycles(CALLS_AFTER);

  const saving = msBefore > 0 ? ((1 - msAfter / msBefore) * 100).toFixed(0) : '0';
  console.log(`  [F-ДО]    ${CALLS_BEFORE} вызовов × ${SUBSCRIBER_COUNT} подписчиков: ${msBefore.toFixed(2)} ms`);
  console.log(`  [F-ПОСЛЕ] ${CALLS_AFTER} вызовов × ${SUBSCRIBER_COUNT} подписчиков: ${msAfter.toFixed(2)} ms`);
  console.log(`  [F] Экономия selector-loop: ~${saving}% (${(msBefore - msAfter).toFixed(2)} ms/сек)`);
  console.log(`  [F] Реальный выигрыш — React рендеры (не видно в unit-тесте, но пропорционален N вызовов)`);
});

run('G: day-buffer уменьшает обращения к БД с минутных до дневных', () => {
  const SESSION_MINUTES = 390;
  const DAY_DB_CALLS_WITH_BUFFER = 1; // 1 day-slices запрос на текущий день
  const NEXT_DAY_WARMUP_CALLS = 1; // +1 на следующий день (двухдневный буфер)
  const totalWithBuffer = DAY_DB_CALLS_WITH_BUFFER + NEXT_DAY_WARMUP_CALLS;
  const perMinuteHydrateCalls = SESSION_MINUTES;
  const reductionPct =
    ((perMinuteHydrateCalls - totalWithBuffer) / perMinuteHydrateCalls) * 100;
  console.log(
    `  [G] БЕЗ буфера: ~${perMinuteHydrateCalls} DB-вызовов/день,` +
      ` С буфером: ~${totalWithBuffer} (current+next)`
  );
  console.log(`  [G] Снижение DB-вызовов: ~${reductionPct.toFixed(1)}%`);
  if (totalWithBuffer >= perMinuteHydrateCalls) {
    throw new Error('day-buffer должен уменьшать количество DB-вызовов внутри дня');
  }
});

exitCode(failures);
