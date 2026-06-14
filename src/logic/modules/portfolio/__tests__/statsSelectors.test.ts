import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PortfolioState } from '@/logic/domain/portfolio';
import { DEMO_INITIAL_DEPOSIT_RUB } from '@/data/portfolio/demoPortfolioConstants';
import {
  buildPortfolioStatsViewModel,
  computePortfolioNavRubWithNkd,
  selectPortfolioCompositionSlices,
  selectPortfolioTradeCount,
  selectPortfolioTotalCommissionRub,
  selectPortfolioTotalTaxRub,
  selectPortfolioVsFireidxExcess,
} from '../statsSelectors';

function emptyPortfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    cashRub: DEMO_INITIAL_DEPOSIT_RUB,
    cashReservedRub: 0,
    reservedQtyBySymbol: {},
    positions: [],
    upcomingPayments: [],
    ledger: [],
    navHistory: [],
    compositionSnapshot: null,
    vsFireidxSnapshot: null,
    ...overrides,
  };
}

describe('statsSelectors', () => {
  it('trade count = buy + sell', () => {
    const portfolio = emptyPortfolio({
      ledger: [
        {
          id: '1',
          kind: 'trade-buy',
          simulationEpochMs: 0,
          ticker: 'SBER',
          amountRub: -100,
        },
        {
          id: '2',
          kind: 'trade-sell',
          simulationEpochMs: 0,
          ticker: 'SBER',
          amountRub: 200,
        },
        {
          id: '3',
          kind: 'commission',
          simulationEpochMs: 0,
          ticker: 'SBER',
          amountRub: -1,
        },
      ],
    });
    assert.equal(selectPortfolioTradeCount(portfolio), 2);
  });

  it('commission and tax sums use abs(amount)', () => {
    const portfolio = emptyPortfolio({
      ledger: [
        {
          id: 'c1',
          kind: 'commission',
          simulationEpochMs: 0,
          ticker: 'SBER',
          amountRub: -10,
        },
        {
          id: 't1',
          kind: 'dividend-tax',
          simulationEpochMs: 0,
          ticker: 'SBER',
          amountRub: -3,
        },
      ],
    });
    assert.equal(selectPortfolioTotalCommissionRub(portfolio), 10);
    assert.equal(selectPortfolioTotalTaxRub(portfolio), 3);
  });

  it('computePortfolioNavRubWithNkd adds bond NKD', () => {
    const portfolio = emptyPortfolio({
      cashRub: 0,
      positions: [
        {
          id: 'b1',
          kind: 'bond',
          ticker: 'BND',
          displayName: 'Bond',
          lots: [
            {
              id: 'l1',
              purchaseEpochMs: 0,
              quantity: 2,
              pricePerUnitRub: 900,
              nkdPaidAtBuyPerUnit: 0,
            },
          ],
          lastPriceRub: 950,
        },
      ],
    });
    const nav = computePortfolioNavRubWithNkd(portfolio, { BND: 25 });
    assert.equal(nav, 2 * (950 + 25));
  });

  it('vsFireidx excess: portfolio +6%, index +5% → +1%', () => {
    const portfolio = emptyPortfolio({
      vsFireidxSnapshot: {
        recordedAtEpochMs: 1000,
        baselineEpochMs: 0,
        navBaselineRub: 100_000,
        indexBaselineLevel: 1000,
        mode: 'rolling-1y',
      },
    });
    const excess = selectPortfolioVsFireidxExcess(portfolio, 106_000, 1050);
    assert.ok(excess);
    assert.ok(Math.abs(excess!.excessReturnPct - 1) < 0.01);
    assert.ok(Math.abs(excess!.portfolioReturnPct - 6) < 0.01);
    assert.ok(Math.abs(excess!.fireidxReturnPct - 5) < 0.01);
  });

  it('composition slices use market display names and public codes', () => {
    const portfolio = emptyPortfolio({
      cashRub: 0,
      positions: [
        {
          id: 'p1',
          kind: 'stock',
          ticker: 'RU0009029540',
          displayName: 'RU0009029540',
          lots: [
            {
              id: 'l1',
              purchaseEpochMs: 0,
              quantity: 10,
              pricePerUnitRub: 100,
              nkdPaidAtBuyPerUnit: 0,
            },
          ],
          lastPriceRub: 110,
        },
      ],
    });
    const assetsBySymbol = {
      RU0009029540: {
        displayName: 'Сокол-Авиа',
        isin: 'SOKL-AV',
      },
    } as const;
    const slices = selectPortfolioCompositionSlices(portfolio, {}, assetsBySymbol);
    assert.equal(slices.length, 1);
    assert.equal(slices[0]!.label, 'Сокол-Авиа');
    assert.equal(slices[0]!.ticker, 'SOKL-AV');
  });

  it('buildPortfolioStatsViewModel nominal profit vs deposit', () => {
    const portfolio = emptyPortfolio({ cashRub: DEMO_INITIAL_DEPOSIT_RUB + 910 });
    const vm = buildPortfolioStatsViewModel({
      portfolio,
      simulationEpochMs: Date.UTC(2024, 0, 15),
      nkdBySymbol: {},
      indexNow: null,
    });
    assert.equal(vm.nominalProfitRub, 910);
  });
});
