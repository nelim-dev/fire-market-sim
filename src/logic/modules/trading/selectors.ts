import type { GameState } from '@/logic/managers/LogicManager';
import {
  orderRemainingQuantity,
  type RestingOrder,
} from './state';

export function selectOpenOrders(state: GameState): RestingOrder[] {
  return state.trading.openOrders.filter(
    (o) => o.status === 'open' || o.status === 'partially_filled'
  );
}

export function selectOrderById(
  state: GameState,
  orderId: string
): RestingOrder | undefined {
  return state.trading.openOrders.find((o) => o.id === orderId);
}

export function toOrderView(order: RestingOrder) {
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    orderKind: order.orderKind,
    limitPriceRub: order.limitPriceRub,
    quantity: order.quantity,
    filledQuantity: order.filledQuantity,
    remainingQuantity: orderRemainingQuantity(order),
    placedAtSimulationEpochMs: order.placedAtSimulationEpochMs,
    status: order.status,
  };
}
