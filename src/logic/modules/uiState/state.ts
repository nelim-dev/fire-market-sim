import type { AssetKind } from '@/logic/modules/market/contracts';

export type LeftPanelMode = 'portfolio' | 'market-overview';

export type MarketOverviewAssetKindFilter = AssetKind | 'all';

export interface MarketOverviewFiltersState {
  searchQuery: string;
  assetKindFilter: MarketOverviewAssetKindFilter;
  showAvailable: boolean;
  showLocked: boolean;
}

export interface UiStateModuleState {
  leftPanelMode: LeftPanelMode;
  selectedSymbol: string | null;
  marketOverview: MarketOverviewFiltersState;
  ready: boolean;
}

export function normalizeUiSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export const DEFAULT_MARKET_OVERVIEW_FILTERS: MarketOverviewFiltersState = {
  searchQuery: '',
  assetKindFilter: 'all',
  showAvailable: true,
  showLocked: true,
};
