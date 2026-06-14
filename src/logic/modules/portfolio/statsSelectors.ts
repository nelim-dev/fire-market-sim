import type {
  CompositionSlice,
  LedgerEntryKind,
  PortfolioState,
  VsFireidxSnapshot,
} from '@/logic/domain/portfolio';
import { DEMO_INITIAL_DEPOSIT_RUB } from '@/data/portfolio/demoPortfolioConstants';
import {
  computeExcessReturnPct,
  computeReturnPct,
} from '@/logic/modules/market/fireidxComparison';
import {
  epochMsToYyyymm,
  loadInflationSchedule,
  resolveCumulativeCpiMultiplier,
} from '@/logic/modules/market/inflationSchedule';
import type { MarketAssetState } from '@/logic/modules/market/state';
import { resolveInstrumentPublicCode } from '@/logic/modules/market/selectors';
import {
  computePortfolioNavRub,
  findBaselineNavRub,
  positionTotalQuantity,
  selectLedgerByKind,
} from './selectors';

export function buildNkdBySymbolFromMarket(
  market: MarketModuleState
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [symbol, asset] of Object.entries(market.assetsBySymbol)) {
    if (asset.nkdPerBondRub > 0) {
      out[symbol.toUpperCase()] = asset.nkdPerBondRub;
    }
  }
  return out;
}

const TAX_KINDS: readonly LedgerEntryKind[] = [
  'dividend-tax',
  'coupon-tax',
  'capital-gain-tax',
];

export type PortfolioStatsViewModel = {
  nominalProfitRub: number;
  nominalProfitPct: number;
  realProfitRub: number;
  tradeCount: number;
  totalCommissionRub: number;
  totalTaxRub: number;
  compositionSlices: CompositionSlice[];
  vsFireidx: {
    excessReturnPct: number;
    portfolioReturnPct: number;
    fireidxReturnPct: number;
    mode: VsFireidxSnapshot['mode'];
  } | null;
};

export function computePortfolioNavRubWithNkd(
  portfolio: PortfolioState,
  nkdBySymbol: Readonly<Record<string, number>>
): number {
  let nav = portfolio.cashRub;
  for (const p of portfolio.positions) {
    const qty = positionTotalQuantity(p);
    const nkd =
      p.kind === 'bond'
        ? (nkdBySymbol[p.ticker.toUpperCase()] ?? 0)
        : 0;
    nav += qty * (p.lastPriceRub + nkd);
  }
  return nav;
}

export function selectPortfolioNominalProfitRub(
  navWithNkd: number
): number {
  return navWithNkd - DEMO_INITIAL_DEPOSIT_RUB;
}

export function selectPortfolioRealProfitRub(
  navWithNkd: number,
  simulationEpochMs: number,
  portfolio: PortfolioState
): number {
  const schedule = loadInflationSchedule();
  const toYyyymm = epochMsToYyyymm(simulationEpochMs);
  const fromYyyymm =
    portfolio.navHistory.length > 0
      ? epochMsToYyyymm(portfolio.navHistory[0]!.simulationEpochMs)
      : toYyyymm;
  const cpi = resolveCumulativeCpiMultiplier(fromYyyymm, toYyyymm, schedule);
  const realNav = cpi > 0 ? navWithNkd / cpi : navWithNkd;
  return realNav - DEMO_INITIAL_DEPOSIT_RUB;
}

export function selectPortfolioTradeCount(portfolio: PortfolioState): number {
  return selectLedgerByKind(portfolio, ['trade-buy', 'trade-sell']).length;
}

export function selectPortfolioTotalCommissionRub(
  portfolio: PortfolioState
): number {
  return selectLedgerByKind(portfolio, ['commission']).reduce(
    (sum, entry) => sum + Math.abs(entry.amountRub),
    0
  );
}

export function selectPortfolioTotalTaxRub(portfolio: PortfolioState): number {
  return selectLedgerByKind(portfolio, TAX_KINDS).reduce(
    (sum, entry) => sum + Math.abs(entry.amountRub),
    0
  );
}

