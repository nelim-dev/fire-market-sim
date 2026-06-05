import { INSTRUMENT_COPY_BY_SYMBOL } from '../../../data/instrumentCopyOverrides';
import type { MarketInstrumentCatalogItem } from './contracts';

/** Подмешивает displayName, isin и description из ручного справочника. */
export function applyInstrumentCopyToCatalog(
  items: readonly MarketInstrumentCatalogItem[]
): MarketInstrumentCatalogItem[] {
  return items.map((item) => {
    const copy = INSTRUMENT_COPY_BY_SYMBOL[item.symbol.toUpperCase()];
    if (!copy) {
      return item;
    }
    return {
      ...item,
      displayName: copy.displayName,
      isin: copy.isin,
      ticker: copy.isin,
      description: copy.description,
    };
  });
}
