import type {
  OrderKind,
  OrderStatus,
  TradeExecutionPayload,
  TradeRejectedPayload,
} from '@/logic/logicEvents';

export interface RestingOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderKind: OrderKind;
  limitPriceRub: number | null;
  quantity: number;
  filledQuantity: number;
  placedAtSimulationEpochMs: number;
  status: OrderStatus;
  source: 'right-panel' | 'modal';
}

export function orderRemainingQuantity(order: RestingOrder): number {
  return Math.max(0, order.quantity - order.filledQuantity);
}

export interface TradingModuleState {
  ready: boolean;
  lastExecution: TradeExecutionPayload | null;
  lastRejection: TradeRejectedPayload | null;
  openOrders: RestingOrder[];
}
