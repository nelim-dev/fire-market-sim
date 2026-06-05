import type { GameState } from '@/logic/managers/LogicManager';
import type { MarketInstrumentCatalogItem } from '@/logic/modules/market/contracts';
import { selectIsInstrumentActiveOnMarket } from '@/logic/modules/market/selectors';
import { selectEducationIsSymbolUnlocked } from '@/logic/modules/education/selectors';
import type { LeftPanelMode, MarketOverviewAssetKindFilter } from './state';

export interface MarketOverviewInstrumentRow {
  symbol: string;
  ticker: string;
  displayName: string;
  assetKind: MarketInstrumentCatalogItem['assetKind'];
  currentPriceRub: number | null;
  changePct1d: number | null;
  isUnlocked: boolean;
}

export interface MarketOverviewRowsViewModel {
  available: MarketOverviewInstrumentRow[];
  locked: MarketOverviewInstrumentRow[];
}

export const selectUiStateModule = (state: GameState) => state.uiState;

export const selectUiLeftPanelMode = (state: GameState): LeftPanelMode =>
  state.uiState.leftPanelMode;

export const selectUiSelectedSymbol = (state: GameState): string | null =>
  state.uiState.selectedSymbol;

export const selectUiMarketOverviewFilters = (state: GameState) =>
  state.uiState.marketOverview;

function matchesSearch(
  item: MarketInstrumentCatalogItem,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return (
    item.ticker.toLowerCase().includes(q) ||
    item.symbol.toLowerCase().includes(q) ||
    item.isin.toLowerCase().includes(q) ||
    item.displayName.toLowerCase().includes(q)
  );
}

function matchesAssetKind(
  item: MarketInstrumentCatalogItem,
  filter: MarketOverviewAssetKindFilter
): boolean {
  return filter === 'all' || item.assetKind === filter;
}

function toOverviewRow(
  state: GameState,
  item: MarketInstrumentCatalogItem
): MarketOverviewInstrumentRow {
  const symbol = item.symbol.toUpperCase();
  const asset = state.market.assetsBySymbol[symbol];
  return {
    symbol,
    ticker: item.isin.startsWith('TBD-') ? item.ticker : item.isin,
    displayName: item.displayName,
    assetKind: item.assetKind,
    currentPriceRub: asset?.currentPriceRub ?? null,
    changePct1d: asset?.periodChangePctByTimeframe['1d'] ?? null,
    isUnlocked: selectEducationIsSymbolUnlocked(symbol)(state),
  };
}

export const selectMarketOverviewRows = (
  state: GameState
): MarketOverviewRowsViewModel => {
  const filters = state.uiState.marketOverview;
  const available: MarketOverviewInstrumentRow[] = [];
  const locked: MarketOverviewInstrumentRow[] = [];

  for (const item of state.market.instrumentCatalog) {
    if (!selectIsInstrumentActiveOnMarket(item.symbol)(state)) {
      continue;
    }
    if (!matchesSearch(item, filters.searchQuery)) {
      continue;
    }
    if (!matchesAssetKind(item, filters.assetKindFilter)) {
      continue;
    }
    const row = toOverviewRow(state, item);
    if (row.isUnlocked) {
      if (filters.showAvailable) {
        available.push(row);
      }
    } else if (filters.showLocked) {
      locked.push(row);
    }
  }

  return { available, locked };
};
