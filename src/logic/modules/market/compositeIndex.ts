import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import type { MarketInstrumentCatalogItem } from './contracts';
import type { InstrumentDetailsCatalog } from './instrumentDetails';
import type { MarketAssetState } from './state';

export const FIREIDX_SYMBOL = 'FIREIDX';
export const COMPOSITE_INDEX_INITIAL_LEVEL = 1000;

const FIREIDX_CATALOG_ITEM: MarketInstrumentCatalogItem = {
  assetKind: 'fund',
  ticker: FIREIDX_SYMBOL,
  symbol: FIREIDX_SYMBOL,
  displayName: 'FIRE Market Index',
  isin: 'FIREIDX-SYNTH',
  sourceFilePath: '',
};

export type CompositeIndexConstituent = {
  symbol: string;
  weightPct: number;
  capRubAtRebalance: number;
  priceRubAtRebalance: number;
  sharesOutstanding: number;
  usesPriceOnlyWeight: boolean;
};

export type CompositeIndexState = {
  symbol: typeof FIREIDX_SYMBOL;
  level: number;
  /** Уровень индекса на момент последнего ребаланса (для непрерывности). */
  levelAtRebalance: number;
  lastRebalanceEpochMs: number;
  nextRebalanceEpochMs: number;
  constituents: CompositeIndexConstituent[];
  weightsBySymbol: Record<string, number>;
  rebalanceBasePricesBySymbol: Record<string, number>;
};

export function parseSharesOutstanding(
  symbol: string,
  details: InstrumentDetailsCatalog
): { shares: number; priceOnly: boolean } {
  const raw = details.sharesOutstandingBySymbol?.[symbol.toUpperCase()];
  if (raw != null && Number.isFinite(raw) && raw > 0) {
    return { shares: raw, priceOnly: false };
  }
  return { shares: 1, priceOnly: true };
}

function quarterAnchorYyyymm(epochMs: number): { y: number; m: number } {
  const d = new Date(epochMs);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const qMonth = m <= 3 ? 1 : m <= 6 ? 4 : m <= 9 ? 7 : 10;
  return { y, m: qMonth };
}

