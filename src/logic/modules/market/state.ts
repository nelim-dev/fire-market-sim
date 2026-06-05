import type {
  AssetKind,
  MarketInstrumentCatalogItem,
  OrderBookSnapshot,
} from './contracts';
import type { ChartTimeframeId } from './chartTimeframes';
import { sortInstrumentCatalog } from './catalogSort';
import type { MarketMacroSnapshot } from './macro';
import { EMPTY_MARKET_MACRO_SNAPSHOT } from './macro';
import type { MarketChartSeriesBundle } from './chartWindows';
import { emptyChartLinesByTimeframe, emptyPeriodChangeByTimeframe } from './priceSeries';
import type { MarketPriceBar } from './priceSeries';
import {
  loadInstrumentDetailsCatalog,
  type InstrumentDetailsCatalog,
} from './instrumentDetails';
import {
  createEmptyCompositeIndex,
  FIREIDX_SYMBOL,
  type CompositeIndexState,
} from './compositeIndex';
import { applyInstrumentCopyToCatalog } from './instrumentCopy';

export type { OrderBookSnapshot } from './contracts';
export type { MarketMacroSnapshot } from './macro';

/**
 * Состояние одного инструмента на рынке: метаданные, котировки по дневному ряду, стакан.
 */
export interface MarketAssetState {
  symbol: string;
  assetKind: AssetKind;
  displayName: string;
  isin: string;
  /** Описание для вкладки «О бумаге» (из `instrumentCopyOverrides.ts`). */
  description?: string;
  /** Путь к файлу данных относительно корня репозитория (как в сгенерированном JSON). */
  sourceFilePath: string;
  currentPriceRub: number | null;
  /** Изменение к предыдущему **дневному** закрытию (календарный день). */
  dailyChangePct: number | null;
  /** Изменение за выбранный горизонт графика (по первой/последней свече линии). */
  periodChangePctByTimeframe: Record<ChartTimeframeId, number | null>;
  /** Линия графика по таймфрейму, уже обрезана по `simulationEpochMs` (см. `quoteApply`). */
  chartLineByTimeframe: Record<ChartTimeframeId, readonly MarketPriceBar[]>;
  orderBook: OrderBookSnapshot;
  /** Эпоха последней сборки стакана (для сглаживания между тиками). */
  orderBookBuiltAtEpochMs: number;
  /** Минимальный лот: для торговли — quantity должно быть кратно. По умолчанию 1. */
  lotSize: number;
  /** Признак облигации: триггер для НКД/купонов/погашения. */
  isBond: boolean;
  /** Номинал (₽), nullable для не-бондов. */
  faceValueRub: number | null;
  /** Дата погашения для бондов, ms (Europe/Moscow midnight). */
  maturityEpochMs: number | null;
  /** Текущий НКД за облигацию, ₽. 0 для не-бондов и до подключения сабсервиса corporateActions. */
  nkdPerBondRub: number;
  /** Фиксированный стакан: bid/ask по текущей цене, qty не уменьшается после сделок. */
  staticOrderBookPin?: { qty: number };
}

export function createEmptyOrderBook(): OrderBookSnapshot {
  return { bids: [], asks: [] };
}

export function buildAssetsBySymbol(
  items: readonly MarketInstrumentCatalogItem[],
  details?: InstrumentDetailsCatalog
): Record<string, MarketAssetState> {
  const out: Record<string, MarketAssetState> = {};
  for (const item of items) {
    const key = item.symbol.toUpperCase();
    const meta = details?.instrumentMetaBySymbol[key];
    const lotSize = details?.lotSizeBySymbol[key] ?? 1;
    const isBond = meta?.isBond ?? item.assetKind === 'bond';
    const staticQty = details?.staticOrderBookLotsBySymbol?.[key];
    out[key] = {
      symbol: item.symbol,
      assetKind: item.assetKind,
      displayName: item.displayName,
      isin: item.isin,
      description: item.description,
      sourceFilePath: item.sourceFilePath,
      currentPriceRub: null,
      dailyChangePct: null,
      periodChangePctByTimeframe: emptyPeriodChangeByTimeframe(),
      chartLineByTimeframe: emptyChartLinesByTimeframe(),
      orderBook: createEmptyOrderBook(),
      orderBookBuiltAtEpochMs: 0,
      lotSize: Math.max(1, Math.floor(lotSize)),
      isBond,
      faceValueRub: meta?.initialFaceValueRub ?? null,
      maturityEpochMs: meta?.maturityEpochMs ?? null,
      nkdPerBondRub: 0,
      ...(staticQty != null && staticQty > 0
        ? { staticOrderBookPin: { qty: staticQty } }
        : {}),
    };
  }
  return out;
}

