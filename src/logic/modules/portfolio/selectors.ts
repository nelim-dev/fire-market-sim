import type { PortfolioState } from './state';

export const selectPortfolioCashRub = (state: PortfolioState): number =>
  state.cashRub;

export const selectPortfolioTradeLedger = (state: PortfolioState) =>
  state.tradeLedger;

