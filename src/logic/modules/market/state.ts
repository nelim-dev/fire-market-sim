import type {
  AssetKind,
  MarketInstrumentCatalogItem,
  OrderBookSnapshot,
} from './contracts';
import type { ChartTimeframeId } from './chartTimeframes';
import { sortInstrumentCatalog } from './catalogSort';
import type { MarketMacroSnapshot } from './macro';
import { STATIC_MARKET_MACRO_SNAPSHOT } from './macro';
import type { MarketChartSeriesBundle } from './chartWindows';
import { emptyChartLinesByTimeframe, emptyPeriodChangeByTimeframe } from './priceSeries';
import type { MarketPriceBar } from './priceSeries';
import {
  loadInstrumentDetailsCatalog,
  type InstrumentDetailsCatalog,
} from './instrumentDetails';

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
    out[key] = {
      symbol: item.symbol,
      assetKind: item.assetKind,
      displayName: item.displayName,
      isin: item.isin,
      sourceFilePath: item.sourceFilePath,
      currentPriceRub: null,
      dailyChangePct: null,
      periodChangePctByTimeframe: emptyPeriodChangeByTimeframe(),
      chartLineByTimeframe: emptyChartLinesByTimeframe(),
      orderBook: createEmptyOrderBook(),
      lotSize: Math.max(1, Math.floor(lotSize)),
      isBond,
      faceValueRub: meta?.initialFaceValueRub ?? null,
      maturityEpochMs: meta?.maturityEpochMs ?? null,
      nkdPerBondRub: 0,
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
  /** Статичный макросрез до исторических рядов по макро. */
  macroSnapshot: MarketMacroSnapshot;
  /**
   * Декларативные не-ценовые данные инструментов (lotSize, дивиденды, купоны, амортизации).
   * Используется сабсервисами MarketModule (corporateActions) и быстрыми вычислениями nkdPerBondRub.
   * Все сущности — read-only snapshot за время жизни процесса.
   */
  details: InstrumentDetailsCatalog;
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

export function createMarketModuleState(
  items: readonly MarketInstrumentCatalogItem[],
  chartSeriesInput: Partial<MarketChartSeriesBundle> = {}
): MarketModuleState {
  const catalogSorted = sortInstrumentCatalog(items);
  const details = loadInstrumentDetailsCatalog();
  const chartSeries: MarketChartSeriesBundle = {
    minute: normalizeBarsRecord(catalogSorted, chartSeriesInput.minute),
    dailyClose: normalizeBarsRecord(catalogSorted, chartSeriesInput.dailyClose),
    fiveMinute: normalizeBarsRecord(catalogSorted, chartSeriesInput.fiveMinute),
    thirtyMinute: normalizeBarsRecord(catalogSorted, chartSeriesInput.thirtyMinute),
    oneHour: normalizeBarsRecord(catalogSorted, chartSeriesInput.oneHour),
    weekly: normalizeBarsRecord(catalogSorted, chartSeriesInput.weekly),
  };
  return {
    ready: catalogSorted.length > 0,
    instrumentCatalog: catalogSorted,
    assetsBySymbol: buildAssetsBySymbol(catalogSorted, details),
    chartSeries,
    macroSnapshot: { ...STATIC_MARKET_MACRO_SNAPSHOT },
    details,
  };
}
