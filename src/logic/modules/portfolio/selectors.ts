import type { PortfolioState } from './state';

export const selectPortfolioCashRub = (state: PortfolioState): number =>
  state.cashRub;

