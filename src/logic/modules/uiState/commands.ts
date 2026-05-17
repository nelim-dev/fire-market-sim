import type { LeftPanelMode, MarketOverviewFiltersState } from './state';

export type UiStateSetLeftPanelModeCommand = {
  type: 'uiState/set-left-panel-mode';
  mode: LeftPanelMode;
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
  | UiStateSelectInstrumentCommand
  | UiStateSetMarketOverviewFiltersCommand;