function mskMidnightUtcMs(y: number, m: number, day: number): number {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+03:00`;
  return new Date(iso).getTime();
}

export function nextRebalanceEpochAfter(
  epochMs: number,
  calendar: TradingCalendar | null
): number {
  const { y, m } = quarterAnchorYyyymm(epochMs);
  const candidates: number[] = [];
  for (let year = y; year <= y + 1; year += 1) {
    for (const month of [1, 4, 7, 10] as const) {
      if (year === y && month < m) {
        continue;
      }
      const anchor = mskMidnightUtcMs(year, month, 1);
      if (anchor > epochMs) {
        candidates.push(anchor);
      }
    }
  }
  candidates.sort((a, b) => a - b);
  const target = candidates[0] ?? mskMidnightUtcMs(y + 1, 1, 1);
  if (!calendar) {
    return target;
  }
  for (const day of calendar.readonlyDays) {
    if (day.sessionStartEpochMs >= target) {
      return day.sessionStartEpochMs;
    }
  }
  return target;
}

export function stockSymbolsFromCatalog(
  catalog: readonly MarketInstrumentCatalogItem[]
): string[] {
  return catalog
    .filter((item) => item.assetKind === 'stock')
    .map((item) => item.symbol.toUpperCase());
}

function isStockActiveAtEpoch(
  symbol: string,
  details: InstrumentDetailsCatalog,
  simulationEpochMs: number
): boolean {
  const meta = details.instrumentMetaBySymbol[symbol.toUpperCase()];
  const firstTradeEpochMs = meta?.firstTradeEpochMs ?? null;
  if (firstTradeEpochMs != null && simulationEpochMs < firstTradeEpochMs) {
    return false;
  }
  const maturityEpochMs = meta?.maturityEpochMs ?? null;
  if (maturityEpochMs != null && simulationEpochMs >= maturityEpochMs) {
    return false;
  }
  return true;
}

export function activeStockSymbolsAtEpoch(
  catalog: readonly MarketInstrumentCatalogItem[],
  details: InstrumentDetailsCatalog,
  simulationEpochMs: number
): string[] {
  return stockSymbolsFromCatalog(catalog).filter((symbol) =>
    isStockActiveAtEpoch(symbol, details, simulationEpochMs)
  );
}

/** Пустое состояние до первого bootstrap (когда уже есть котировки акций). */
export function createEmptyCompositeIndex(): CompositeIndexState {
  return {
    symbol: FIREIDX_SYMBOL,
    level: COMPOSITE_INDEX_INITIAL_LEVEL,
    levelAtRebalance: COMPOSITE_INDEX_INITIAL_LEVEL,
    lastRebalanceEpochMs: 0,
    nextRebalanceEpochMs: 0,
    constituents: [],
    weightsBySymbol: {},
    rebalanceBasePricesBySymbol: {},
  };
}

export function buildConstituentsFromPrices(
  symbols: readonly string[],
  pricesBySymbol: Readonly<Record<string, number>>,
  details: InstrumentDetailsCatalog
): CompositeIndexConstituent[] {
  const rows: CompositeIndexConstituent[] = [];
  for (const symbol of symbols) {
    const price = pricesBySymbol[symbol];
    if (price == null || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    const { shares, priceOnly } = parseSharesOutstanding(symbol, details);
    const cap = price * shares;
    rows.push({
      symbol,
      weightPct: 0,
      capRubAtRebalance: cap,
      priceRubAtRebalance: price,
      sharesOutstanding: shares,
      usesPriceOnlyWeight: priceOnly,
    });
  }
  const totalCap = rows.reduce((s, r) => s + r.capRubAtRebalance, 0);
  if (totalCap <= 0) {
    const equal = rows.length > 0 ? 100 / rows.length : 0;
    return rows.map((r) => ({ ...r, weightPct: equal }));
  }
  return rows.map((r) => ({
    ...r,
    weightPct: (r.capRubAtRebalance / totalCap) * 100,
  }));
}

/** Σ sharesᵢ × Pᵢ — база cap-weight индекса между ребалансами. */
export function computeCapTotalRub(
  constituents: readonly CompositeIndexConstituent[],
  pricesBySymbol: Readonly<Record<string, number>>
): number {
  let total = 0;
  for (const c of constituents) {
    const price = pricesBySymbol[c.symbol];
    if (price == null || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    total += c.sharesOutstanding * price;
  }
  return total;
}

export function computeIndexLevelFromCaps(
  levelAtRebalance: number,
  capTotalRub: number,
  capTotalAtRebalanceRub: number
): number {
  if (
    !Number.isFinite(levelAtRebalance) ||
    levelAtRebalance <= 0 ||
    !Number.isFinite(capTotalRub) ||
    capTotalRub <= 0 ||
    !Number.isFinite(capTotalAtRebalanceRub) ||
    capTotalAtRebalanceRub <= 0
  ) {
    return levelAtRebalance;
  }
  return Math.round(levelAtRebalance * (capTotalRub / capTotalAtRebalanceRub) * 100) / 100;
}

function buildWeights(constituents: CompositeIndexConstituent[]): {
  weightsBySymbol: Record<string, number>;
  rebalanceBasePricesBySymbol: Record<string, number>;
  capTotalAtRebalanceRub: number;
} {
  const weightsBySymbol: Record<string, number> = {};
  const rebalanceBasePricesBySymbol: Record<string, number> = {};
  let capTotalAtRebalanceRub = 0;
  for (const c of constituents) {
    weightsBySymbol[c.symbol] = c.weightPct / 100;
    rebalanceBasePricesBySymbol[c.symbol] = c.priceRubAtRebalance;
    capTotalAtRebalanceRub += c.capRubAtRebalance;
  }
  return { weightsBySymbol, rebalanceBasePricesBySymbol, capTotalAtRebalanceRub };
}

function buildConstituents(
  symbols: string[],
  assetsBySymbol: Record<string, MarketAssetState>,
  details: InstrumentDetailsCatalog
): CompositeIndexConstituent[] {
  const prices: Record<string, number> = {};
  for (const symbol of symbols) {
    const price = assetsBySymbol[symbol]?.currentPriceRub;
    if (price != null && Number.isFinite(price) && price > 0) {
      prices[symbol] = price;
    }
  }
  return buildConstituentsFromPrices(symbols, prices, details);
}

function isCompositeIndexUninitialized(index: CompositeIndexState): boolean {
  return Object.keys(index.weightsBySymbol).length === 0;
}

function shouldQuarterlyRebalance(
  index: CompositeIndexState,
  simulationEpochMs: number
): boolean {
  return (
    index.nextRebalanceEpochMs > 0 &&
    simulationEpochMs >= index.nextRebalanceEpochMs
  );
}

function symbolsKey(symbols: readonly string[]): string {
  return [...symbols].sort().join('|');
}

function compositeStateFromConstituents(
  prev: CompositeIndexState,
  constituents: CompositeIndexConstituent[],
  simulationEpochMs: number,
  calendar: TradingCalendar | null,
  bootstrap: boolean
): CompositeIndexState {
  const { weightsBySymbol, rebalanceBasePricesBySymbol } = buildWeights(constituents);
  return {
    ...prev,
    levelAtRebalance: bootstrap ? COMPOSITE_INDEX_INITIAL_LEVEL : prev.level,
    level: bootstrap ? COMPOSITE_INDEX_INITIAL_LEVEL : prev.level,
    lastRebalanceEpochMs: simulationEpochMs,
    nextRebalanceEpochMs: nextRebalanceEpochAfter(simulationEpochMs, calendar),
    constituents,
    weightsBySymbol,
    rebalanceBasePricesBySymbol,
  };
}

/** Обновление cap-weight уровня с явными ценами (assets или minute forward-fill). */
export function updateCompositeIndexFromPrices(
  index: CompositeIndexState,
  catalog: readonly MarketInstrumentCatalogItem[],
  pricesBySymbol: Readonly<Record<string, number>>,
  details: InstrumentDetailsCatalog,
  simulationEpochMs: number,
  calendar: TradingCalendar | null
): CompositeIndexState {
  let next = index;
  const bootstrap = isCompositeIndexUninitialized(index);
  const activeStocks = activeStockSymbolsAtEpoch(catalog, details, simulationEpochMs);
  const compositionChanged =
    symbolsKey(index.constituents.map((c) => c.symbol)) !== symbolsKey(activeStocks);
  const rebalance =
    bootstrap || shouldQuarterlyRebalance(index, simulationEpochMs) || compositionChanged;

  if (rebalance) {
    const constituents = buildConstituentsFromPrices(
      activeStocks,
      pricesBySymbol,
      details
    );
    if (constituents.length === 0) {
      return index;
    }
    next = compositeStateFromConstituents(
      index,
      constituents,
      simulationEpochMs,
      calendar,
      bootstrap
    );
  }

  const prices: Record<string, number> = {};
  for (const symbol of Object.keys(next.weightsBySymbol)) {
    const price = pricesBySymbol[symbol];
    if (price != null && Number.isFinite(price) && price > 0) {
      prices[symbol] = price;
    }
  }
  const capTotal = computeCapTotalRub(next.constituents, prices);
  const capAtRebalance = computeCapTotalRub(
    next.constituents,
    next.rebalanceBasePricesBySymbol
  );
  const level = computeIndexLevelFromCaps(
    next.levelAtRebalance,
    capTotal,
    capAtRebalance
  );

  return { ...next, level };
}

export function updateCompositeIndex(
  index: CompositeIndexState,
  catalog: readonly MarketInstrumentCatalogItem[],
  assetsBySymbol: Record<string, MarketAssetState>,
  details: InstrumentDetailsCatalog,
  simulationEpochMs: number,
  calendar: TradingCalendar | null
): CompositeIndexState {
  const prices: Record<string, number> = {};
  for (const symbol of stockSymbolsFromCatalog(catalog)) {
    const price = assetsBySymbol[symbol]?.currentPriceRub;
    if (price != null && Number.isFinite(price) && price > 0) {
      prices[symbol] = price;
    }
  }
  return updateCompositeIndexFromPrices(
    index,
    catalog,
    prices,
    details,
    simulationEpochMs,
    calendar
  );
}

export function syncFireidxAsset(
  assetsBySymbol: Record<string, MarketAssetState>,
  index: CompositeIndexState,
  displayCatalogItem?: MarketInstrumentCatalogItem
): void {
  const item = displayCatalogItem ?? FIREIDX_CATALOG_ITEM;
  const prev = assetsBySymbol[FIREIDX_SYMBOL];
  assetsBySymbol[FIREIDX_SYMBOL] = {
    ...(prev ?? {
      symbol: FIREIDX_SYMBOL,
      assetKind: 'fund' as const,
      displayName: item.displayName,
      isin: item.isin,
      sourceFilePath: item.sourceFilePath,
      dailyChangePct: null,
      periodChangePctByTimeframe: {
        '1d': null,
        '1w': null,
        '1m': null,
        '6m': null,
        '1y': null,
        all: null,
      },
      chartLineByTimeframe: {
        '1d': [],
        '1w': [],
        '1m': [],
        '6m': [],
        '1y': [],
        all: [],
      },
      orderBook: { bids: [], asks: [] },
      orderBookBuiltAtEpochMs: 0,
      lotSize: 1,
      isBond: false,
      faceValueRub: null,
      maturityEpochMs: null,
      nkdPerBondRub: 0,
    }),
    symbol: FIREIDX_SYMBOL,
    assetKind: 'fund',
    displayName: item.displayName,
    isin: item.isin,
    sourceFilePath: item.sourceFilePath,
    currentPriceRub: index.level,
  };
}
