import type {
  PortfolioAssetKind,
  PortfolioPosition,
  PortfolioState,
} from '@/logic/domain/portfolio';
import { DEMO_INITIAL_DEPOSIT_RUB } from '@/data/portfolio/demoPortfolioConstants';

export function positionMarketValueRub(p: PortfolioPosition): number {
  return p.quantity * p.lastPriceRub;
}

export function positionCostRub(p: PortfolioPosition): number {
  return p.quantity * p.avgPriceRub;
}

export function positionPnlRub(p: PortfolioPosition): number {
  return positionMarketValueRub(p) - positionCostRub(p);
}

export function positionPnlPct(p: PortfolioPosition): number {
  const c = positionCostRub(p);
  if (c === 0) return 0;
  return (positionPnlRub(p) / c) * 100;
}

export function securitiesMarketTotalRub(portfolio: PortfolioState): number {
  return portfolio.positions.reduce((s, p) => s + positionMarketValueRub(p), 0);
}

export function totalNavRub(portfolio: PortfolioState): number {
  return portfolio.cashRub + securitiesMarketTotalRub(portfolio);
}

export function portfolioProfitRub(portfolio: PortfolioState): number {
  return totalNavRub(portfolio) - DEMO_INITIAL_DEPOSIT_RUB;
}

export function portfolioProfitPct(portfolio: PortfolioState): number {
  return (portfolioProfitRub(portfolio) / DEMO_INITIAL_DEPOSIT_RUB) * 100;
}

export function positionsByKind(
  portfolio: PortfolioState,
  kind: PortfolioAssetKind
): PortfolioPosition[] {
  return portfolio.positions.filter((p) => p.kind === kind);
}

export function categoryMarketTotalRub(
  portfolio: PortfolioState,
  kind: PortfolioAssetKind
): number {
  return positionsByKind(portfolio, kind).reduce(
    (s, p) => s + positionMarketValueRub(p),
    0
  );
}

export function categoryPctOfPortfolio(
  portfolio: PortfolioState,
  kind: PortfolioAssetKind
): number {
  const t = totalNavRub(portfolio);
  if (t === 0) return 0;
  return (categoryMarketTotalRub(portfolio, kind) / t) * 100;
}

export function positionShareOfCategoryRub(
  p: PortfolioPosition,
  categoryTotalRub: number
): number {
  if (categoryTotalRub === 0) return 0;
  return (positionMarketValueRub(p) / categoryTotalRub) * 100;
}

/** Доля стоимости позиции от всего NAV (кэш + бумаги). */
export function positionShareOfTotalNavPct(
  p: PortfolioPosition,
  portfolio: PortfolioState
): number {
  const t = totalNavRub(portfolio);
  if (t === 0) return 0;
  return (positionMarketValueRub(p) / t) * 100;
}
