/** Имя события: сменился торговый день симуляции (после пропуска ночи или перерасхода сессии) */
export const TRADING_DAY_CHANGED = 'TRADING_DAY_CHANGED';
export const TRADE_EXECUTED = 'TRADE_EXECUTED';
export const TRADE_REJECTED = 'TRADE_REJECTED';

export type TradingDayChangedPayload = {
  mskDateYyyymmdd: string;
  dayIndex: number;
};

export type TradeSide = 'buy' | 'sell';

export type TradeExecutionPayload = {
  tradeId: string;
  simulationEpochMs: number;
  symbol: string;
  assetKind: 'stock' | 'index' | 'bond' | 'fund';
  side: TradeSide;
  quantity: number;
  priceRub: number;
  amountRub: number;
  source: 'right-panel' | 'modal';
};

export type TradeRejectReason =
  | 'INVALID_QUANTITY'
  | 'ASSET_NOT_FOUND'
  | 'PRICE_UNAVAILABLE'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_POSITION_QTY'
  | 'INSUFFICIENT_ORDERBOOK_LIQUIDITY';

export type TradeRejectedPayload = {
  simulationEpochMs: number;
  symbol: string;
  side: TradeSide;
  requestedQuantity: number;
  reason: TradeRejectReason;
  availableCashRub?: number;
  requiredCashRub?: number;
  availableQuantity?: number;
  availableOrderbookQuantity?: number;
};

export interface LogicEventMap {
  [TRADING_DAY_CHANGED]: TradingDayChangedPayload;
  [TRADE_EXECUTED]: TradeExecutionPayload;
  [TRADE_REJECTED]: TradeRejectedPayload;
}
