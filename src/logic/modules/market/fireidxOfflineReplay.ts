import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import type { MarketInstrumentCatalogItem } from './contracts';
import {
  activeStockSymbolsAtEpoch,
  buildConstituentsFromPrices,
  COMPOSITE_INDEX_INITIAL_LEVEL,
  computeCapTotalRub,
  computeIndexLevelFromCaps,
  FIREIDX_SYMBOL,
  nextRebalanceEpochAfter,
  type CompositeIndexState,
} from './compositeIndex';
import type { InstrumentDetailsCatalog } from './instrumentDetails';
import type { MarketPriceBar } from './priceSeries';

type ReplayState = {
  indexState: CompositeIndexState | null;
  capTotalAtRebalance: number;
  prevLevel: number;
};

export type FireidxReplayCursor = {
  replay: ReplayState;
  pointers: Record<string, number>;
  /** Forward-fill между торговыми днями. */
  seedPricesBySymbol: Record<string, number>;
  totalOutputBars: number;
};

const emptyIndex = (): CompositeIndexState => ({
  symbol: FIREIDX_SYMBOL,
  level: COMPOSITE_INDEX_INITIAL_LEVEL,
  levelAtRebalance: COMPOSITE_INDEX_INITIAL_LEVEL,
  lastRebalanceEpochMs: 0,
  nextRebalanceEpochMs: 0,
  constituents: [],
  weightsBySymbol: {},
  rebalanceBasePricesBySymbol: {},
});

export function createEmptyFireidxReplayCursor(): FireidxReplayCursor {
  return {
    replay: {
      indexState: null,
      capTotalAtRebalance: 0,
      prevLevel: COMPOSITE_INDEX_INITIAL_LEVEL,
    },
    pointers: {},
    seedPricesBySymbol: {},
    totalOutputBars: 0,
  };
}

function symbolsKey(symbols: readonly string[]): string {
  return [...symbols].sort().join('|');
}

function forwardFillPrices(
  symbols: readonly string[],
  barsBySymbol: Record<string, readonly MarketPriceBar[]>,
  t: number,
  pointers: Record<string, number>,
  seedPricesBySymbol: Record<string, number>
): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const sym of symbols) {
    const bars = barsBySymbol[sym] ?? [];
    let idx = pointers[sym] ?? -1;
    while (idx + 1 < bars.length && bars[idx + 1]!.t <= t) {
      idx += 1;
    }
    pointers[sym] = idx;
    if (idx >= 0 && idx < bars.length) {
      const close = bars[idx]!.c;
      if (Number.isFinite(close) && close > 0) {
        prices[sym] = close;
        continue;
      }
    }
    const seed = seedPricesBySymbol[sym];
    if (seed != null && Number.isFinite(seed) && seed > 0) {
      prices[sym] = seed;
    }
  }
  return prices;
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

function refreshSeedPrices(
  symbols: readonly string[],
  barsBySymbol: Record<string, readonly MarketPriceBar[]>,
  pointers: Record<string, number>,
  seedPricesBySymbol: Record<string, number>
): void {
  for (const sym of symbols) {
    const bars = barsBySymbol[sym] ?? [];
    const idx = pointers[sym] ?? -1;
    if (idx >= 0 && idx < bars.length) {
      const close = bars[idx]!.c;
      if (Number.isFinite(close) && close > 0) {
        seedPricesBySymbol[sym] = close;
      }
    }
  }
}

/**
 * Cap-weight replay для одного торгового окна (обычно один день).
 * Память: только бары текущей сессии + cursor между днями.
 */
export function replayFireidxMinuteBarsForSession(input: {
  catalog: readonly MarketInstrumentCatalogItem[];
  symbols: readonly string[];
  barsBySymbol: Record<string, readonly MarketPriceBar[]>;
  details: InstrumentDetailsCatalog;
  sessionEndEpochMs: number;
  calendar: TradingCalendar | null;
  cursor: FireidxReplayCursor;
}): { bars: MarketPriceBar[]; cursor: FireidxReplayCursor } {
  const { symbols, barsBySymbol, details, sessionEndEpochMs, calendar } = input;
  const cursor = input.cursor;
  const replay = cursor.replay;
  /** Индексы только внутри текущей сессии; между днями — seedPrices. */
  const pointers: Record<string, number> = {};
  const outputBars: MarketPriceBar[] = [];

  if (symbols.length === 0) {
    return { bars: outputBars, cursor };
  }

  const timestamps = collectUnionTimestamps(
    symbols,
    barsBySymbol,
    sessionEndEpochMs
  );

  for (const t of timestamps) {
    const prices = forwardFillPrices(
      symbols,
      barsBySymbol,
      t,
      pointers,
      cursor.seedPricesBySymbol
    );
    if (Object.keys(prices).length === 0) {
      continue;
    }

    const activeAtT = activeStockSymbolsAtEpoch(
      input.catalog,
      details,
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
        !applyRebalance(replay, activeAtT, prices, details, t, calendar)
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

    const last =
      outputBars.length > 0 ? outputBars[outputBars.length - 1] : null;
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

  refreshSeedPrices(symbols, barsBySymbol, pointers, cursor.seedPricesBySymbol);
  cursor.totalOutputBars += outputBars.length;

  return { bars: outputBars, cursor };
}

export function finalCompositeIndexFromCursor(
  cursor: FireidxReplayCursor
): CompositeIndexState {
  return cursor.replay.indexState ?? emptyIndex();
}
