import type { OrderBookLevel, OrderBookSnapshot } from './contracts';
import type { BookFillSlice } from '@/logic/modules/trading/orderBookMatch';

function consumeSide(
  levels: OrderBookLevel[],
  slices: readonly BookFillSlice[]
): OrderBookLevel[] {
  const remaining = new Map<number, number>();
  for (const slice of slices) {
    const key = Math.round(slice.priceRub * 100);
    remaining.set(key, (remaining.get(key) ?? 0) + slice.qty);
  }
  return levels
    .map((level) => {
      const key = Math.round(level.priceRub * 100);
      const take = remaining.get(key) ?? 0;
      if (take <= 0) {
        return level;
      }
      const nextQty = Math.max(0, level.qty - take);
      remaining.set(key, Math.max(0, take - level.qty));
      return { ...level, qty: nextQty };
    })
    .filter((level) => level.qty > 0);
}

/** Уменьшает ликвидность стакана после сделки (taker buy → asks, taker sell → bids). */
export function applyOrderBookConsumption(
  book: OrderBookSnapshot,
  takerSide: 'buy' | 'sell',
  slices: readonly BookFillSlice[]
): OrderBookSnapshot {
  if (slices.length === 0) {
    return book;
  }
  if (takerSide === 'buy') {
    return {
      bids: book.bids,
      asks: consumeSide(book.asks, slices),
    };
  }
  return {
    bids: consumeSide(book.bids, slices),
    asks: book.asks,
  };
}
