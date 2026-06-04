import type { LogicEventMap } from '@/logic/logicEvents';
import type { RuntimeCommand } from '@/logic/runtimeCommands';
import type { TradeExecutionPayload } from '@/logic/logicEvents';
import type { LedgerEntry } from '@/logic/domain/portfolio';
import type { EducationCommand } from '@/logic/modules/education/commands';
import type { PersistenceCommand } from '@/logic/modules/persistence/commands';
import type { SettingsCommand } from '@/logic/modules/settings/commands';
import type { UiStateCommand } from '@/logic/modules/uiState/commands';

export type MarketSyncPricesCommand = {
  type: 'market/sync-prices';
  pricesBySymbol: Readonly<Record<string, number>>;
};

export type MarketConsumeOrderbookLiquidityCommand = {
  type: 'market/consume-orderbook-liquidity';
  symbol: string;
  /** Сторона заявки тейкера: buy съедает asks, sell — bids. */
  takerSide: 'buy' | 'sell';
  slices: ReadonlyArray<{ priceRub: number; qty: number }>;
};

/** Полная пересборка chartLineByTimeframe при смене выбранного инструмента. */
export type MarketRebuildChartLinesCommand = {
  type: 'market/rebuild-chart-lines';
  symbol: string;
};

export type TradingSubmitMarketOrderCommand = {
  type: 'trading/submit-market-order';
  side: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  source: 'right-panel' | 'modal';
};

export type TradingSubmitLimitOrderCommand = {
  type: 'trading/submit-limit-order';
  side: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  limitPriceRub: number;
  source: 'right-panel' | 'modal';
};

export type TradingCancelOrderCommand = {
  type: 'trading/cancel-order';
  orderId: string;
};

export type PortfolioApplyTradeExecutionCommand = {
  type: 'portfolio/apply-trade-execution';
  execution: TradeExecutionPayload;
};

/**
 * Поступление денег на счёт + запись в журнал.
 * Используется TradingModule.tax для дивидендов/купонов/погашений и НКД при продаже.
 */
export type PortfolioCreditCashCommand = {
  type: 'portfolio/credit-cash';
  amountRub: number;
  ledgerEntry: LedgerEntry;
};

/**
 * Списание денег со счёта + запись в журнал.
 * Используется TradingModule.tax для удержания налога с прибыли при погашении и т.п.
 */
export type PortfolioDebitCashCommand = {
  type: 'portfolio/debit-cash';
  amountRub: number;
  ledgerEntry: LedgerEntry;
};

/**
 * Только запись в журнал (без денежного эффекта).
 * Используется для gross-проводок, когда net уже зачислен/удержан отдельно.
 */
export type PortfolioAppendLedgerCommand = {
  type: 'portfolio/append-ledger';
  entry: LedgerEntry;
};

/**
 * Закрытие позиции (после погашения облигации или иной операции).
 * Не меняет cash и не пишет в журнал — это «структурная» операция.
 */
export type PortfolioClosePositionCommand = {
  type: 'portfolio/close-position';
  ticker: string;
  reason: 'redemption';
};

/**
 * Обнуление `nkdPaidAtBuyPerUnit` у всех лотов указанного тикера.
 * Диспатчится сразу после обработки выплаты купона, чтобы один и тот же
 * уплаченный при покупке НКД не вычитался из налоговой базы повторно
 * (см. план §5.3).
 */
export type PortfolioClearLotNkdAtBuyCommand = {
  type: 'portfolio/clear-lot-nkd-at-buy';
  ticker: string;
};

/**
 * Записать дневной снимок NAV в `portfolio.navHistory`.
 * Диспатчится самим PortfolioModule по событию `TRADING_DAY_CHANGED`.
 * Селектор `selectPortfolioProfitForPeriod` использует историю снимков
 * для расчёта изменения стоимости за неделю/месяц/год.
 */
export type PortfolioRecordNavSnapshotCommand = {
  type: 'portfolio/record-nav-snapshot';
  simulationEpochMs: number;
  navRub: number;
};

/** Резервирование cash/qty под открытые заявки (TradingModule). */
export type PortfolioAdjustReservationCommand = {
  type: 'portfolio/adjust-reservation';
  symbol: string;
  deltaCashReservedRub: number;
  deltaQtyReserved: number;
};

export type LogicCommand =
  | RuntimeCommand
  | MarketSyncPricesCommand
  | MarketConsumeOrderbookLiquidityCommand
  | MarketRebuildChartLinesCommand
  | TradingSubmitMarketOrderCommand
  | TradingSubmitLimitOrderCommand
  | TradingCancelOrderCommand
  | PortfolioApplyTradeExecutionCommand
  | PortfolioCreditCashCommand
  | PortfolioDebitCashCommand
  | PortfolioAppendLedgerCommand
  | PortfolioClosePositionCommand
  | PortfolioClearLotNkdAtBuyCommand
  | PortfolioRecordNavSnapshotCommand
  | PortfolioAdjustReservationCommand
  | EducationCommand
  | PersistenceCommand
  | SettingsCommand
  | UiStateCommand;

/**
 * Контекст, доступный модулю в `update` / `handleCommand`.
 * `emit` — публикует событие на шину; `dispatchCommand` — отправляет команду в роутер
 * команд `LogicManager`, что позволяет сабсервисам инициировать сторонние эффекты
 * (например, TradingModule.tax → portfolio/credit-cash).
 */
export interface ModuleContext {
  emit<K extends keyof LogicEventMap>(event: K, payload: LogicEventMap[K]): void;
  dispatchCommand(command: LogicCommand): void;
}

/** Unsubscribe-функция, возвращаемая `subscribe`. */
export type Unsubscribe = () => void;

/**
 * Контекст этапа `attach()`: позволяет модулю подписаться на типизированные события
 * после создания всех модулей `LogicManager`. Используется TradingModule, чтобы
 * слушать `MARKET_*_DECLARED` (см. план §9).
 */
export interface ModuleAttachContext extends ModuleContext {
  subscribe<K extends keyof LogicEventMap>(
    event: K,
    handler: (payload: LogicEventMap[K]) => void
  ): Unsubscribe;
}

export interface LogicModule<TState> {
  readonly id: string;
  update(state: TState, deltaTime: number, context: ModuleContext): void;
  handleCommand?(
    state: TState,
    command: LogicCommand,
    context: ModuleContext
  ): boolean;
  onTradingDayChanged?(
    state: TState,
    payload: LogicEventMap['TRADING_DAY_CHANGED'],
    context: ModuleContext
  ): void;
  /**
   * Однократный hook, вызывается LogicManager после создания всех модулей.
   * Здесь модуль может подписаться на cross-module события через `context.subscribe`.
   */
  attach?(context: ModuleAttachContext): void;
  /** Приватный runtime модуля для snapshot (не входит в GameState). */
  exportRuntimeState?(state: TState): unknown;
  importRuntimeState?(state: TState, runtime: unknown): void;
}
