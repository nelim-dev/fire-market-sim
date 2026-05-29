import type { OrderBookLevel, OrderBookSnapshot } from '@/logic/modules/market/contracts';

export type BookFillSlice = {
  priceRub: number;
  qty: number;
};

export type OrderBookWalkResult = {
  fillQty: number;
  vwapPriceRub: number;
  slices: BookFillSlice[];
};

function eligibleLevels(
  side: 'buy' | 'sell',
  orderKind: 'market' | 'limit',
  limitPriceRub: number | null,
  book: OrderBookSnapshot
): OrderBookLevel[] {
  if (side === 'buy') {
    const asks = [...book.asks].sort((a, b) => a.priceRub - b.priceRub);
    if (orderKind === 'market') {
      return asks;
    }
    if (limitPriceRub == null || !Number.isFinite(limitPriceRub)) {
      return [];
    }
    return asks.filter((level) => level.priceRub <= limitPriceRub);
  }
  const bids = [...book.bids].sort((a, b) => b.priceRub - a.priceRub);
  if (orderKind === 'market') {
    return bids;
  }
  if (limitPriceRub == null || !Number.isFinite(limitPriceRub)) {
    return [];
  }
  return bids.filter((level) => level.priceRub >= limitPriceRub);
}

export function sumEligibleLiquidity(
  side: 'buy' | 'sell',
  orderKind: 'market' | 'limit',
  limitPriceRub: number | null,
  book: OrderBookSnapshot
): number {
  return eligibleLevels(side, orderKind, limitPriceRub, book).reduce(
    (sum, level) => sum + Math.max(0, level.qty),
    0
  );
}

export function walkOrderBook(
  side: 'buy' | 'sell',
  orderKind: 'market' | 'limit',
  limitPriceRub: number | null,
  maxQty: number,
  book: OrderBookSnapshot
): OrderBookWalkResult {
  const levels = eligibleLevels(side, orderKind, limitPriceRub, book);
  let remaining = maxQty;
  let notional = 0;
  let filled = 0;
  const slices: BookFillSlice[] = [];
  for (const level of levels) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, Math.max(0, level.qty));
    if (take <= 0) {
      continue;
    }
    slices.push({ priceRub: level.priceRub, qty: take });
    notional += level.priceRub * take;
    filled += take;
    remaining -= take;
  }
  return {
    fillQty: filled,
    vwapPriceRub: filled > 0 ? notional / filled : 0,
    slices,
  };
}
