import type { MarketInstrumentCatalogItem } from './contracts';
import { FIREIDX_SYMBOL } from './compositeIndex';

/** FIREIDX загружается из `fonds/FIREIDX.txt` / SQLite как обычный фонд. */
export function isFireidxPrebakedInCatalog(
  catalog: readonly MarketInstrumentCatalogItem[]
): boolean {
  const row = catalog.find((item) => item.symbol.toUpperCase() === FIREIDX_SYMBOL);
  return Boolean(row?.sourceFilePath?.trim());
}

export function findFireidxCatalogItem(
  catalog: readonly MarketInstrumentCatalogItem[]
): MarketInstrumentCatalogItem | undefined {
  return catalog.find((item) => item.symbol.toUpperCase() === FIREIDX_SYMBOL);
}
