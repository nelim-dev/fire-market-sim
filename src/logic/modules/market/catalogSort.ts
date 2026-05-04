import type { AssetKind, MarketInstrumentCatalogItem } from './contracts';

/**
 * Детерминированный порядок: сначала `assetKind` (лексикографически), затем `ticker`.
 * Соответствует плану M3 (стабильный порядок для UI и тестов).
 */
export function compareInstrumentByKindThenTicker(
  a: MarketInstrumentCatalogItem,
  b: MarketInstrumentCatalogItem
): number {
  const kindCmp = a.assetKind.localeCompare(b.assetKind);
  if (kindCmp !== 0) {
    return kindCmp;
  }
  return a.ticker.localeCompare(b.ticker);
}

export function sortInstrumentCatalog(
  items: readonly MarketInstrumentCatalogItem[]
): MarketInstrumentCatalogItem[] {
  return [...items].sort(compareInstrumentByKindThenTicker);
}

/**
 * Группировка по типу актива; внутри каждой группы порядок — по тикеру
 * (уже гарантирован, если вход отсортирован через `sortInstrumentCatalog`).
 */
export function groupInstrumentsByAssetKind(
  items: readonly MarketInstrumentCatalogItem[]
): Record<AssetKind, MarketInstrumentCatalogItem[]> {
  const sorted = sortInstrumentCatalog(items);
  const buckets: Record<AssetKind, MarketInstrumentCatalogItem[]> = {
    bond: [],
    fund: [],
    index: [],
    stock: [],
  };
  for (const item of sorted) {
    buckets[item.assetKind].push(item);
  }
  return buckets;
}

/** Порядок секций в UI (можно менять без смены контракта группировки). */
export const MARKET_ASSET_KIND_SECTION_ORDER: readonly AssetKind[] = [
  'stock',
  'bond',
  'fund',
  'index',
] as const;

export function catalogSectionsInDisplayOrder(
  grouped: Record<AssetKind, MarketInstrumentCatalogItem[]>
): Array<{ assetKind: AssetKind; items: MarketInstrumentCatalogItem[] }> {
  return MARKET_ASSET_KIND_SECTION_ORDER.map((assetKind) => ({
    assetKind,
    items: grouped[assetKind] ?? [],
  }));
}
