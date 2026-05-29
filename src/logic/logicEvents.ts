/** Имя события: сменился торговый день симуляции (после пропуска ночи или перерасхода сессии) */
export const TRADING_DAY_CHANGED = 'TRADING_DAY_CHANGED';
export const TRADE_EXECUTED = 'TRADE_EXECUTED';
export const TRADE_REJECTED = 'TRADE_REJECTED';
export const ORDER_PARTIALLY_FILLED = 'ORDER_PARTIALLY_FILLED';
export const ORDER_FILLED = 'ORDER_FILLED';
export const ORDER_CANCELLED = 'ORDER_CANCELLED';
export const ORDER_PLACED = 'ORDER_PLACED';

// === Слой A — рыночные декларации (MarketModule.corporateActions) ===
export const MARKET_DIVIDEND_DECLARED = 'MARKET_DIVIDEND_DECLARED';
export const MARKET_COUPON_DECLARED = 'MARKET_COUPON_DECLARED';
export const MARKET_BOND_MATURED = 'MARKET_BOND_MATURED';

// === Слой B — брокерские подтверждения клиенту (TradingModule.tax) ===
export const DIVIDEND_PAID = 'DIVIDEND_PAID';
export const COUPON_PAID = 'COUPON_PAID';
export const BOND_REDEEMED = 'BOND_REDEEMED';
export const COMMISSION_CHARGED = 'COMMISSION_CHARGED';
export const CAPITAL_GAIN_TAX_WITHHELD = 'CAPITAL_GAIN_TAX_WITHHELD';
export const NKD_SETTLED = 'NKD_SETTLED';

export type TradingDayChangedPayload = {
  mskDateYyyymmdd: string;
  dayIndex: number;
};

export type TradeSide = 'buy' | 'sell';

/**
 * Партия, потреблённая при продаже (FIFO).
 * Передаётся в `apply-trade-execution`, чтобы PortfolioModule корректно списал лоты,
 * а tax-сабсервис мог сослаться на исходные `pricePerUnitRub` и `nkdPaidAtBuyPerUnit` для базы налога.
 */
export type ConsumedLot = {
  lotId: string;
  consumedQty: number;
  pricePerUnitRub: number;
  nkdPaidAtBuyPerUnit: number;
};

export type TradeExecutionPayload = {
  tradeId: string;
  simulationEpochMs: number;
  symbol: string;
  assetKind: 'stock' | 'index' | 'bond' | 'fund';
  side: TradeSide;
  quantity: number;
  /** Чистая цена за единицу, ₽ (для бондов — без НКД). */
  priceRub: number;
  /** `priceRub × quantity`. Денежные «отвечающие» эффекты с учётом комиссии/НКД/налогов считаются отдельно. */
  amountRub: number;
  /** Комиссия 0.1% от `priceRub × quantity`. */
  commissionRub: number;
  /** НКД (только для bond): на buy — уплачено, на sell — получено. Для не-бондов 0. */
  nkdRub: number;
  /** Только для sell: реализованная прибыль (после вычета комиссии-sell и НКД-base). */
  realizedGainRub?: number;
  /** Только для sell: НДФЛ с реализованной прибыли (если > 0). */
  capitalGainTaxRub?: number;
  /** Только для sell: партии, FIFO-потреблённые этой сделкой. */
  consumedLots?: ConsumedLot[];
  source: 'right-panel' | 'modal';
};

export type TradeRejectReason =
  | 'INVALID_QUANTITY'
  | 'INVALID_LOT_QUANTITY'
  | 'ASSET_NOT_FOUND'
  | 'PRICE_UNAVAILABLE'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_POSITION_QTY'
  | 'INSUFFICIENT_ORDERBOOK_LIQUIDITY'
  | 'NON_TRADABLE_INSTRUMENT'
  | 'INSTRUMENT_NOT_TRADING';

export type OrderKind = 'market' | 'limit';

export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

export type RestingOrderView = {
  id: string;
  symbol: string;
  side: TradeSide;
  orderKind: OrderKind;
  limitPriceRub: number | null;
  quantity: number;
  filledQuantity: number;
  placedAtSimulationEpochMs: number;
  status: OrderStatus;
};

export type OrderLifecyclePayload = {
  order: RestingOrderView;
  simulationEpochMs: number;
  fillQuantity?: number;
  fillPriceRub?: number;
};

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
  lotSize?: number;
};

// === Слой A: рыночные декларации (агностично к пользователю) ===

export type MarketDividendDeclaredPayload = {
  ticker: string;
  perShareRub: number;
  simulationEpochMs: number;
};

export type MarketCouponDeclaredPayload = {
  ticker: string;
  perBondRub: number;
  simulationEpochMs: number;
};

export type MarketBondMaturedPayload = {
  ticker: string;
  faceValueRub: number;
  simulationEpochMs: number;
};

// === Слой B: брокерские подтверждения (TradingModule.tax → внешним подписчикам) ===

export type DividendPaidPayload = {
  ticker: string;
  qty: number;
  grossRub: number;
  taxRub: number;
  netRub: number;
  simulationEpochMs: number;
};

export type CouponPaidPayload = {
  ticker: string;
  qty: number;
  grossRub: number;
  taxRub: number;
  netRub: number;
  taxBaseRub: number;
  simulationEpochMs: number;
};

export type BondRedeemedPayload = {
  ticker: string;
  qty: number;
  faceValueRub: number;
  simulationEpochMs: number;
};

export type CommissionChargedPayload = {
  tradeId: string;
  symbol: string;
  amountRub: number;
  simulationEpochMs: number;
};

export type CapitalGainTaxWithheldPayload = {
  tradeId: string | null;
  symbol: string;
  gainRub: number;
  taxRub: number;
  simulationEpochMs: number;
};

export type NkdSettledPayload = {
  tradeId: string;
  symbol: string;
  side: TradeSide;
  amountRub: number;
  simulationEpochMs: number;
};

export interface LogicEventMap {
  [TRADING_DAY_CHANGED]: TradingDayChangedPayload;
  [TRADE_EXECUTED]: TradeExecutionPayload;
  [TRADE_REJECTED]: TradeRejectedPayload;
  [ORDER_PLACED]: OrderLifecyclePayload;
  [ORDER_PARTIALLY_FILLED]: OrderLifecyclePayload;
  [ORDER_FILLED]: OrderLifecyclePayload;
  [ORDER_CANCELLED]: OrderLifecyclePayload;
  [MARKET_DIVIDEND_DECLARED]: MarketDividendDeclaredPayload;
  [MARKET_COUPON_DECLARED]: MarketCouponDeclaredPayload;
  [MARKET_BOND_MATURED]: MarketBondMaturedPayload;
  [DIVIDEND_PAID]: DividendPaidPayload;
  [COUPON_PAID]: CouponPaidPayload;
  [BOND_REDEEMED]: BondRedeemedPayload;
  [COMMISSION_CHARGED]: CommissionChargedPayload;
  [CAPITAL_GAIN_TAX_WITHHELD]: CapitalGainTaxWithheldPayload;
  [NKD_SETTLED]: NkdSettledPayload;
}
