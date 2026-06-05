export type AssetKind = 'index' | 'bond' | 'stock' | 'fund';

/**
 * Типизированная запись источника активов.
 * Добавление нового типа активов выполняется через новую запись в конфиге.
 */
export interface AssetSourceDirectory {
  kind: AssetKind;
  directoryName: string;
}

/**
 * Контракт результата сканирования файловой структуры рынка.
 * На шаге 1 это только typed boundary, без реализации чтения FS.
 */
export interface DiscoveredAssetFile {
  assetKind: AssetKind;
  directoryName: string;
  fileName: string;
  fileStem: string;
  absolutePath: string;
}

/**
 * Нормализованная карточка инструмента после discovery-этапа.
 * Исторические ряды и рыночные поля будут обогащаться на следующих шагах.
 */
export interface MarketInstrumentCatalogItem {
  assetKind: AssetKind;
  ticker: string;
  symbol: string;
  displayName: string;
  isin: string;
  sourceFilePath: string;
  /** Текст вкладки «О бумаге»; задаётся в `instrumentCopyOverrides.ts`. */
  description?: string;
}

/**
 * Контракт сканера источников рынка.
 * Реализация появится на следующем шаге.
 */
export interface MarketFileScanner {
  scan(rootDirectory: string): DiscoveredAssetFile[];
}

/**
 * Проверка имени директории источника.
 */
export function isAssetKindDirectoryName(
  value: string,
  sources: readonly AssetSourceDirectory[]
): value is AssetSourceDirectory['directoryName'] {
  return sources.some((source) => source.directoryName === value);
}

export function toCatalogItem(
  discovered: DiscoveredAssetFile
): MarketInstrumentCatalogItem {
  const symbol = discovered.fileStem.toUpperCase();
  return {
    assetKind: discovered.assetKind,
    ticker: symbol,
    symbol,
    displayName: discovered.fileStem,
    // До подключения полноценного справочника атрибутов оставляем заглушку.
    isin: `TBD-${symbol}`,
    sourceFilePath: discovered.absolutePath,
  };
}

/** Одна строка биржевого стакана (заглушка до симуляции лимитов). */
export interface OrderBookLevel {
  priceRub: number;
  qty: number;
}

/** Снимок стакана по активу (заглушка под подмодуль OrderBook). */
export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

