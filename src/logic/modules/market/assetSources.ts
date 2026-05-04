import type { AssetSourceDirectory } from './contracts';

/**
 * Единый реестр папок источников исторических данных по типам активов.
 * Используется MarketModule как source-of-truth для автообнаружения.
 */
export const MARKET_ASSET_SOURCE_DIRECTORIES: readonly AssetSourceDirectory[] = [
  { kind: 'index', directoryName: 'indexes' },
  { kind: 'bond', directoryName: 'bonds' },
  { kind: 'stock', directoryName: 'tickers' },
  { kind: 'fund', directoryName: 'fonds' },
] as const;

/**
 * Набор имён директорий для быстрого membership-check.
 */
export const MARKET_ASSET_SOURCE_DIRECTORY_NAMES = new Set(
  MARKET_ASSET_SOURCE_DIRECTORIES.map((item) => item.directoryName)
);