export function selectPortfolioCompositionSlices(
  portfolio: PortfolioState,
  nkdBySymbol: Readonly<Record<string, number>>,
  assetsBySymbol?: Readonly<Record<string, MarketAssetState>>
): CompositionSlice[] {
  const nav = computePortfolioNavRubWithNkd(portfolio, nkdBySymbol);
  if (nav <= 0) return [];

  const slices: CompositionSlice[] = [];
  if (portfolio.cashRub > 0) {
    slices.push({
      id: 'cash',
      ticker: 'Кэш',
      label: 'Денежные средства',
      valueRub: portfolio.cashRub,
      pct: (portfolio.cashRub / nav) * 100,
    });
  }
  for (const p of portfolio.positions) {
    const qty = positionTotalQuantity(p);
    if (qty <= 0) continue;
    const nkd =
      p.kind === 'bond'
        ? (nkdBySymbol[p.ticker.toUpperCase()] ?? 0)
        : 0;
    const valueRub = qty * (p.lastPriceRub + nkd);
    if (valueRub <= 0) continue;
    const sym = p.ticker.toUpperCase();
    const asset = assetsBySymbol?.[sym];
    const label = asset?.displayName ?? p.displayName ?? sym;
    const publicCode = assetsBySymbol
      ? resolveInstrumentPublicCode(assetsBySymbol, sym)
      : sym;
    slices.push({
      id: p.id,
      ticker: publicCode,
      label,
      valueRub,
      pct: (valueRub / nav) * 100,
    });
  }
  return slices;
}

export function selectPortfolioVsFireidxExcess(
  portfolio: PortfolioState,
  navWithNkd: number,
  indexNow: number | null
): PortfolioStatsViewModel['vsFireidx'] {
  const snap = portfolio.vsFireidxSnapshot;
  if (!snap || indexNow == null || !Number.isFinite(indexNow) || indexNow <= 0) {
    return null;
  }
  const portfolioReturnPct = computeReturnPct(navWithNkd, snap.navBaselineRub);
  const fireidxReturnPct = computeReturnPct(indexNow, snap.indexBaselineLevel);
  return {
    excessReturnPct: computeExcessReturnPct(
      navWithNkd,
      snap.navBaselineRub,
      indexNow,
      snap.indexBaselineLevel
    ),
    portfolioReturnPct,
    fireidxReturnPct,
    mode: snap.mode,
  };
}

export function buildPortfolioStatsViewModel(input: {
  portfolio: PortfolioState;
  simulationEpochMs: number;
  nkdBySymbol: Readonly<Record<string, number>>;
  indexNow: number | null;
  assetsBySymbol?: Readonly<Record<string, MarketAssetState>>;
}): PortfolioStatsViewModel {
  const navWithNkd = computePortfolioNavRubWithNkd(
    input.portfolio,
    input.nkdBySymbol
  );
  const nominalProfitRub = selectPortfolioNominalProfitRub(navWithNkd);
  const nominalProfitPct =
    DEMO_INITIAL_DEPOSIT_RUB > 0
      ? (nominalProfitRub / DEMO_INITIAL_DEPOSIT_RUB) * 100
      : 0;

  return {
    nominalProfitRub,
    nominalProfitPct,
    realProfitRub: selectPortfolioRealProfitRub(
      navWithNkd,
      input.simulationEpochMs,
      input.portfolio
    ),
    tradeCount: selectPortfolioTradeCount(input.portfolio),
    totalCommissionRub: selectPortfolioTotalCommissionRub(input.portfolio),
    totalTaxRub: selectPortfolioTotalTaxRub(input.portfolio),
    compositionSlices:
      input.portfolio.compositionSnapshot?.slices ??
      selectPortfolioCompositionSlices(
        input.portfolio,
        input.nkdBySymbol,
        input.assetsBySymbol
      ),
    vsFireidx: selectPortfolioVsFireidxExcess(
      input.portfolio,
      navWithNkd,
      input.indexNow
    ),
  };
}

/** NAV на якоре vsFireidx (или депозит, если истории нет). */
export function resolveNavBaselineForFireidxComparison(
  portfolio: PortfolioState,
  baselineEpochMs: number
): number {
  return (
    findBaselineNavRub(portfolio, baselineEpochMs) ?? DEMO_INITIAL_DEPOSIT_RUB
  );
}

/** @deprecated используйте computePortfolioNavRubWithNkd для UI без НКД-контекста */
export { computePortfolioNavRub };
