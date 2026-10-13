/**
 * service.ts — фасад модуля торговли (TradingModule).
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ---------------
 * Здесь собрана вся «биржевая» логика симулятора: приём заявок от UI, их валидация,
 * постановка в очередь (resting orders), сопоставление с псевдо-стаканом рынка,
 * частичное/полное исполнение, комиссия, НКД по облигациям, налог с прибыли при продаже.
 *
 * Модуль **владеет** срезом `state.trading` (openOrders, lastExecution, lastRejection),
 * но **не трогает** cash и позиции напрямую — только через команды в PortfolioModule
 * (`portfolio/adjust-reservation`, `portfolio/apply-trade-execution`) и в MarketModule
 * (`market/consume-orderbook-liquidity`). Так соблюдается граница модулей из архитектуры.
 *
 * ЖИЗНЕННЫЙ ЦИКЛ ЗАЯВКИ (кратко)
 * ------------------------------
 * 1. UI → `trading/submit-market-order` или `trading/submit-limit-order` → placeOrder().
 * 2. placeOrder валидирует, резервирует cash/qty, кладёт заявку в openOrders, emit ORDER_PLACED.
 * 3. На следующих тиках update() матчит заявку со стаканом (walkOrderBook), режет лоты,
 *    списывает ликвидность со стакана, вызывает executeOrderFill → applyExecution.
 * 4. applyExecution шлёт portfolio/apply-trade-execution и события TRADE_EXECUTED и др.
 * 5. Отмена: trading/cancel-order → снятие резерва → ORDER_CANCELLED.
 *
 * СОСЕДНИЕ ФАЙЛЫ (куда смотреть дальше)
 * ------------------------------------
 * - state.ts          — тип RestingOrder, orderRemainingQuantity
 * - orderBookMatch.ts — обход уровней bid/ask, VWAP
 * - tax/*             — FIFO-прибыль, НДФЛ, дивиденды/купоны (TaxSubservice в attach)
 * - selectors.ts      — toOrderView для UI вкладки «Заявки»
 */

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
import {
  isInstrumentActiveOnMarket,
  isTradableMarketInstrument,
} from '@/logic/modules/market/instrumentLifecycle';
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

// ---------------------------------------------------------------------------
// Константы и чистые функции (без доступа к GameState)
// ---------------------------------------------------------------------------

/** Комиссия брокера: 0,1 % от оборота сделки (цена × количество). */
const TRADE_COMMISSION_RATE = 0.001;

/**
 * Приводит символ к верхнему регистру и убирает пробелы.
 * Нужен, чтобы GAZP, gazp и " GAZP " сравнивались одинаково с портфелем и каталогом.
 */
