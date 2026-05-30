import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import { trimSortedBarsToMaxCount } from './chartSeriesRetention';
import { CHART_SERIES_STORE_MAX_BARS } from './chartSeriesRetention';
import type { MarketInstrumentCatalogItem } from './contracts';
import type { MarketChartSeriesBundle } from './chartWindows';
import {
  aggregateMinuteRowsToBundles,
  INTRADAY_FIVE_MIN_MS,
  INTRADAY_THIRTY_MIN_MS,
  mergeMinuteBucketIntoAggregatedBars,
  mskYyyymmddFromEpochMs,
  sessionEndEpochForDate,
} from './minuteBarAggregation';

const HOUR_MS = 3_600_000;
import { getISOWeek, getISOWeekYear } from 'date-fns';
import {
  activeStockSymbolsAtEpoch,
  buildConstituentsFromPrices,
  COMPOSITE_INDEX_INITIAL_LEVEL,
  computeCapTotalRub,
  computeIndexLevelFromCaps,
  FIREIDX_SYMBOL,
  nextRebalanceEpochAfter,
  stockSymbolsFromCatalog,
  updateCompositeIndexFromPrices,
  type CompositeIndexState,
} from './compositeIndex';
import type { InstrumentDetailsCatalog } from './instrumentDetails';
import type { MarketPriceBar } from './priceSeries';
import type { FireidxRuntimeCache } from './state';

export const FIREIDX_MINUTE_MS = 60_000;
/** Сколько минут обрабатываем за один вызов hot-path (один проход, без 60× overhead). */
export const FIREIDX_BATCH_MAX_MINUTES = 60;

function buildSessionEndByDate(
  calendar: TradingCalendar | null
): Map<string, number> {
  const map = new Map<string, number>();
  if (!calendar) {
    return map;
  }
  for (const day of calendar.readonlyDays) {
    map.set(day.mskDateYyyymmdd, day.sessionEndEpochMs);
  }
  return map;
}

function isoWeekKey(epochMs: number): string {
  const dt = new Date(epochMs);
  return `${getISOWeekYear(dt)}-W${String(getISOWeek(dt)).padStart(2, '0')}`;
}

