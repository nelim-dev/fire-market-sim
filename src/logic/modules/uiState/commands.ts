import type { LeftPanelMode, MarketOverviewFiltersState, PortfolioMainTab } from './state';

export type UiStateSetLeftPanelModeCommand = {
  type: 'uiState/set-left-panel-mode';
  mode: LeftPanelMode;
};

export type UiStateSetPortfolioMainTabCommand = {
  type: 'uiState/set-portfolio-main-tab';
  tab: PortfolioMainTab;
};

export type UiStateSelectInstrumentCommand = {
  type: 'uiState/select-instrument';
  symbol: string;
};

export type UiStateSetMarketOverviewFiltersCommand = {
  type: 'uiState/set-market-overview-filters';
  patch: Partial<MarketOverviewFiltersState>;
};

export type UiStateCommand =
  | UiStateSetLeftPanelModeCommand
  | UiStateSetPortfolioMainTabCommand
  | UiStateSelectInstrumentCommand
  | UiStateSetMarketOverviewFiltersCommand;
