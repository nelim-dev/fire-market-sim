import type { TradeExecutionPayload, TradeRejectedPayload } from '@/logic/logicEvents';

export interface PendingMarketOrder {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  source: 'right-panel' | 'modal';
  queuedAtSimulationEpochMs: number;
}

export interface TradingModuleState {
  ready: boolean;
  lastExecution: TradeExecutionPayload | null;
  lastRejection: TradeRejectedPayload | null;
  pendingOrders: PendingMarketOrder[];
}