function buildWeeklyFromDaily(dailies: readonly MarketPriceBar[]): MarketPriceBar[] {
  if (dailies.length === 0) {
    return [];
  }
  const byWeek = new Map<string, MarketPriceBar>();
  for (const b of dailies) {
    const key = isoWeekKey(b.t);
    const prev = byWeek.get(key);
    if (!prev || b.t >= prev.t) {
      byWeek.set(key, { ...b });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.t - b.t);
}

/** O(weeks) upsert одной дневной свечи в weekly — без полного rebuild из daily. */
function upsertWeeklyBarFromDaily(
  weekly: readonly MarketPriceBar[],
  dailyBar: MarketPriceBar
): MarketPriceBar[] {
  const key = isoWeekKey(dailyBar.t);
  const idx = weekly.findIndex((b) => isoWeekKey(b.t) === key);
  if (idx >= 0) {
    const prev = weekly[idx]!;
    if (dailyBar.t < prev.t) {
      return weekly;
    }
    const next = [...weekly];
    next[idx] = { ...dailyBar };
    return next;
  }
  const next = [...weekly, { ...dailyBar }];
  next.sort((a, b) => a.t - b.t);
  return next;
}

function collectUnionTimestamps(
  symbols: readonly string[],
  barsBySymbol: Record<string, readonly MarketPriceBar[]>,
  clipEpochMs: number
): number[] {
  const set = new Set<number>();
  for (const sym of symbols) {
    for (const bar of barsBySymbol[sym] ?? []) {
      if (bar.t <= clipEpochMs) {
        set.add(bar.t);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

function forwardFillPrices(
  symbols: readonly string[],
  barsBySymbol: Record<string, readonly MarketPriceBar[]>,
  t: number,
  pointers: Record<string, number>
): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const sym of symbols) {
    const bars = barsBySymbol[sym] ?? [];
    let idx = pointers[sym] ?? -1;
    while (idx + 1 < bars.length && bars[idx + 1].t <= t) {
      idx += 1;
    }
    pointers[sym] = idx;
    if (idx >= 0) {
      const close = bars[idx].c;
      if (Number.isFinite(close) && close > 0) {
        prices[sym] = close;
      }
    }
  }
  return prices;
}

type ReplayState = {
  indexState: CompositeIndexState | null;
  capTotalAtRebalance: number;
  prevLevel: number;
};

function symbolsKey(symbols: readonly string[]): string {
  return [...symbols].sort().join('|');
}

function applyRebalance(
  state: ReplayState,
  activeSymbols: readonly string[],
  prices: Record<string, number>,
  details: InstrumentDetailsCatalog,
  t: number,
  calendar: TradingCalendar | null
): boolean {
  const bootstrap = state.indexState === null;
  const activePrices: Record<string, number> = {};
  for (const sym of activeSymbols) {
    const price = prices[sym];
    if (price != null && Number.isFinite(price) && price > 0) {
      activePrices[sym] = price;
    }
  }
  const constituents = buildConstituentsFromPrices(
    activeSymbols,
    activePrices,
    details
  );
  if (constituents.length === 0) {
    return false;
  }
  const levelBefore = bootstrap ? COMPOSITE_INDEX_INITIAL_LEVEL : state.prevLevel;
  const weightsBySymbol: Record<string, number> = {};
  const rebalanceBasePricesBySymbol: Record<string, number> = {};
  for (const c of constituents) {
    weightsBySymbol[c.symbol] = c.weightPct / 100;
    rebalanceBasePricesBySymbol[c.symbol] = c.priceRubAtRebalance;
  }
  state.capTotalAtRebalance = computeCapTotalRub(constituents, prices);
  state.indexState = {
    symbol: FIREIDX_SYMBOL,
    level: levelBefore,
    levelAtRebalance: levelBefore,
    lastRebalanceEpochMs: t,
    nextRebalanceEpochMs: nextRebalanceEpochAfter(t, calendar),
    constituents,
    weightsBySymbol,
    rebalanceBasePricesBySymbol,
  };
  state.prevLevel = levelBefore;
  return true;
}

function replayCapWeightedBars(input: {
  catalog: readonly MarketInstrumentCatalogItem[];
  symbols: readonly string[];
  barsBySymbol: Record<string, readonly MarketPriceBar[]>;
  details: InstrumentDetailsCatalog;
  simulationEpochMs: number;
  calendar: TradingCalendar | null;
}): { outputBars: MarketPriceBar[]; compositeIndex: CompositeIndexState } {
  const timestamps = collectUnionTimestamps(
    input.symbols,
    input.barsBySymbol,
    input.simulationEpochMs
  );
  const emptyIndex: CompositeIndexState = {
    symbol: FIREIDX_SYMBOL,
    level: COMPOSITE_INDEX_INITIAL_LEVEL,
    levelAtRebalance: COMPOSITE_INDEX_INITIAL_LEVEL,
    lastRebalanceEpochMs: 0,
    nextRebalanceEpochMs: 0,
    constituents: [],
    weightsBySymbol: {},
    rebalanceBasePricesBySymbol: {},
  };

  if (timestamps.length === 0 || input.symbols.length === 0) {
    return { outputBars: [], compositeIndex: emptyIndex };
  }

  const pointers: Record<string, number> = {};
  const replay: ReplayState = {
    indexState: null,
    capTotalAtRebalance: 0,
    prevLevel: COMPOSITE_INDEX_INITIAL_LEVEL,
  };
  const outputBars: MarketPriceBar[] = [];

  for (const t of timestamps) {
    const prices = forwardFillPrices(
      input.symbols,
      input.barsBySymbol,
      t,
      pointers
    );
    if (Object.keys(prices).length === 0) {
      continue;
    }

    const activeAtT = activeStockSymbolsAtEpoch(
      input.catalog,
      input.details,
      t
    );
    const compositionChanged =
      replay.indexState !== null &&
      symbolsKey(replay.indexState.constituents.map((c) => c.symbol)) !==
        symbolsKey(activeAtT);
    const needsRebalance =
      replay.indexState === null ||
      (replay.indexState.nextRebalanceEpochMs > 0 &&
        t >= replay.indexState.nextRebalanceEpochMs) ||
      compositionChanged;

    if (needsRebalance) {
      if (
        !applyRebalance(
          replay,
          activeAtT,
          prices,
          input.details,
          t,
          input.calendar
        )
      ) {
        continue;
      }
    }

    if (!replay.indexState) {
      continue;
    }

    const capTotal = computeCapTotalRub(replay.indexState.constituents, prices);
    const level = computeIndexLevelFromCaps(
      replay.indexState.levelAtRebalance,
      capTotal,
      replay.capTotalAtRebalance
    );
    replay.prevLevel = level;
    replay.indexState = { ...replay.indexState, level };

    const last = outputBars.length > 0 ? outputBars[outputBars.length - 1] : null;
    const o = last?.c ?? level;
    outputBars.push({
      t,
      o,
      h: Math.max(o, level),
      l: Math.min(o, level),
      c: level,
      v: 1,
    });
  }

  if (!replay.indexState) {
    return { outputBars: [], compositeIndex: emptyIndex };
  }

  return { outputBars, compositeIndex: replay.indexState };
}

function hasExactBarAt(
  bars: readonly MarketPriceBar[],
  epochMs: number
): boolean {
  if (bars.length === 0) {
    return false;
  }
  const last = bars[bars.length - 1]!;
  if (last.t === epochMs) {
    return true;
  }
  if (last.t < epochMs) {
    return false;
  }
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = bars[mid]!.t;
    if (t === epochMs) {
      return true;
    }
    if (t < epochMs) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return false;
}

function mergeBarsPreferOverlay(
  base: readonly MarketPriceBar[],
  overlay: readonly MarketPriceBar[]
): MarketPriceBar[] {
  const byT = new Map<number, MarketPriceBar>();
  for (const bar of base) {
    byT.set(bar.t, bar);
  }
  for (const bar of overlay) {
    byT.set(bar.t, bar);
  }
  return [...byT.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, bar]) => bar);
}

export function compositeLevelAtEpochFromBars(
  index: CompositeIndexState,
  symbols: readonly string[],
  barsBySymbol: Record<string, readonly MarketPriceBar[]>,
  epochMs: number
): number | null {
  if (index.constituents.length === 0) {
    return null;
  }
  const pointers: Record<string, number> = {};
  const prices = forwardFillPrices(symbols, barsBySymbol, epochMs, pointers);
  if (Object.keys(prices).length === 0) {
    return null;
  }
  const capTotal = computeCapTotalRub(index.constituents, prices);
  const capAtRebalance = computeCapTotalRub(
    index.constituents,
    index.rebalanceBasePricesBySymbol
  );
  return computeIndexLevelFromCaps(
    index.levelAtRebalance,
    capTotal,
    capAtRebalance
  );
}

export function stocksHaveExactMinuteAtEpoch(
  catalog: readonly MarketInstrumentCatalogItem[],
  chartSeries: MarketChartSeriesBundle,
  simulationEpochMs: number
): boolean {
  for (const sym of stockSymbolsFromCatalog(catalog)) {
    const minute = chartSeries.minute[sym] ?? [];
    if (!hasExactBarAt(minute, simulationEpochMs)) {
      return false;
    }
  }
  return stockSymbolsFromCatalog(catalog).length > 0;
}

/**
 * Хотя бы одна акция каталога имеет бар точно в `simulationEpochMs`.
 * Используется как gate для incremental-обновления FIREIDX:
 * добавляем бар только когда есть реальные новые данные рынка, а не
 * только forward-fill (что порождало «забегание вперёд» на графике).
 */
export function anyStockHasExactMinuteAtEpoch(
  catalog: readonly MarketInstrumentCatalogItem[],
  chartSeries: MarketChartSeriesBundle,
  simulationEpochMs: number
): boolean {
  for (const sym of stockSymbolsFromCatalog(catalog)) {
    const minute = chartSeries.minute[sym] ?? [];
    if (hasExactBarAt(minute, simulationEpochMs)) {
      return true;
    }
  }
  return false;
}

export type RebuildFireidxResult = {
  minuteBars: MarketPriceBar[];
  dailyBars: MarketPriceBar[];
  hourlyBars: MarketPriceBar[];
  fiveMinuteBars: MarketPriceBar[];
  thirtyMinuteBars: MarketPriceBar[];
  compositeIndex: CompositeIndexState;
};

/**
 * Строит синтетическую историю FIREIDX:
 * - daily/weekly/1y/all — из дневных закрытий акций (полная история БД);
 * - 6m — из часовых рядов акций;
 * - 1d/1w/1m — из минутных рядов (окно intraday).
 */
export function rebuildFireidxSeriesFromConstituents(input: {
  catalog: readonly MarketInstrumentCatalogItem[];
  chartSeries: MarketChartSeriesBundle;
  details: InstrumentDetailsCatalog;
  simulationEpochMs: number;
  calendar: TradingCalendar | null;
}): RebuildFireidxResult {
  // Для истории используем все акции каталога: replayCapWeightedBars естественно
  // включает только те, у которых есть бары на момент t (forwardFillPrices не добавит цену
  // при отсутствии баров). activeStockSymbolsAtEpoch применяется только к live-составу.
  const symbols = stockSymbolsFromCatalog(input.catalog);

  const dailyBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  const hourlyBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  const minuteBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  const fiveMinBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  const thirtyMinBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  for (const sym of symbols) {
    dailyBySymbol[sym] = input.chartSeries.dailyClose[sym] ?? [];
    hourlyBySymbol[sym] = input.chartSeries.oneHour[sym] ?? [];
    minuteBySymbol[sym] = input.chartSeries.minute[sym] ?? [];
    fiveMinBySymbol[sym] = input.chartSeries.fiveMinute[sym] ?? [];
    thirtyMinBySymbol[sym] = input.chartSeries.thirtyMinute[sym] ?? [];
  }

  const replayInput = {
    catalog: input.catalog,
    symbols,
    details: input.details,
    simulationEpochMs: input.simulationEpochMs,
    calendar: input.calendar,
  };

  const dailyReplay = replayCapWeightedBars({
    ...replayInput,
    barsBySymbol: dailyBySymbol,
  });

  const hourlyReplay = replayCapWeightedBars({
    ...replayInput,
    barsBySymbol: hourlyBySymbol,
  });

  const minuteReplay = replayCapWeightedBars({
    ...replayInput,
    barsBySymbol: minuteBySymbol,
  });

  const fiveMinuteReplay = replayCapWeightedBars({
    ...replayInput,
    barsBySymbol: fiveMinBySymbol,
  });

  const thirtyMinuteReplay = replayCapWeightedBars({
    ...replayInput,
    barsBySymbol: thirtyMinBySymbol,
  });

  const compositeIndex =
    minuteReplay.compositeIndex.constituents.length > 0
      ? minuteReplay.compositeIndex
      : hourlyReplay.compositeIndex.constituents.length > 0
        ? hourlyReplay.compositeIndex
        : dailyReplay.compositeIndex;

  return {
    minuteBars: minuteReplay.outputBars,
    dailyBars: dailyReplay.outputBars,
    hourlyBars: hourlyReplay.outputBars,
    fiveMinuteBars: fiveMinuteReplay.outputBars,
    thirtyMinuteBars: thirtyMinuteReplay.outputBars,
    compositeIndex,
  };
}

/** Дневной/часовой FIREIDX из дневных и часовых рядов акций (история для 6m/1y/all). */
export function rebuildFireidxLongSeriesFromConstituents(input: {
  catalog: readonly MarketInstrumentCatalogItem[];
  chartSeries: MarketChartSeriesBundle;
  details: InstrumentDetailsCatalog;
  simulationEpochMs: number;
  calendar: TradingCalendar | null;
}): { dailyBars: MarketPriceBar[]; hourlyBars: MarketPriceBar[] } {
  const symbols = stockSymbolsFromCatalog(input.catalog);
  const dailyBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  const hourlyBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  for (const sym of symbols) {
    dailyBySymbol[sym] = input.chartSeries.dailyClose[sym] ?? [];
    hourlyBySymbol[sym] = input.chartSeries.oneHour[sym] ?? [];
  }
  const replayInput = {
    catalog: input.catalog,
    symbols,
    details: input.details,
    simulationEpochMs: input.simulationEpochMs,
    calendar: input.calendar,
  };
  const dailyReplay = replayCapWeightedBars({
    ...replayInput,
    barsBySymbol: dailyBySymbol,
  });
  const hourlyReplay = replayCapWeightedBars({
    ...replayInput,
    barsBySymbol: hourlyBySymbol,
  });
  return {
    dailyBars: dailyReplay.outputBars,
    hourlyBars: hourlyReplay.outputBars,
  };
}

export function needsFireidxLongSeriesBootstrap(
  chartSeries: MarketChartSeriesBundle,
  catalog: readonly MarketInstrumentCatalogItem[],
  runtime: { longSeriesBootstrapped: boolean }
): boolean {
  if (runtime.longSeriesBootstrapped) {
    return false;
  }
  const sym = FIREIDX_SYMBOL;
  const fireDailyLen = chartSeries.dailyClose[sym]?.length ?? 0;
  const fireHourlyLen = chartSeries.oneHour[sym]?.length ?? 0;
  let maxStockDaily = 0;
  let maxStockHourly = 0;
  for (const row of catalog) {
    if (row.assetKind !== 'stock') {
      continue;
    }
    const s = row.symbol.toUpperCase();
    maxStockDaily = Math.max(
      maxStockDaily,
      chartSeries.dailyClose[s]?.length ?? 0
    );
    maxStockHourly = Math.max(
      maxStockHourly,
      chartSeries.oneHour[s]?.length ?? 0
    );
  }
  if (maxStockDaily === 0 && maxStockHourly === 0) {
    return false;
  }
  if (maxStockDaily > 0 && fireDailyLen + 2 < maxStockDaily) {
    return true;
  }
  if (maxStockHourly > 0 && fireHourlyLen + 2 < maxStockHourly) {
    return true;
  }
  return false;
}

/** Записывает daily/weekly/1h FIREIDX, не трогая intraday-ряды. */
export function applyFireidxLongSeriesToChartSeries(
  chartSeries: MarketChartSeriesBundle,
  dailyBars: readonly MarketPriceBar[],
  hourlyBars: readonly MarketPriceBar[]
): void {
  const sym = FIREIDX_SYMBOL;
  if (dailyBars.length > 0) {
    chartSeries.dailyClose[sym] = [...dailyBars];
    chartSeries.weekly[sym] = buildWeeklyFromDaily(dailyBars);
  }
  if (hourlyBars.length > 0) {
    chartSeries.oneHour[sym] = trimSortedBarsToMaxCount(
      hourlyBars,
      CHART_SERIES_STORE_MAX_BARS.oneHour
    );
  }
}

function upsertSortedBarByTime(
  bars: readonly MarketPriceBar[],
  bar: MarketPriceBar
): MarketPriceBar[] {
  const next = [...bars];
  const idx = next.findIndex((b) => b.t === bar.t);
  if (idx >= 0) {
    next[idx] = bar;
  } else {
    next.push(bar);
    next.sort((a, b) => a.t - b.t);
  }
  return next;
}

/** Обновить дневную свечу FIREIDX для текущей сессии из накопленных минуток. */
export function refreshFireidxDailyForSessionDate(
  chartSeries: MarketChartSeriesBundle,
  calendar: TradingCalendar | null,
  sessionMskDateYyyymmdd: string
): void {
  if (!sessionMskDateYyyymmdd) {
    return;
  }
  const sym = FIREIDX_SYMBOL;
  const dayMinutes = (chartSeries.minute[sym] ?? []).filter(
    (b) => mskYyyymmddFromEpochMs(b.t) === sessionMskDateYyyymmdd
  );
  if (dayMinutes.length === 0) {
    return;
  }
  const sessionEndByDate = buildSessionEndByDate(calendar);
  const tEnd = sessionEndEpochForDate(sessionEndByDate, sessionMskDateYyyymmdd);
  let o = dayMinutes[0]!.o;
  let h = dayMinutes[0]!.h;
  let l = dayMinutes[0]!.l;
  let c = dayMinutes[0]!.c;
  let v = dayMinutes[0]!.v;
  for (let i = 1; i < dayMinutes.length; i += 1) {
    const b = dayMinutes[i]!;
    h = Math.max(h, b.h);
    l = Math.min(l, b.l);
    c = b.c;
    v += b.v;
  }
  const dailyBar: MarketPriceBar = { t: tEnd, o, h, l, c, v };
  const prevDaily = chartSeries.dailyClose[sym] ?? [];
  const prevAtEnd = prevDaily.find((b) => b.t === tEnd);
  if (
    prevAtEnd &&
    prevAtEnd.o === o &&
    prevAtEnd.h === h &&
    prevAtEnd.l === l &&
    prevAtEnd.c === c &&
    prevAtEnd.v === v
  ) {
    return;
  }
  const nextDaily = upsertSortedBarByTime(prevDaily, dailyBar);
  chartSeries.dailyClose[sym] = nextDaily;
  chartSeries.weekly[sym] = upsertWeeklyBarFromDaily(
    chartSeries.weekly[sym] ?? [],
    dailyBar
  );
}

export type AdvanceFireidxBatchResult = {
  compositeIndex: CompositeIndexState;
  minutesProcessed: number;
};

/** Сброс pointer catch-up (hydrate / тесты). */
export function resetFireidxHotPathRuntime(runtime: FireidxRuntimeCache): void {
  runtime.lastProcessedFireidxEpochMs = 0;
}

function resolveFireidxBatchStartEpoch(
  chartSeries: MarketChartSeriesBundle,
  runtime: FireidxRuntimeCache
): number {
  if (runtime.lastProcessedFireidxEpochMs > 0) {
    return runtime.lastProcessedFireidxEpochMs;
  }
  const fireidxMinutes = chartSeries.minute[FIREIDX_SYMBOL] ?? [];
  if (fireidxMinutes.length > 0) {
    return fireidxMinutes[fireidxMinutes.length - 1]!.t;
  }
  return 0;
}

/**
 * Hot-path batch: все пропущенные минуты до `simulationEpochMs` за один проход
 * (до FIREIDX_BATCH_MAX_MINUTES), с общим pointer cache и одним refresh daily.
 *
 * Gate на каждую минуту — как у `advanceFireidxMinuteBar`: хотя бы одна акция
 * имеет бар точно в epoch.
 */
export function advanceFireidxBatchUpToEpoch(input: {
  chartSeries: MarketChartSeriesBundle;
  catalog: readonly MarketInstrumentCatalogItem[];
  compositeIndex: CompositeIndexState;
  details: InstrumentDetailsCatalog;
  simulationEpochMs: number;
  calendar: TradingCalendar | null;
  runtime: FireidxRuntimeCache;
  sessionMskDateYyyymmdd: string | null;
}): AdvanceFireidxBatchResult {
  const {
    chartSeries,
    catalog,
    details,
    simulationEpochMs,
    calendar,
    runtime,
    sessionMskDateYyyymmdd,
  } = input;
  let index = input.compositeIndex;

  const symbols = stockSymbolsFromCatalog(catalog);
  if (symbols.length === 0 || index.constituents.length === 0) {
    return { compositeIndex: index, minutesProcessed: 0 };
  }

  const startExclusive = resolveFireidxBatchStartEpoch(chartSeries, runtime);
  if (simulationEpochMs <= startExclusive) {
    return { compositeIndex: index, minutesProcessed: 0 };
  }

  const minuteBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  for (const s of symbols) {
    minuteBySymbol[s] = chartSeries.minute[s] ?? [];
  }
  const pointers: Record<string, number> = {};

  let minutesProcessed = 0;
  let epoch =
    startExclusive > 0
      ? startExclusive + FIREIDX_MINUTE_MS
      : simulationEpochMs;

  while (epoch <= simulationEpochMs) {
    if (!anyStockHasExactMinuteAtEpoch(catalog, chartSeries, epoch)) {
      epoch += FIREIDX_MINUTE_MS;
      continue;
    }

    const prices = forwardFillPrices(symbols, minuteBySymbol, epoch, pointers);
    index = updateCompositeIndexFromPrices(
      index,
      catalog,
      prices,
      details,
      epoch,
      calendar
    );

    advanceFireidxMinuteBar(
      chartSeries,
      catalog,
      index,
      epoch,
      calendar
    );
    advanceFireidxIntradayFromConstituents(
      chartSeries,
      catalog,
      index,
      epoch
    );

    runtime.lastProcessedFireidxEpochMs = epoch;
    minutesProcessed += 1;
    epoch += FIREIDX_MINUTE_MS;
  }

  if (sessionMskDateYyyymmdd) {
    refreshFireidxDailyForSessionDate(
      chartSeries,
      calendar,
      sessionMskDateYyyymmdd
    );
  }

  return { compositeIndex: index, minutesProcessed };
}

/**
 * Hot-path: +1 минутная свеча FIREIDX.
 *
 * Gate: хотя бы одна акция имеет реальный бар точно в simulationEpochMs.
 */
export function advanceFireidxMinuteBar(
  chartSeries: MarketChartSeriesBundle,
  catalog: readonly MarketInstrumentCatalogItem[],
  index: CompositeIndexState,
  simulationEpochMs: number,
  _calendar: TradingCalendar | null
): void {
  const symbols = stockSymbolsFromCatalog(catalog);
  if (symbols.length === 0 || index.constituents.length === 0) {
    return;
  }
  if (!anyStockHasExactMinuteAtEpoch(catalog, chartSeries, simulationEpochMs)) {
    return;
  }
  const minuteBySymbol: Record<string, readonly MarketPriceBar[]> = {};
  for (const s of symbols) {
    minuteBySymbol[s] = chartSeries.minute[s] ?? [];
  }
  const level =
    compositeLevelAtEpochFromBars(
      index,
      symbols,
      minuteBySymbol,
      simulationEpochMs
    ) ?? index.level;

  const sym = FIREIDX_SYMBOL;
  const minute = [...(chartSeries.minute[sym] ?? [])];
  const last = minute.length > 0 ? minute[minute.length - 1] : null;

  if (last && last.t === simulationEpochMs) {
    const o = last.o;
    minute[minute.length - 1] = {
      t: simulationEpochMs,
      o,
      h: Math.max(o, level),
      l: Math.min(o, level),
      c: level,
      v: last.v,
    };
  } else {
    const o = last?.c ?? level;
    minute.push({
      t: simulationEpochMs,
      o,
      h: Math.max(o, level),
      l: Math.min(o, level),
      c: level,
      v: 1,
    });
  }

  chartSeries.minute[sym] = trimSortedBarsToMaxCount(
    minute,
    CHART_SERIES_STORE_MAX_BARS.minute
  );
}

/**
 * 5m/30m/1h FIREIDX — из минуток индекса (cap-weight на bucket).
 * Gate: хотя бы одна акция имеет минутный бар в simulationEpochMs.
 */
export function advanceFireidxIntradayFromConstituents(
  chartSeries: MarketChartSeriesBundle,
  catalog: readonly MarketInstrumentCatalogItem[],
  index: CompositeIndexState,
  simulationEpochMs: number
): void {
  if (index.constituents.length === 0) {
    return;
  }
  if (!anyStockHasExactMinuteAtEpoch(catalog, chartSeries, simulationEpochMs)) {
    return;
  }
  const sym = FIREIDX_SYMBOL;
  const minute = chartSeries.minute[sym] ?? [];
  const triggerMinute = minute.find((b) => b.t === simulationEpochMs);
  if (!triggerMinute) {
    return;
  }

  const upsertBucket = (
    seriesKey: 'fiveMinute' | 'thirtyMinute' | 'oneHour',
    stepMs: number
  ): void => {
    chartSeries[seriesKey][sym] = trimSortedBarsToMaxCount(
      mergeMinuteBucketIntoAggregatedBars(
        chartSeries[seriesKey][sym] ?? [],
        minute,
        stepMs,
        triggerMinute
      ),
      CHART_SERIES_STORE_MAX_BARS[seriesKey]
    );
  };

  upsertBucket('fiveMinute', INTRADAY_FIVE_MIN_MS);
  upsertBucket('thirtyMinute', INTRADAY_THIRTY_MIN_MS);
  upsertBucket('oneHour', HOUR_MS);
}

/**
 * Full rebuild — только bootstrap (пустая серия) или явный force.
 * Во время симуляции FIREIDX наращивается инкрементально; пересборка истории
 * на смене дня / после hydrate ломает уже посчитанные значения.
 */
export function shouldFullRebuildFireidx(input: {
  forceFull?: boolean;
  fireidxMinuteEmpty: boolean;
}): boolean {
  return Boolean(input.forceFull || input.fireidxMinuteEmpty);
}

/** Записывает агрегаты FIREIDX: длинные ряды отдельно, intraday — из минуток. */
export function applyFireidxBundlesToChartSeries(
  chartSeries: MarketChartSeriesBundle,
  rebuilt: Pick<
    RebuildFireidxResult,
    | 'minuteBars'
    | 'dailyBars'
    | 'hourlyBars'
    | 'fiveMinuteBars'
    | 'thirtyMinuteBars'
  >,
  calendar: TradingCalendar | null
): void {
  const sym = FIREIDX_SYMBOL;
  const sessionEndByDate = buildSessionEndByDate(calendar);

  let dailyBars = rebuilt.dailyBars;
  let hourlyBars = rebuilt.hourlyBars;
  if (dailyBars.length === 0 && rebuilt.minuteBars.length > 0) {
    dailyBars = aggregateMinuteRowsToBundles(
      [...rebuilt.minuteBars],
      sessionEndByDate
    ).dailyClose;
  }
  if (hourlyBars.length === 0 && rebuilt.minuteBars.length > 0) {
    hourlyBars = aggregateMinuteRowsToBundles(
      [...rebuilt.minuteBars],
      sessionEndByDate
    ).oneHour;
  }

  if (dailyBars.length > 0) {
    chartSeries.dailyClose[sym] = dailyBars;
    chartSeries.weekly[sym] = buildWeeklyFromDaily(dailyBars);
  }
  if (hourlyBars.length > 0) {
    chartSeries.oneHour[sym] = hourlyBars;
  }

  if (rebuilt.minuteBars.length === 0) {
    return;
  }

  const trimmedMinute = trimSortedBarsToMaxCount(
    rebuilt.minuteBars,
    CHART_SERIES_STORE_MAX_BARS.minute
  );
  chartSeries.minute[sym] = trimmedMinute;

  // 5m/30m всегда агрегируем из минуток FIREIDX — тот же путь, что и incremental hot-path.
  // Отдельный replay по stock fiveMinute давал расхождение на границе торгового дня.
  const intradayAggs = aggregateMinuteRowsToBundles(
    [...trimmedMinute],
    sessionEndByDate
  );
  const fiveMerged = mergeBarsPreferOverlay(
    rebuilt.fiveMinuteBars,
    intradayAggs.fiveMinute
  );
  const thirtyMerged = mergeBarsPreferOverlay(
    rebuilt.thirtyMinuteBars,
    intradayAggs.thirtyMinute
  );
  if (fiveMerged.length > 0) {
    chartSeries.fiveMinute[sym] = trimSortedBarsToMaxCount(
      fiveMerged,
      CHART_SERIES_STORE_MAX_BARS.fiveMinute
    );
  }
  if (thirtyMerged.length > 0) {
    chartSeries.thirtyMinute[sym] = trimSortedBarsToMaxCount(
      thirtyMerged,
      CHART_SERIES_STORE_MAX_BARS.thirtyMinute
    );
  }
}
