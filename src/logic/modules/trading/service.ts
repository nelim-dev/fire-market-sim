import {
  TRADE_EXECUTED,
  TRADE_REJECTED,
  COMMISSION_CHARGED,
  CAPITAL_GAIN_TAX_WITHHELD,
  NKD_SETTLED,
  ORDER_PLACED,
  ORDER_PARTIALLY_FILLED,
  ORDER_FILLED,
  ORDER_CANCELLED,
  type ConsumedLot,
  type OrderLifecyclePayload,
  type RestingOrderView,
  type TradeExecutionPayload,
  type TradeRejectedPayload,
} from '@/logic/logicEvents';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
  TradingCancelOrderCommand,
  TradingSubmitLimitOrderCommand,
  TradingSubmitMarketOrderCommand,
} from '@/logic/modules/contracts';
import type { GameState } from '@/logic/managers/LogicManager';
import { isInstrumentActiveOnMarket } from '@/logic/modules/market/instrumentLifecycle';
import { positionTotalQuantity } from '@/logic/modules/portfolio/selectors';
import { calcCapitalGainFifo } from './tax/capitalGainHandler';
import { NDFL_RATE } from './tax/taxCalculator';
import { TaxSubservice } from './tax/corporateActionHandler';
import type { ModuleAttachContext } from '@/logic/modules/contracts';
import {
  orderRemainingQuantity,
  type RestingOrder,
  type TradingModuleState,
} from './state';
import { walkOrderBook } from './orderBookMatch';
import { toOrderView } from './selectors';

const TRADE_COMMISSION_RATE = 0.001;

function asUpperSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function calcCommissionRub(priceRub: number, quantity: number): number {
  const raw = priceRub * quantity * TRADE_COMMISSION_RATE;
  return Math.round(raw * 100) / 100;
}

function floorToLot(qty: number, lotSize: number): number {
  if (lotSize <= 1) {
    return Math.floor(qty);
  }
  return Math.floor(qty / lotSize) * lotSize;
}

export class TradingModuleService implements LogicModule<GameState> {
  readonly id = 'trading';
  private tradeSequence = 0;
  private orderSequence = 0;
  private lastProcessedEpochMs: number | null = null;
  private readonly tax = new TaxSubservice();
  private lastAttachedState: GameState | null = null;

  createInitialState(): TradingModuleState {
    this.tradeSequence = 0;
    this.orderSequence = 0;
    this.lastProcessedEpochMs = null;
    return {
      ready: true,
      lastExecution: null,
      lastRejection: null,
      openOrders: [],
    };
  }

  attach(context: ModuleAttachContext): void {
    this.tax.attach(() => this.lastAttachedState, context);
  }