export interface MarketModuleState {
  /** Каталог загружен (из сгенерированного JSON при сборке / после gen:market-catalog). */
  ready: boolean;
  instrumentCatalog: MarketInstrumentCatalogItem[];
  assetsBySymbol: Record<string, MarketAssetState>;
  /**
   * Срезы рядов (агрегаты по минутным данным из SQLite / `npm run build:market-db`).
   */
  chartSeries: MarketChartSeriesBundle;
  /** Макропоказатели шапки на текущую эпоху симуляции (см. macroResolve). */
  macroSnapshot: MarketMacroSnapshot;
  /**
   * Декларативные не-ценовые данные инструментов (lotSize, дивиденды, купоны, амортизации).
   * Используется сабсервисами MarketModule (corporateActions) и быстрыми вычислениями nkdPerBondRub.
   * Все сущности — read-only snapshot за время жизни процесса.
   */
  details: InstrumentDetailsCatalog;
  compositeIndex: CompositeIndexState;
  /** Кэш hot-path FIREIDX: когда делали full rebuild daily/minute. */
  fireidxRuntime: FireidxRuntimeCache;
}

export type FireidxRuntimeCache = {
  lastFullRebuildEpochMs: number;
  lastDailyRebuildMskDate: string | null;
  /** Дневной/часовой FIREIDX построен из полной истории акций (6m/1y/all). */
  longSeriesBootstrapped: boolean;
  /** Последняя минутка FIREIDX, обработанная hot-path (для batch catch-up). */
  lastProcessedFireidxEpochMs: number;
};

export function createEmptyFireidxRuntimeCache(): FireidxRuntimeCache {
  return {
    lastFullRebuildEpochMs: 0,
    lastDailyRebuildMskDate: null,
    longSeriesBootstrapped: false,
    lastProcessedFireidxEpochMs: 0,
  };
}

function normalizeBarsRecord(
  catalog: readonly MarketInstrumentCatalogItem[],
  src: Record<string, readonly MarketPriceBar[]> | undefined
): Record<string, readonly MarketPriceBar[]> {
  const out: Record<string, readonly MarketPriceBar[]> = {};
  for (const row of catalog) {
    const key = row.symbol.toUpperCase();
    out[key] = src?.[key] ?? [];
  }
  return out;
}

/** Обновляет только ряды графиков, сохраняя compositeIndex и assets. */
export function applyChartSeriesBundleToMarket(
  market: MarketModuleState,
  bundle: MarketChartSeriesBundle
): void {
  market.chartSeries = bundle;
}

export function createMarketModuleState(
  items: readonly MarketInstrumentCatalogItem[],
  chartSeriesInput: Partial<MarketChartSeriesBundle> = {}
): MarketModuleState {
  const withIndex = applyInstrumentCopyToCatalog([...items]);
  if (!withIndex.some((i) => i.symbol.toUpperCase() === FIREIDX_SYMBOL)) {
    withIndex.push({
      assetKind: 'fund',
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIRE Market Index',
      isin: 'FIREIDX-SYNTH',
      sourceFilePath: '',
    });
  }
  const catalogSorted = sortInstrumentCatalog(withIndex);
  const details = loadInstrumentDetailsCatalog();
  const chartSeries: MarketChartSeriesBundle = {
    minute: normalizeBarsRecord(catalogSorted, chartSeriesInput.minute),
    dailyClose: normalizeBarsRecord(catalogSorted, chartSeriesInput.dailyClose),
    fiveMinute: normalizeBarsRecord(catalogSorted, chartSeriesInput.fiveMinute),
    thirtyMinute: normalizeBarsRecord(catalogSorted, chartSeriesInput.thirtyMinute),
    oneHour: normalizeBarsRecord(catalogSorted, chartSeriesInput.oneHour),
    weekly: normalizeBarsRecord(catalogSorted, chartSeriesInput.weekly),
  };
  const assetsBySymbol = buildAssetsBySymbol(catalogSorted, details);
  const compositeIndex = createEmptyCompositeIndex();
  return {
    ready: catalogSorted.length > 0,
    instrumentCatalog: catalogSorted,
    assetsBySymbol,
    chartSeries,
    macroSnapshot: { ...EMPTY_MARKET_MACRO_SNAPSHOT },
    details,
    compositeIndex,
    fireidxRuntime: createEmptyFireidxRuntimeCache(),
  };
}
