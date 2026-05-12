import {
  TRADE_EXECUTED,
  TRADE_REJECTED,
  COMMISSION_CHARGED,
  CAPITAL_GAIN_TAX_WITHHELD,
  NKD_SETTLED,
  type ConsumedLot,
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
import { positionTotalQuantity } from '@/logic/modules/portfolio/selectors';
import { calcCapitalGainFifo } from './tax/capitalGainHandler';
import { NDFL_RATE } from './tax/taxCalculator';
import { TaxSubservice } from './tax/corporateActionHandler';
import type {
  ModuleAttachContext,
} from '@/logic/modules/contracts';
import type { PendingMarketOrder, TradingModuleState } from './state';

/** Комиссия брокера+биржи, доли единицы (см. план §3). */
const TRADE_COMMISSION_RATE = 0.001;

function asUpperSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function calcCommissionRub(priceRub: number, quantity: number): number {
  const raw = priceRub * quantity * TRADE_COMMISSION_RATE;
  return Math.round(raw * 100) / 100;
}

export class TradingModuleService implements LogicModule<GameState> {
  readonly id = 'trading';
  private tradeSequence = 0;
  private lastProcessedEpochMs: number | null = null;
  /** Сабсервис налогов — слушает MARKET_*_DECLARED и применяет НДФЛ. */
  private readonly tax = new TaxSubservice();

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

  attach(context: ModuleAttachContext): void {
    // Сабсервис налогов подписывается на MARKET_*_DECLARED и применяет НДФЛ к нашей
    // (брокерской) системе портфеля. См. план §8/§9.
    this.tax.attach(() => this.lastAttachedState, context);
  }

  /**
   * Внутренний reference на GameState; устанавливается каждый update/handleCommand,
   * чтобы tax-сабсервис мог читать актуальные позиции при обработке MARKET_*_DECLARED.
   */
  private lastAttachedState: GameState | null = null;

  update(state: GameState, _deltaTime: number, context: ModuleContext): void {
    this.lastAttachedState = state;
    if (this.lastProcessedEpochMs === state.simulationEpochMs) {
      return;
    }
    this.lastProcessedEpochMs = state.simulationEpochMs;
    if (state.trading.pendingOrders.length === 0) {
      return;
    }

    const projectedQtyBySymbol = new Map<string, number>();
    for (const position of state.portfolio.positions) {
      projectedQtyBySymbol.set(
        position.ticker.toUpperCase(),
        positionTotalQuantity(position)
      );
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
      const lotSize = Math.max(1, asset.lotSize);
      if (order.quantity % lotSize !== 0) {
        this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: order.side,
          requestedQuantity: order.quantity,
          reason: 'INVALID_LOT_QUANTITY',
          lotSize,
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
      const commissionRub = calcCommissionRub(priceRub, order.quantity);
      const nkdPerBond = asset.isBond ? Math.max(0, asset.nkdPerBondRub) : 0;
      const nkdRub = asset.isBond ? nkdPerBond * order.quantity : 0;

      if (order.side === 'buy') {
        const requiredCash = priceRub * order.quantity + commissionRub + nkdRub;
        if (requiredCash > projectedCash.value) {
          this.reject(state, context, {
            simulationEpochMs: state.simulationEpochMs,
            symbol,
            side: order.side,
            requestedQuantity: order.quantity,
            reason: 'INSUFFICIENT_FUNDS',
            availableCashRub: projectedCash.value,
            requiredCashRub: requiredCash,
          });
          changed = true;
          continue;
        }
        projectedCash.value -= requiredCash;
        projectedOrderbookQty.set(bookKey, availableBookQty - order.quantity);
        projectedQtyBySymbol.set(
          symbol,
          (projectedQtyBySymbol.get(symbol) ?? 0) + order.quantity
        );
        this.executeBuy(state, context, order, symbol, priceRub, commissionRub, nkdRub);
        changed = true;
        continue;
      }

      // sell
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
      const position = state.portfolio.positions.find(
        (p) => p.ticker.toUpperCase() === symbol
      );
      if (!position) {
        this.reject(state, context, {
          simulationEpochMs: state.simulationEpochMs,
          symbol,
          side: order.side,
          requestedQuantity: order.quantity,
          reason: 'INSUFFICIENT_POSITION_QTY',
          availableQuantity: 0,
        });
        changed = true;
        continue;
      }
      const gain = calcCapitalGainFifo(position, {
        quantity: order.quantity,
        proceedsPerUnitRub: priceRub,
        extraProceedsRub: nkdRub,
        commissionRub,
      });
      const capitalGainTaxRub =
        gain.realizedGainRub > 0
          ? Math.round(gain.realizedGainRub * NDFL_RATE * 100) / 100
          : 0;
      const cashFlow =
        priceRub * order.quantity + nkdRub - commissionRub - capitalGainTaxRub;
      projectedCash.value += cashFlow;
      projectedOrderbookQty.set(bookKey, availableBookQty - order.quantity);
      projectedQtyBySymbol.set(symbol, availablePositionQty - order.quantity);
      this.executeSell(
        state,
        context,
        order,
        symbol,
        priceRub,
        commissionRub,
        nkdRub,
        gain.realizedGainRub,
        capitalGainTaxRub,
        gain.consumedLots
      );
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

  private executeBuy(
    state: GameState,
    context: ModuleContext,
    command: Pick<TradingSubmitMarketOrderCommand, 'side' | 'quantity' | 'source'>,
    symbol: string,
    priceRub: number,
    commissionRub: number,
    nkdRub: number
  ): boolean {
    const payload = this.buildExecutionPayload(
      state,
      command,
      symbol,
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
    command: Pick<TradingSubmitMarketOrderCommand, 'side' | 'quantity' | 'source'>,
    symbol: string,
    priceRub: number,
    commissionRub: number,
    nkdRub: number,
    realizedGainRub: number,
    capitalGainTaxRub: number,
    consumedLots: ConsumedLot[]
  ): boolean {
    const payload = this.buildExecutionPayload(
      state,
      command,
      symbol,
      priceRub,
      commissionRub,
      nkdRub,
      { realizedGainRub, capitalGainTaxRub, consumedLots }
    );
    return this.applyExecution(state, context, payload);
  }

  private buildExecutionPayload(
    state: GameState,
    command: Pick<TradingSubmitMarketOrderCommand, 'side' | 'quantity' | 'source'>,
    symbol: string,
    priceRub: number,
    commissionRub: number,
    nkdRub: number,
    extras: {
      realizedGainRub: number | undefined;
      capitalGainTaxRub: number | undefined;
      consumedLots: ConsumedLot[] | undefined;
    }
  ): TradeExecutionPayload {
    const amountRub = priceRub * command.quantity;
    this.tradeSequence += 1;
    return {
      tradeId: `${state.simulationEpochMs}-${symbol}-${command.side}-${this.tradeSequence}`,
      simulationEpochMs: state.simulationEpochMs,
      symbol,
      assetKind: state.market.assetsBySymbol[symbol]?.assetKind ?? 'stock',
      side: command.side,
      quantity: command.quantity,
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
    // Применяем эффект через PortfolioModule (cash + lots + ledger).
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

  handleCommand(
    state: GameState,
    command: LogicCommand,
    context: ModuleContext
  ): boolean {
    this.lastAttachedState = state;
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
    const asset = state.market.assetsBySymbol[symbol];
    if (!asset) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: command.side,
        requestedQuantity: command.quantity,
        reason: 'ASSET_NOT_FOUND',
      });
    }
    if (asset.assetKind === 'index') {
      // Индексы/фьючерсы доступны только для просмотра — торговля запрещена на уровне домена.
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: command.side,
        requestedQuantity: command.quantity,
        reason: 'NON_TRADABLE_INSTRUMENT',
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