  update(state: GameState, _deltaTime: number, context: ModuleContext): void {
    this.lastAttachedState = state;
    if (this.lastProcessedEpochMs === state.simulationEpochMs) {
      return;
    }
    this.lastProcessedEpochMs = state.simulationEpochMs;

    const active = state.trading.openOrders.filter(
      (o) => o.status === 'open' || o.status === 'partially_filled'
    );
    if (active.length === 0) {
      return;
    }

    const projectedQtyBySymbol = new Map<string, number>();
    for (const position of state.portfolio.positions) {
      projectedQtyBySymbol.set(
        position.ticker.toUpperCase(),
        positionTotalQuantity(position)
      );
    }
    for (const [sym, reserved] of Object.entries(
      state.portfolio.reservedQtyBySymbol
    )) {
      projectedQtyBySymbol.set(
        sym,
        Math.max(0, (projectedQtyBySymbol.get(sym) ?? 0) - reserved)
      );
    }

    let changed = false;
    const nextOrders: RestingOrder[] = [];

    for (const order of state.trading.openOrders) {
      if (order.status === 'filled' || order.status === 'cancelled') {
        nextOrders.push(order);
        continue;
      }
      if (order.placedAtSimulationEpochMs >= state.simulationEpochMs) {
        nextOrders.push(order);
        continue;
      }

      const remaining = orderRemainingQuantity(order);
      if (remaining <= 0) {
        nextOrders.push({ ...order, status: 'filled' });
        changed = true;
        continue;
      }

      const symbol = asUpperSymbol(order.symbol);
      const asset = state.market.assetsBySymbol[symbol];
      if (!asset || !Number.isFinite(asset.currentPriceRub)) {
        nextOrders.push(order);
        continue;
      }

      const lotSize = Math.max(1, asset.lotSize);
      const walk = walkOrderBook(
        order.side,
        order.orderKind,
        order.limitPriceRub,
        remaining,
        asset.orderBook
      );
      let fillQty = floorToLot(walk.fillQty, lotSize);
      if (fillQty <= 0) {
        nextOrders.push(order);
        continue;
      }

      const priceRub = walk.vwapPriceRub;
      const commissionRub = calcCommissionRub(priceRub, fillQty);
      const nkdPerBond = asset.isBond ? Math.max(0, asset.nkdPerBondRub) : 0;
      const nkdRub = asset.isBond ? nkdPerBond * fillQty : 0;

      if (order.side === 'buy') {
        const requiredCash = priceRub * fillQty + commissionRub + nkdRub;
        if (requiredCash > state.portfolio.cashRub + 0.001) {
          nextOrders.push(order);
          continue;
        }
      } else {
        const remainingForOrder = orderRemainingQuantity(order);
        // Собственный резерв sell-заявки не должен уменьшать доступный объём для её исполнения.
        const availableQty = Math.min(
          remainingForOrder,
          (projectedQtyBySymbol.get(symbol) ?? 0) + remainingForOrder
        );
        if (fillQty > availableQty) {
          fillQty = floorToLot(availableQty, lotSize);
          if (fillQty <= 0) {
            nextOrders.push(order);
            continue;
          }
        }
      }

      const fillSlices = walk.slices;
      const scaledSlices =
        fillQty < walk.fillQty
          ? [{ priceRub, qty: fillQty }]
          : fillSlices;

      context.dispatchCommand({
        type: 'market/consume-orderbook-liquidity',
        symbol,
        takerSide: order.side,
        slices: scaledSlices,
      });

      const executed = this.executeOrderFill(
        state,
        context,
        order,
        symbol,
        fillQty,
        priceRub,
        commissionRub,
        nkdRub,
        projectedQtyBySymbol
      );
      if (!executed) {
        nextOrders.push(order);
        continue;
      }

      const newFilled = order.filledQuantity + fillQty;
      const done = newFilled >= order.quantity;
      const updated: RestingOrder = {
        ...order,
        filledQuantity: newFilled,
        status: done ? 'filled' : 'partially_filled',
      };
      nextOrders.push(updated);
      changed = true;

      this.releaseReservationPartial(state, context, order, fillQty, priceRub, commissionRub, nkdRub);

      const view = toOrderView(updated) as RestingOrderView;
      const payload: OrderLifecyclePayload = {
        order: view,
        simulationEpochMs: state.simulationEpochMs,
        fillQuantity: fillQty,
        fillPriceRub: priceRub,
      };
      context.emit(done ? ORDER_FILLED : ORDER_PARTIALLY_FILLED, payload);
    }

    if (changed) {
      state.trading = {
        ...state.trading,
        openOrders: nextOrders,
      };
    }
  }

  private executeOrderFill(
    state: GameState,
    context: ModuleContext,
    order: RestingOrder,
    symbol: string,
    fillQty: number,
    priceRub: number,
    commissionRub: number,
    nkdRub: number,
    projectedQtyBySymbol: Map<string, number>
  ): boolean {
    if (order.side === 'buy') {
      projectedQtyBySymbol.set(
        symbol,
        (projectedQtyBySymbol.get(symbol) ?? 0) + fillQty
      );
      return this.executeBuy(state, context, order, symbol, fillQty, priceRub, commissionRub, nkdRub);
    }

    const position = state.portfolio.positions.find(
      (p) => p.ticker.toUpperCase() === symbol
    );
    if (!position) {
      return false;
    }
    const gain = calcCapitalGainFifo(position, {
      quantity: fillQty,
      proceedsPerUnitRub: priceRub,
      extraProceedsRub: nkdRub,
      commissionRub,
    });
    const capitalGainTaxRub =
      gain.realizedGainRub > 0
        ? Math.round(gain.realizedGainRub * NDFL_RATE * 100) / 100
        : 0;
    projectedQtyBySymbol.set(
      symbol,
      (projectedQtyBySymbol.get(symbol) ?? 0) - fillQty
    );
    return this.executeSell(
      state,
      context,
      order,
      symbol,
      fillQty,
      priceRub,
      commissionRub,
      nkdRub,
      gain.realizedGainRub,
      capitalGainTaxRub,
      gain.consumedLots
    );
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    context: ModuleContext
  ): boolean {
    this.lastAttachedState = state;
    switch (command.type) {
      case 'trading/submit-market-order':
        return this.placeOrder(state, context, {
          side: command.side,
          symbol: command.symbol,
          quantity: command.quantity,
          orderKind: 'market',
          limitPriceRub: null,
          source: command.source,
        });
      case 'trading/submit-limit-order':
        return this.placeOrder(state, context, {
          side: command.side,
          symbol: command.symbol,
          quantity: command.quantity,
          orderKind: 'limit',
          limitPriceRub: command.limitPriceRub,
          source: command.source,
        });
      case 'trading/cancel-order':
        return this.cancelOrder(state, context, command);
      default:
        return false;
    }
  }

