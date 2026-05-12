import type {
  PortfolioPosition,
  PortfolioState,
  PositionLot,
  UpcomingPayment,
} from '@/logic/domain/portfolio';
import { DEMO_INITIAL_CASH_RUB } from './demoPortfolioConstants';

const PRICE_SCALE = 1.2;

/**
 * Демо-партия: один лот с заданным количеством и средней ценой.
 * Используется только в сиде — реальные сделки создают лоты в TradingModule.
 */
function demoLot(
  id: string,
  quantity: number,
  pricePerUnitRub: number
): PositionLot {
  return {
    id,
    purchaseEpochMs: 0,
    quantity,
    pricePerUnitRub,
    nkdPaidAtBuyPerUnit: 0,
  };
}

function position(args: {
  id: string;
  kind: PortfolioPosition['kind'];
  ticker: string;
  displayName: string;
  secondaryId?: string;
  quantity: number;
  lastPriceRub: number;
  avgPriceRub?: number;
}): PortfolioPosition {
  const avg =
    args.avgPriceRub ??
    Math.round((args.lastPriceRub / PRICE_SCALE) * 100) / 100;
  return {
    id: args.id,
    kind: args.kind,
    ticker: args.ticker,
    displayName: args.displayName,
    secondaryId: args.secondaryId,
    lastPriceRub: args.lastPriceRub,
    lots: [demoLot(`${args.id}-lot-0`, args.quantity, avg)],
  };
}

/**
 * Демо-портфель: три реальных актива (SBER/SU26227RMFS7/SBMM) + кэш.
 * Цены и avg — это исторические ориентиры на момент старта симуляции;
 * `lastPriceRub` будет перезаписан `applyMarketQuotesForSimulationEpoch` после
 * первой пары шагов рынка.
 */
export function buildDemoPortfolio(): PortfolioState {
  const positions: PortfolioPosition[] = [
    position({
      id: 'pos-sber',
      kind: 'stock',
      ticker: 'SBER',
      displayName: 'Сбербанк',
      quantity: 10,
      lastPriceRub: 280,
      avgPriceRub: 200,
    }),
    position({
      id: 'pos-ofz-26227',
      kind: 'bond',
      ticker: 'SU26227RMFS7',
      displayName: 'ОФЗ 26227',
      secondaryId: 'RU000A1007F4',
      quantity: 2,
      lastPriceRub: 950,
      avgPriceRub: 900,
    }),
    position({
      id: 'pos-sbmm',
      kind: 'fund',
      ticker: 'SBMM',
      displayName: 'SBMM (фонд денежного рынка)',
      quantity: 10,
      lastPriceRub: 14,
      avgPriceRub: 13,
    }),
  ];

  // upcomingPayments — будут заполняться реальными MARKET_*_DECLARED событиями
  // (dividend/coupon) при движении симуляции.
  const upcomingPayments: UpcomingPayment[] = [];

  return {
    cashRub: DEMO_INITIAL_CASH_RUB,
    positions,
    upcomingPayments,
    ledger: [],
    navHistory: [],
  };
}