function asUpperSymbol(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Считает комиссию за сделку и округляет до копеек (два знака после запятой).
 * @param priceRub — цена исполнения за одну бумагу
 * @param quantity — количество бумаг в сделке
 */
function calcCommissionRub(priceRub: number, quantity: number): number {
  const raw = priceRub * quantity * TRADE_COMMISSION_RATE;
  return Math.round(raw * 100) / 100;
}

/**
 * Округляет объём вниз до целого числа лотов.
 * Биржа не исполняет «0,7 лота» — только целые лоты (для lotSize=10: 0, 10, 20…).
 */
function floorToLot(qty: number, lotSize: number): number {
  if (lotSize <= 1) {
    return Math.floor(qty);
  }
  return Math.floor(qty / lotSize) * lotSize;
}

// ---------------------------------------------------------------------------
// TradingModuleService — реализация контракта LogicModule для домена «Торговля»
// ---------------------------------------------------------------------------

/**
 * Главный класс модуля торговли.
 *
 * Реализует три точки входа LogicManager:
 * - createInitialState — пустой список заявок;
 * - handleCommand — заявки и отмены от UI;
 * - update — фоновое исполнение resting-заявок по тику симуляции.
 *
 * Плюс attach() для TaxSubservice (дивиденды, купоны — реакция на события рынка).
 */
export class TradingModuleService implements LogicModule<GameState> {
  readonly id = 'trading';

  /** Порядковый номер сделки внутри сессии; входит в tradeId для журнала. */
  private tradeSequence = 0;

  /** Порядковый номер заявки; входит в id вида ord-{epoch}-{symbol}-{n}. */
  private orderSequence = 0;

  /**
   * Защита от двойного матчинга в одном simulationEpochMs.
   * LogicManager может вызвать update несколько раз с одним и тем же временем симуляции —
   * обрабатываем openOrders только один раз на каждую уникальную эпоху.
   */
  private lastProcessedEpochMs: number | null = null;

  /**
   * Подсервис налогов и корпоративных выплат.
   * Не вызывается из методов этого файла напрямую — подписывается на MARKET_*_DECLARED в attach().
   */
  private readonly tax = new TaxSubservice();

  /**
   * Последний state, переданный в update/handleCommand.
   * TaxSubservice получает его через колбэк, когда приходит событие с шины (после load save).
   */
  private lastAttachedState: GameState | null = null;

  /**
   * Создаёт начальный срез trading в GameState при старте игры / новой сессии.
   * Сбрасывает также runtime-счётчики на экземпляре сервиса.
   */
  createInitialState(): TradingModuleState {
    this.tradeSequence = 0;
    this.orderSequence = 0;
    this.lastProcessedEpochMs = null;
    return {
      ready: true,
      lastExecution: null, // последняя сделка — для UI/отладки
      lastRejection: null, // последний отказ — модалка заявки
      openOrders: [], // resting market/limit заявки
    };
  }

  /**
   * Однократная инициализация после создания всех модулей в LogicManager.
   * TaxSubservice вешает подписки на шину: дивиденд объявлен → зачисление в портфель и т.д.
   * Вся эта логика живёт в tax/corporateActionHandler.ts, не здесь.
   */
  attach(context: ModuleAttachContext): void {
    // TaxSubservice слушает MARKET_*_DECLARED и диспатчит portfolio/credit-cash и т.д.
    this.tax.attach(() => this.lastAttachedState, context);
  }

  /**
   * Вызывается LogicManager на каждом тике игрового цикла (после TimeModule и MarketModule).
   *
   * Задача: попытаться исполнить все **активные** resting-заявки (open / partially_filled)
   * против **текущего** стакана и цен в state.market.
   *
   * Важные инварианты:
   * - не более одного прохода матчинга на один simulationEpochMs;
   * - заявка, созданная в эпохе T, не исполняется в той же эпохе T (только со следующего тика);
   * - при частичном fill стакан уменьшается, резерв в портфеле уменьшается пропорционально;
   * - несколько sell-заявок на один тикер учитывают общий пул qty через projectedQtyBySymbol.
   */
  update(state: GameState, _deltaTime: number, context: ModuleContext): void {
    this.lastAttachedState = state;

    // --- 0. Дедупликация по эпохе симуляции ---
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

    // --- 1. Сводная «доступная» позиция по каждому тикеру для sell ---
    // Берём фактическое количество в портфеле и вычитаем qty, уже зарезервированные
    // под другие открытые sell-заявки (portfolio.reservedQtyBySymbol).
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

    // --- 2. Проход по всем заявкам (включая уже filled/cancelled — сохраняем историю в списке) ---
    for (const order of state.trading.openOrders) {
      // Терминальные статусы просто переносим в nextOrders без изменений.
      if (order.status === 'filled' || order.status === 'cancelled') {
        nextOrders.push(order);
        continue;
      }
      // Заявка только что выставлена — даём рынку «один тик» до исполнения (реализм + порядок команд).
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
      // Нет актива или нет цены — ждём следующего тика (рынок может ещё не подгрузить котировки).
      if (!asset || !Number.isFinite(asset.currentPriceRub)) {
        nextOrders.push(order);
        continue;
      }

      // --- 3. Сопоставление со стаканом: сколько можем исполнить и по какой средней цене ---
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
        // Стакан пустой, лимитка не достигает цены, или объём меньше одного лота.
        nextOrders.push(order);
        continue;
      }

      const priceRub = walk.vwapPriceRub;
      const commissionRub = calcCommissionRub(priceRub, fillQty);
      const nkdPerBond = asset.isBond ? Math.max(0, asset.nkdPerBondRub) : 0;
      const nkdRub = asset.isBond ? nkdPerBond * fillQty : 0;

      // --- 4. Повторная проверка достаточности ресурсов на момент fill (cash / бумаги) ---
      if (order.side === 'buy') {
        const requiredCash = priceRub * fillQty + commissionRub + nkdRub;
        if (requiredCash > state.portfolio.cashRub + 0.001) {
          // Теоретически не должно случиться при корректном резерве; защита от гонок.
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

      // --- 5. Списание ликвидности со стакана (команда в MarketModule) ---
      const fillSlices = walk.slices;
      // Если из-за лота обрезали объём — в стакан уходит один агрегированный срез по VWAP.
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

      // --- 6. Проводка в портфель + события сделки ---
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

      // --- 7. Обновление статуса заявки и событие жизненного цикла ордера ---
      const newFilled = order.filledQuantity + fillQty;
      const done = newFilled >= order.quantity;
      const updated: RestingOrder = {
        ...order,
        filledQuantity: newFilled,
        status: done ? 'filled' : 'partially_filled',
      };
      nextOrders.push(updated);
      changed = true;

      // Резерв уменьшаем на исполненную часть (остаток резерва ждёт следующих fill или cancel).
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

  /**
   * Точка ветвления buy vs sell после успешного матчинга со стаканом.
   *
   * Buy:  сразу собирает TradeExecutionPayload без налога с прибыли.
   * Sell: сначала calcCapitalGainFifo — какие лоты списаны, какая прибыль, НДФЛ;
   *       затем executeSell с consumedLots для PortfolioModule.
   *
   * @param projectedQtyBySymbol — обновляется in-place, чтобы следующая sell-заявка
   *        в этом же update() видела уменьшенный доступный остаток.
   * @returns false если sell без позиции (не должно происходить при корректном резерве).
   */
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
    // FIFO: какие лоты списаны и какая финрезультатовая прибыль для НДФЛ.
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

  /**
   * Роутер команд trading/* из UI (и тестов).
   * LogicManager перебирает модули; первый вернувший true — обработчик.
   *
   * Поддерживаемые команды:
   * - trading/submit-market-order  → placeOrder (market)
   * - trading/submit-limit-order   → placeOrder (limit)
   * - trading/cancel-order         → cancelOrder
   */
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
        return false; // не наша команда — chain of responsibility идёт дальше
    }
  }

  /**
   * Единая точка постановки market и limit заявки.
   *
   * Порядок работы:
   * 1) Валидация (количество, инструмент, сессия, лот, цена лимитки).
   * 2) Резерв в портфеле: cash+комиссия+НКД для buy; qty для sell.
   * 3) Создание RestingOrder со status=open и добавление в openOrders.
   * 4) Событие ORDER_PLACED — UI обновит вкладку «Заявки».
   *
   * Исполнение **не** происходит здесь — только в update() на следующих тиках.
   *
   * @returns true если заявка принята; при отказе — reject() и true (команда обработана).
   */
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
    // --- Валидация заявки до резерва и постановки в openOrders ---
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
    // Индексы вроде FIREIDX, макро-символы — нельзя купить/продать как обычную бумагу.
    if (!isTradableMarketInstrument(symbol, asset.assetKind)) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'NON_TRADABLE_INSTRUMENT',
      });
    }
    // Инструмент есть в каталоге, но в этот момент симуляции не торгуется (вне сессии / delisted).
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
    // Заявка должна быть кратна размеру лота (из каталога instrument details).
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
      // Лимитка без положительной цены — отклоняем (PRICE_UNAVAILABLE).
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
        ? (input.limitPriceRub as number) // резервируем по лимитной цене (худший случай для buy)
        : (asset.currentPriceRub ?? 0); // market — по текущей котировке на момент заявки
    if (priceForReserve <= 0) {
      return this.reject(state, context, {
        simulationEpochMs: state.simulationEpochMs,
        symbol,
        side: input.side,
        requestedQuantity: input.quantity,
        reason: 'PRICE_UNAVAILABLE',
      });
    }

    // Резерв в портфеле: cash для buy, qty для sell — чтобы две заявки не съели один cash/позицию.
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
    // RestingOrder живёт в openOrders до fill/cancel; id детерминирован от epoch + symbol.
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

    // Исполнение произойдёт в update() на следующих тиках, когда epoch строго больше placedAt.
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

  /**
   * Отмена активной заявки пользователем (вкладка «Заявки»).
   *
   * - Ищет order по id; filled/cancelled не трогаем (return false — команда не обработана).
   * - Снимает резерв с неисполненного остатка (releaseReservationRemaining).
   * - Ставит status=cancelled, emit ORDER_CANCELLED.
   */
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
    // Вернуть неиспользованный резерв cash/qty в портфель.
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

  /**
   * Уменьшает резерв портфеля после **частичного** исполнения заявки.
   *
   * Buy:  освобождаем зарезервированный cash на сумму fill (цена + комиссия + НКД).
   * Sell: освобождаем зарезервированное количество бумаг на fillQty.
   *
   * Полный остаток резерва снимается при полном fill (через несколько partial) или при cancel.
   */
  private releaseReservationPartial(
    state: GameState,
    context: ModuleContext,
    order: RestingOrder,
    fillQty: number,
    priceRub: number,
    commissionRub: number,
    nkdRub: number
  ): void {
    // После частичного fill уменьшаем резерв на фактически исполненную долю.
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

  /**
   * Снимает резерв с **неисполненного остатка** заявки (отмена или вспомогательный сценарий).
   *
   * Для buy пересчитывает комиссию и НКД на remaining qty по цене limit или last.
   */
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

  /**
   * Унифицированный отказ в постановке заявки.
   *
   * Пишет lastRejection в state.trading (UI читает в модалке) и эмитит TRADE_REJECTED.
   * Всегда return true — команда trading/* считается обработанной модулем торговли.
   */
  private reject(
    state: GameState,
    context: ModuleContext,
    payload: TradeRejectedPayload
  ): boolean {
    // UI читает lastRejection и показывает причину в модалке заявки.
    state.trading = {
      ...state.trading,
      lastRejection: payload,
    };
    context.emit(TRADE_REJECTED, payload);
    return true;
  }

  /** Сборка payload и проводка покупки (без налога с прибыли). */
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

  /**
   * Сборка payload и проводка продажи.
   * realizedGainRub, capitalGainTaxRub и consumedLots уже посчитаны в executeOrderFill.
   */
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

  /**
   * Формирует контракт TradeExecutionPayload для PortfolioModule.
   *
   * tradeId уникален в рамках сессии: {epoch}-{symbol}-{side}-{tradeSequence}.
   * amountRub = priceRub × quantity (без комиссии и НКД — они отдельными полями).
   */
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
      realizedGainRub: extras.realizedGainRub, // только sell
      capitalGainTaxRub: extras.capitalGainTaxRub,
      consumedLots: extras.consumedLots, // FIFO-лоты для portfolio
      source: command.source,
    };
  }

  /**
   * Финальный шаг исполнения сделки.
   *
   * 1. Запоминает lastExecution в trading state.
   * 2. dispatchCommand portfolio/apply-trade-execution — единственное место изменения cash/лотов.
   * 3. Публикует доменные события для журнала, UI и будущих подписчиков:
   *    TRADE_EXECUTED, COMMISSION_CHARGED, NKD_SETTLED, CAPITAL_GAIN_TAX_WITHHELD.
   */
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
    // Единственная точка проводки сделки в портфель (лоты, cash, журнал).
    context.dispatchCommand({
      type: 'portfolio/apply-trade-execution',
      execution: payload,
    });
    context.emit(TRADE_EXECUTED, payload);
    // Дополнительные события — для аналитики/журнала; портфель уже обновлён командой выше.
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
    // НДФЛ с положительной финрезультатовой прибыли по FIFO (только sell).
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

  /**
   * Часть runtime-состояния сервиса, не входящая в JSON-снимок GameState.
   * PersistenceModule мержит это при save/load вместе с остальными модулями.
   */
  exportRuntimeState(_state: GameState): unknown {
    // Счётчики и lastProcessedEpochMs — в runtime, не в GameState snapshot.
    return {
      tradeSequence: this.tradeSequence,
      orderSequence: this.orderSequence,
      lastProcessedEpochMs: this.lastProcessedEpochMs,
    };
  }

  /**
   * Восстановление счётчиков после load save.
   * Без этого новые tradeId/orderId могут совпасть со старыми записями в журнале.
   */
  importRuntimeState(state: GameState, runtime: unknown): void {
    // После load save восстанавливаем счётчики, чтобы tradeId/orderId не коллидировали.
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