  private placeOrder(
    state: GameState,
    context: ModuleContext,
    input: {
      side: 'buy' | 'sell';
      symbol: string;
      quantity: number;
      orderKind: 'market' | 'limit';
      limitPriceRub: number | null;
      source: 'right-panel' | 'modal';
    }
  ): boolean {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol: input.symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'INVALID_QUANTITY',
      });
    }

    const symbol = asUpperSymbol(input.symbol);
    const asset = state.market.assetsBySymbol[symbol];
    if (!asset) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'ASSET_NOT_FOUND',
      });
    }
    if (asset.assetKind === 'index') {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'NON_TRADABLE_INSTRUMENT',
      });
    }
    if (!isInstrumentActiveOnMarket(state.market, symbol, state.simulationEpochMs)) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'INSTRUMENT_NOT_TRADING',
      });
    }

    const lotSize = Math.max(1, asset.lotSize);
    if (input.quantity % lotSize !== 0) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'INVALID_LOT_QUANTITY',
        lotSize,
      });
    }

    if (
      input.orderKind === 'limit' &&
      (input.limitPriceRub == null ||
        !Number.isFinite(input.limitPriceRub) ||
        input.limitPriceRub <= 0)
    ) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'PRICE_UNAVAILABLE',
      });
    }

    const priceForReserve =
      input.orderKind === 'limit'
        ? (input.limitPriceRub as number)
        : (asset.currentPriceRub ?? 0);
    if (priceForReserve <= 0) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'PRICE_UNAVAILABLE',
      });
    }

    if (input.side === 'buy') {
      const commissionRub = calcCommissionRub(priceForReserve, input.quantity);
      const nkdRub = asset.isBond
        ? Math.max(0, asset.nkdPerBondRub) * input.quantity
        : 0;
      const required = priceForReserve * input.quantity + commissionRub + nkdRub;
      const available =
        state.portfolio.cashRub - state.portfolio.cashReservedRub;
      if (required > available + 0.001) {
        return this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: input.side,
          requestedQuantity: input.quantity,
          reason: 'INSUFFICIENT_FUNDS',
          availableCashRub: available,
          requiredCashRub: required,
        });
      }
      context.dispatchCommand({
        type: 'portfolio/adjust-reservation',
        symbol,
        deltaCashReservedRub: required,
        deltaQtyReserved: 0,
      });
    } else {
      const position = state.portfolio.positions.find(
        (p) => p.ticker.toUpperCase() === symbol
      );
      const held = position ? positionTotalQuantity(position) : 0;
      const reserved = state.portfolio.reservedQtyBySymbol[symbol] ?? 0;
      const available = held - reserved;
      if (input.quantity > available) {
        return this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: input.side,
          requestedQuantity: input.quantity,
          reason: 'INSUFFICIENT_POSITION_QTY',
          availableQuantity: available,
        });
      }
      context.dispatchCommand({
        type: 'portfolio/adjust-reservation',
        symbol,
        deltaCashReservedRub: 0,
        deltaQtyReserved: input.quantity,
      });
    }

    this.orderSequence += 1;
    const order: RestingOrder = {
      id: `ord-${state.simulationEpochMs}-${symbol}-${this.orderSequence}`,
      symbol,
      side: input.side,
      orderKind: input.orderKind,
      limitPriceRub: input.limitPriceRub,
      quantity: input.quantity,
      filledQuantity: 0,
      placedAtSimulationEpochMs: state.simulationEpochMs,
      status: 'open',
      source: input.source,
    };

    state.trading = {
      ...state.trading,
      openOrders: [...state.trading.openOrders, order],
      lastRejection: null,
    };

    context.emit(ORDER_PLACED, {
      order: toOrderView(order) as RestingOrderView,
      simulationEpochMs: state.simulationEpochMs,
    });
    return true;
  }

  private cancelOrder(
    state: GameState,
    context: ModuleContext,
    command: TradingCancelOrderCommand
  ): boolean {
    const idx = state.trading.openOrders.findIndex((o) => o.id === command.orderId);
    if (idx < 0) {
      return false;
    }
    const order = state.trading.openOrders[idx];
    if (order.status === 'filled' || order.status === 'cancelled') {
      return false;
    }
    const remaining = orderRemainingQuantity(order);
    const asset = state.market.assetsBySymbol[order.symbol];
    const price =
      order.limitPriceRub ??
      asset?.currentPriceRub ??
      0;
    this.releaseReservationRemaining(state, context, order, remaining, price);
    const cancelled: RestingOrder = { ...order, status: 'cancelled' };
    const next = [...state.trading.openOrders];
    next[idx] = cancelled;
    state.trading = { ...state.trading, openOrders: next };
    context.emit(ORDER_CANCELLED, {
      order: toOrderView(cancelled) as RestingOrderView,
      simulationEpochMs: state.simulationEpochMs,
    });
    return true;
  }

  private releaseReservationPartial(
    state: GameState,
    context: ModuleContext,
    order: RestingOrder,
    fillQty: number,
    priceRub: number,
    commissionRub: number,
    nkdRub: number
  ): void {
    if (order.side === 'buy') {
      const released = priceRub * fillQty + commissionRub + nkdRub;
      context.dispatchCommand({
        type: 'portfolio/adjust-reservation',
        symbol: order.symbol,
        deltaCashReservedRub: -released,
        deltaQtyReserved: 0,
      });
    } else {
      context.dispatchCommand({
        type: 'portfolio/adjust-reservation',
        symbol: order.symbol,
        deltaCashReservedRub: 0,
        deltaQtyReserved: -fillQty,
      });
    }
  }

  private releaseReservationRemaining(
    state: GameState,
    context: ModuleContext,
    order: RestingOrder,
    remaining: number,
    priceRub: number
  ): void {
    if (remaining <= 0) {
      return;
    }
    const asset = state.market.assetsBySymbol[order.symbol];
    if (order.side === 'buy') {
      const commissionRub = calcCommissionRub(priceRub, remaining);
      const nkdRub = asset?.isBond
        ? Math.max(0, asset.nkdPerBondRub) * remaining
        : 0;
      const release = priceRub * remaining + commissionRub + nkdRub;
      context.dispatchCommand({
        type: 'portfolio/adjust-reservation',
        symbol: order.symbol,
        deltaCashReservedRub: -release,
        deltaQtyReserved: 0,
      });
    } else {
      context.dispatchCommand({
        type: 'portfolio/adjust-reservation',
        symbol: order.symbol,
        deltaCashReservedRub: 0,
        deltaQtyReserved: -remaining,
      });
    }
  }

  private reject(
    state: GameState,
    context: ModuleContext,
    payload: TradeRejectedPayload
  ): boolean {
    state.trading = {
      ...state.trading,
      lastRejection: payload,
    };
    context.emit(TRADE_REJECTED, payload);
    return true;
  }

  private executeBuy(
    state: GameState,
    context: ModuleContext,
    order: Pick<RestingOrder, 'side' | 'source'>,
    symbol: string,
    quantity: number,
    priceRub: number,
    commissionRub: number,
    nkdRub: number
  ): boolean {
    const payload = this.buildExecutionPayload(
      state,
      order,
      symbol,
      quantity,
      priceRub,
      commissionRub,
      nkdRub,
      { realizedGainRub: undefined, capitalGainTaxRub: undefined, consumedLots: undefined }
    );
    return this.applyExecution(state, context, payload);
  }

  private executeSell(
    state: GameState,
    context: ModuleContext,
    order: Pick<RestingOrder, 'side' | 'source'>,
    symbol: string,
    quantity: number,
    priceRub: number,
    commissionRub: number,
    nkdRub: number,
    realizedGainRub: number,
    capitalGainTaxRub: number,
    consumedLots: ConsumedLot[]
  ): boolean {
    const payload = this.buildExecutionPayload(
      state,
      order,
      symbol,
      quantity,
      priceRub,
      commissionRub,
      nkdRub,
      { realizedGainRub, capitalGainTaxRub, consumedLots }
    );
    return this.applyExecution(state, context, payload);
  }

  private buildExecutionPayload(
    state: GameState,
    command: Pick<RestingOrder, 'side' | 'source'>,
    symbol: string,
    quantity: number,
    priceRub: number,
    commissionRub: number,
    nkdRub: number,
    extras: {
      realizedGainRub: number | undefined;
      capitalGainTaxRub: number | undefined;
      consumedLots: ConsumedLot[] | undefined;
    }
  ): TradeExecutionPayload {
    const amountRub = priceRub * quantity;
    this.tradeSequence += 1;
    return {
      tradeId: `${state.simulationEpochMs}-${symbol}-${command.side}-${this.tradeSequence}`,
      simulationEpochMs: state.simulationEpochMs,
      symbol,
      assetKind: state.market.assetsBySymbol[symbol]?.assetKind ?? 'stock',
      side: command.side,
      quantity,
      priceRub,
      amountRub,
      commissionRub,
      nkdRub,
      realizedGainRub: extras.realizedGainRub,
      capitalGainTaxRub: extras.capitalGainTaxRub,
      consumedLots: extras.consumedLots,
      source: command.source,
    };
  }

  private applyExecution(
    state: GameState,
    context: ModuleContext,
    payload: TradeExecutionPayload
  ): boolean {
    state.trading = {
      ...state.trading,
      lastExecution: payload,
      lastRejection: null,
    };
    context.dispatchCommand({
      type: 'portfolio/apply-trade-execution',
      execution: payload,
    });
    context.emit(TRADE_EXECUTED, payload);
    if (payload.commissionRub > 0) {
      context.emit(COMMISSION_CHARGED, {
        tradeId: payload.tradeId,
        symbol: payload.symbol,
        amountRub: payload.commissionRub,
        simulationEpochMs: payload.simulationEpochMs,
      });
    }
    if (payload.nkdRub > 0) {
      context.emit(NKD_SETTLED, {
        tradeId: payload.tradeId,
        symbol: payload.symbol,
        side: payload.side,
        amountRub: payload.nkdRub,
        simulationEpochMs: payload.simulationEpochMs,
      });
    }
    if (
      payload.side === 'sell' &&
      typeof payload.capitalGainTaxRub === 'number' &&
      payload.capitalGainTaxRub > 0
    ) {
      context.emit(CAPITAL_GAIN_TAX_WITHHELD, {
        tradeId: payload.tradeId,
        symbol: payload.symbol,
        gainRub: payload.realizedGainRub ?? 0,
        taxRub: payload.capitalGainTaxRub,
        simulationEpochMs: payload.simulationEpochMs,
      });
    }
    return true;
  }

  exportRuntimeState(_state: GameState): unknown {
    return {
      tradeSequence: this.tradeSequence,
      orderSequence: this.orderSequence,
      lastProcessedEpochMs: this.lastProcessedEpochMs,
    };
  }

  importRuntimeState(state: GameState, runtime: unknown): void {
    const r = runtime as {
      tradeSequence?: number;
      orderSequence?: number;
      lastProcessedEpochMs?: number | null;
    };
    this.tradeSequence =
      typeof r.tradeSequence === 'number' && Number.isFinite(r.tradeSequence)
        ? r.tradeSequence
        : 0;
    this.orderSequence =
      typeof r.orderSequence === 'number' && Number.isFinite(r.orderSequence)
        ? r.orderSequence
        : 0;
    this.lastProcessedEpochMs =
      r.lastProcessedEpochMs === null ||
      (typeof r.lastProcessedEpochMs === 'number' &&
        Number.isFinite(r.lastProcessedEpochMs))
        ? r.lastProcessedEpochMs
        : null;
    this.lastAttachedState = state;
  }
}
