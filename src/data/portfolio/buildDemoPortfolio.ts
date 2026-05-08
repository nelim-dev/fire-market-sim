import type {
  PortfolioPosition,
  PortfolioState,
  UpcomingPayment,
} from '@/logic/domain/portfolio';
import { DEMO_INITIAL_CASH_RUB } from './demoPortfolioConstants';

const PRICE_SCALE = 1.2;

function position(
  p: Omit<PortfolioPosition, 'avgPriceRub'> & { avgPriceRub?: number }
): PortfolioPosition {
  const avg =
    p.avgPriceRub ?? Math.round((p.lastPriceRub / PRICE_SCALE) * 100) / 100;
  return {
    ...p,
    avgPriceRub: avg,
  };
}

/**
 * Демо-портфель: акции, индексы, облигации, фонды + ближайшие выплаты.
 * Цены зашиты (M2); после появления рынка будут пересчитываться из market.
 */
export function buildDemoPortfolio(): PortfolioState {
  const positions: PortfolioPosition[] = [
    position({
      id: 'pos-sber',
      kind: 'stock',
      ticker: 'SBER',
      displayName: 'Севербанк',
      quantity: 100,
      lastPriceRub: 213.05,
    }),
    position({
      id: 'pos-yst',
      kind: 'stock',
      ticker: 'NLMK',
      displayName: 'ЮСталь',
      quantity: 426,
      lastPriceRub: 100,
    }),
    position({
      id: 'pos-roil',
      kind: 'stock',
      ticker: 'ROSN',
      displayName: 'РеОил',
      quantity: 3610,
      lastPriceRub: 10,
    }),
    position({
      id: 'pos-rgbi',
      kind: 'index',
      ticker: 'RGBI',
      displayName: 'Индекс RGBI',
      quantity: 1,
      lastPriceRub: 10_658,
    }),
    position({
      id: 'pos-rtsi',
      kind: 'index',
      ticker: 'RTSI',
      displayName: 'Индекс RTSI',
      quantity: 5,
      lastPriceRub: 1_280.5,
    }),
    position({
      id: 'pos-ofz',
      kind: 'bond',
      ticker: 'ОГЗ 512',
      displayName: 'ОГЗ 512',
      secondaryId: 'CH9876543210',
      quantity: 296,
      lastPriceRub: 270.05,
    }),
    position({
      id: 'pos-sv-b12',
      kind: 'bond',
      ticker: 'СеверБ12Р',
      displayName: 'СеверБ12Р',
      secondaryId: 'IE9876543217',
      quantity: 42,
      lastPriceRub: 475.9,
    }),
    position({
      id: 'pos-tmos',
      kind: 'fund',
      ticker: 'TMOS',
      displayName: 'Сбер — фонд TMOS',
      quantity: 50,
      /** Доводит сумму бумаг до ~300k при кэше 150k → «Всего» ~450k */
      lastPriceRub: 1660.24,
    }),
  ];

  const upcomingPayments: UpcomingPayment[] = [
    {
      id: 'pay-1',
      kind: 'dividend',
      assetName: 'ЮСталь',
      amountRub: 2_419,
      dueSimulationEpochMs: Date.UTC(2021, 3, 24),
    },
    {
      id: 'pay-2',
      kind: 'dividend',
      assetName: 'ОГЗ 512',
      amountRub: 1_428,
      dueSimulationEpochMs: Date.UTC(2021, 4, 6),
    },
    {
      id: 'pay-3',
      kind: 'coupon',
      assetName: 'СеверБ12Р',
      amountRub: 452,
      dueSimulationEpochMs: Date.UTC(2021, 5, 27),
    },
  ];

  return {
    cashRub: DEMO_INITIAL_CASH_RUB,
    positions,
    upcomingPayments,
    tradeLedger: [],
  };
}
