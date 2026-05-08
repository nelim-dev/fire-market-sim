import {
  TRADE_EXECUTED,
  TRADE_REJECTED,
  type TradeExecutionPayload,
  type TradeRejectedPayload,
} from '@/logic/logicEvents';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
  TradingSubmitMarketOrderCommand,
} from '@/logic/modules/contracts';
import type { GameState } from '@/logic/managers/LogicManager';
import type { PendingMarketOrder, TradingModuleState } from './state';

function asUpperSymbol(value: string): string {
  return value.trim().toUpperCase();
}

export class TradingModuleService implements LogicModule<GameState> {
  readonly id = 'trading';
  private tradeSequence = 0;
  private lastProcessedEpochMs: number | null = null;

  createInitialState(): TradingModuleState {
    this.tradeSequence = 0;
    this.lastProcessedEpochMs = null;
    return {
      ready: true,
      lastExecution: null,
      lastRejection: null,
      pendingOrders: [],
    };
  }

  update(state: GameState, _deltaTime: number, context: ModuleContext): void {
    if (this.lastProcessedEpochMs === state.simulationEpochMs) {
      return;
    }
    this.lastProcessedEpochMs = state.simulationEpochMs;
    if (state.trading.pendingOrders.length === 0) {
      return;
    }

    const projectedQtyBySymbol = new Map<string, number>();
    for (const position of state.portfolio.positions) {
      projectedQtyBySymbol.set(position.ticker.toUpperCase(), position.quantity);
    }
    const projectedOrderbookQty = new Map<string, number>();
    const keyOf = (side: 'buy' | 'sell', symbol: string) => `${side}:${symbol}`;
    const projectedCash = { value: state.portfolio.cashRub };

    const queue = state.trading.pendingOrders;
    const remainingQueue: PendingMarketOrder[] = [];
    let changed = false;
    for (const order of queue) {
      if (order.queuedAtSimulationEpochMs >= state.simulationEpochMs) {
        remainingQueue.push(order);
        continue;
      }
      const symbol = asUpperSymbol(order.symbol);
      const asset = state.market.assetsBySymbol[symbol];
      if (!asset) {
        this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: order.side,
          requestedQuantity: order.quantity,
          reason: 'ASSET_NOT_FOUND',
        });
        changed = true;
        continue;
      }
      if (!Number.isFinite(asset.currentPriceRub)) {
        this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: order.side,
          requestedQuantity: order.quantity,
          reason: 'PRICE_UNAVAILABLE',
        });
        changed = true;
        continue;
      }
      const priceRub = asset.currentPriceRub as number;
      const bookKey = keyOf(order.side, symbol);
      if (!projectedOrderbookQty.has(bookKey)) {
        projectedOrderbookQty.set(
          bookKey,
          order.side === 'buy'
            ? asset.orderBook.asks[0]?.qty ?? 0
            : asset.orderBook.bids[0]?.qty ?? 0
        );
      }
      const availableBookQty = projectedOrderbookQty.get(bookKey) ?? 0;
      if (order.quantity > availableBookQty) {
        this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: order.side,
          requestedQuantity: order.quantity,
          reason: 'INSUFFICIENT_ORDERBOOK_LIQUIDITY',
          availableOrderbookQuantity: availableBookQty,
        });
        changed = true;
        continue;
      }
      const amountRub = priceRub * order.quantity;
      if (order.side === 'buy') {
        if (amountRub > projectedCash.value) {
          this.reject(state, context, {
            simulationEpochMs: state.simulationEpochMs,
            symbol,
            side: order.side,
            requestedQuantity: order.quantity,
            reason: 'INSUFFICIENT_FUNDS',
            availableCashRub: projectedCash.value,
            requiredCashRub: amountRub,
          });
          changed = true;
          continue;
        }
        projectedCash.value -= amountRub;
        projectedOrderbookQty.set(bookKey, availableBookQty - order.quantity);
        projectedQtyBySymbol.set(
          symbol,
          (projectedQtyBySymbol.get(symbol) ?? 0) + order.quantity
        );
        this.execute(state, context, order, symbol, priceRub);
        changed = true;
        continue;
      }

      const availablePositionQty = projectedQtyBySymbol.get(symbol) ?? 0;
      if (order.quantity > availablePositionQty) {
        this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: order.side,
          requestedQuantity: order.quantity,
          reason: 'INSUFFICIENT_POSITION_QTY',
          availableQuantity: availablePositionQty,
        });
        changed = true;
        continue;
      }
      projectedCash.value += amountRub;
      projectedOrderbookQty.set(bookKey, availableBookQty - order.quantity);
      projectedQtyBySymbol.set(symbol, availablePositionQty - order.quantity);
      this.execute(state, context, order, symbol, priceRub);
      changed = true;
    }

    if (changed || remainingQueue.length !== queue.length) {
      state.trading = {
        ...state.trading,
        pendingOrders: remainingQueue,
      };
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

  private execute(
    state: GameState,
    context: ModuleContext,
    command: Pick<TradingSubmitMarketOrderCommand, 'side' | 'quantity' | 'source'>,
    symbol: string,
    priceRub: number
  ): boolean {
    const amountRub = priceRub * command.quantity;
    this.tradeSequence += 1;
    const payload: TradeExecutionPayload = {
      tradeId: `${state.simulationEpochMs}-${symbol}-${command.side}-${this.tradeSequence}`,
      simulationEpochMs: state.simulationEpochMs,
      symbol,
      assetKind: state.market.assetsBySymbol[symbol]?.assetKind ?? 'stock',
      side: command.side,
      quantity: command.quantity,
      priceRub,
      amountRub,
      source: command.source,
    };
    state.trading = {
      ...state.trading,
      lastExecution: payload,
      lastRejection: null,
    };
    context.emit(TRADE_EXECUTED, payload);
    return true;
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    context: ModuleContext
  ): boolean {
    if (command.type !== 'trading/submit-market-order') {
      return false;
    }

    if (!Number.isFinite(command.quantity) || command.quantity <= 0) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol: command.symbol,
        side: command.side,
        requestedQuantity: command.quantity,
        reason: 'INVALID_QUANTITY',
      });
    }

    const symbol = asUpperSymbol(command.symbol);
    if (!state.market.assetsBySymbol[symbol]) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: command.side,
        requestedQuantity: command.quantity,
        reason: 'ASSET_NOT_FOUND',
      });
    }
    state.trading = {
      ...state.trading,
      pendingOrders: [
        ...state.trading.pendingOrders,
        {
          symbol,
          side: command.side,
          quantity: command.quantity,
          source: command.source,
          queuedAtSimulationEpochMs: state.simulationEpochMs,
        },
      ],
    };
    return true;
  }
}

