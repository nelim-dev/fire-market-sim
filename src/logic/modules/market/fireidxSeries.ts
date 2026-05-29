import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import { trimSortedBarsToMaxCount } from './chartSeriesRetention';
import { CHART_SERIES_STORE_MAX_BARS } from './chartSeriesRetention';
import type { MarketInstrumentCatalogItem } from './contracts';
import type { MarketChartSeriesBundle } from './chartWindows';
import { aggregateMinuteRowsToBundles } from './minuteBarAggregation';
import { INTRADAY_FIVE_MIN_MS, INTRADAY_THIRTY_MIN_MS } from './minuteBarAggregation';
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
  type CompositeIndexState,
} from './compositeIndex';
import type { InstrumentDetailsCatalog } from './instrumentDetails';
import type { MarketPriceBar } from './priceSeries';

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

function buildWeeklyFromDaily(dailies: readonly MarketPriceBar[]): MarketPriceBar[] {
  if (dailies.length === 0) {
    return [];
  }
  const byWeek = new Map<string, MarketPriceBar>();
  for (const b of dailies) {
    const dt = new Date(b.t);
    const key = `${getISOWeekYear(dt)}-W${String(getISOWeek(dt)).padStart(2, '0')}`;
    const prev = byWeek.get(key);
    if (!prev || b.t >= prev.t) {
      byWeek.set(key, { ...b });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.t - b.t);
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

function applyRebalance(
  state: ReplayState,
  symbols: readonly string[],
  prices: Record<string, number>,
  details: InstrumentDetailsCatalog,
  t: number,
  calendar: TradingCalendar | null
): boolean {
  const bootstrap = state.indexState === null;
  const constituents = buildConstituentsFromPrices(symbols, prices, details);
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

    const needsRebalance =
      replay.indexState === null ||
      (replay.indexState.nextRebalanceEpochMs > 0 &&
        t >= replay.indexState.nextRebalanceEpochMs);

    if (needsRebalance) {
      if (!applyRebalance(replay, input.symbols, prices, input.details, t, input.calendar)) {
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
  return bars.some((b) => b.t === epochMs);
}

function upsertSortedBar(
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

/** Уровень индекса по ценам из указанного ряда (5m/30m/minute) на эпохе t. */
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

  const dailyReplay = replayCapWeightedBars({
    symbols,
    barsBySymbol: dailyBySymbol,
    details: input.details,
    simulationEpochMs: input.simulationEpochMs,
    calendar: input.calendar,
  });

  const hourlyReplay = replayCapWeightedBars({
    symbols,
    barsBySymbol: hourlyBySymbol,
    details: input.details,
    simulationEpochMs: input.simulationEpochMs,
    calendar: input.calendar,
  });

  const minuteReplay = replayCapWeightedBars({
    symbols,
    barsBySymbol: minuteBySymbol,
    details: input.details,
    simulationEpochMs: input.simulationEpochMs,
    calendar: input.calendar,
  });

  const fiveMinuteReplay = replayCapWeightedBars({
    symbols,
    barsBySymbol: fiveMinBySymbol,
    details: input.details,
    simulationEpochMs: input.simulationEpochMs,
    calendar: input.calendar,
  });

  const thirtyMinuteReplay = replayCapWeightedBars({
    symbols,
    barsBySymbol: thirtyMinBySymbol,
    details: input.details,
    simulationEpochMs: input.simulationEpochMs,
    calendar: input.calendar,
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

/**
 * Hot-path: +1 минутная свеча FIREIDX.
 *
 * Gate: хотя бы одна акция имеет реальный бар точно в simulationEpochMs.
 * Это предотвращает «забегание вперёд» — бар на текущую минуту не добавляется,
 * пока ни одна акция не принесла свежих данных. Forward-fill всё равно используется
 * для акций без нового бара в эту минуту (они считаются по последней известной цене).
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
 * 5m/30m FIREIDX — из тех же рядов акций, что и у SBER (cap-weight на bucket),
 * а не из агрегата минуток индекса.
 * Gate: тот же — хотя бы одна акция имеет минутный бар в simulationEpochMs.
 */
export function advanceFireidxIntradayFromConstituents(
  chartSeries: MarketChartSeriesBundle,
  catalog: readonly MarketInstrumentCatalogItem[],
  index: CompositeIndexState,
  simulationEpochMs: number
): void {
  const symbols = stockSymbolsFromCatalog(catalog);
  if (symbols.length === 0 || index.constituents.length === 0) {
    return;
  }
  if (!anyStockHasExactMinuteAtEpoch(catalog, chartSeries, simulationEpochMs)) {
    return;
  }
  const sym = FIREIDX_SYMBOL;

  const upsertBucket = (
    seriesKey: 'fiveMinute' | 'thirtyMinute',
    stepMs: number
  ): void => {
    const bucketT = Math.floor(simulationEpochMs / stepMs) * stepMs;
    const barsBySymbol: Record<string, readonly MarketPriceBar[]> = {};
    for (const s of symbols) {
      barsBySymbol[s] = chartSeries[seriesKey][s] ?? [];
    }
    const level = compositeLevelAtEpochFromBars(
      index,
      symbols,
      barsBySymbol,
      bucketT
    );
    if (level === null) {
      return;
    }
    const prev = chartSeries[seriesKey][sym] ?? [];
    const last = prev.length > 0 ? prev[prev.length - 1] : null;
    const o = last?.t === bucketT ? last.o : (last?.c ?? level);
    chartSeries[seriesKey][sym] = trimSortedBarsToMaxCount(
      upsertSortedBar(prev, {
        t: bucketT,
        o,
        h: Math.max(o, level),
        l: Math.min(o, level),
        c: level,
        v: 1,
      }),
      CHART_SERIES_STORE_MAX_BARS[seriesKey]
    );
  };

  upsertBucket('fiveMinute', INTRADAY_FIVE_MIN_MS);
  upsertBucket('thirtyMinute', INTRADAY_THIRTY_MIN_MS);
}

export function shouldFullRebuildFireidx(input: {
  forceFull?: boolean;
  stockBarsChanged?: boolean;
  fireidxMinuteEmpty: boolean;
  currentMskDate: string | null;
  lastDailyRebuildMskDate: string | null;
}): boolean {
  if (input.forceFull || input.stockBarsChanged || input.fireidxMinuteEmpty) {
    return true;
  }
  if (
    input.currentMskDate &&
    input.lastDailyRebuildMskDate !== input.currentMskDate
  ) {
    return true;
  }
  return false;
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

  let fiveMinuteBars = rebuilt.fiveMinuteBars;
  let thirtyMinuteBars = rebuilt.thirtyMinuteBars;
  if (fiveMinuteBars.length === 0 && trimmedMinute.length > 0) {
    fiveMinuteBars = aggregateMinuteRowsToBundles(
      [...trimmedMinute],
      sessionEndByDate
    ).fiveMinute;
  }
  if (thirtyMinuteBars.length === 0 && trimmedMinute.length > 0) {
    thirtyMinuteBars = aggregateMinuteRowsToBundles(
      [...trimmedMinute],
      sessionEndByDate
    ).thirtyMinute;
  }
  if (fiveMinuteBars.length > 0) {
    chartSeries.fiveMinute[sym] = trimSortedBarsToMaxCount(
      fiveMinuteBars,
      CHART_SERIES_STORE_MAX_BARS.fiveMinute
    );
  }
  if (thirtyMinuteBars.length > 0) {
    chartSeries.thirtyMinute[sym] = trimSortedBarsToMaxCount(
      thirtyMinuteBars,
      CHART_SERIES_STORE_MAX_BARS.thirtyMinute
    );
  }
}
