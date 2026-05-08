import type { LogicEventMap } from '@/logic/logicEvents';
import type { RuntimeCommand } from '@/logic/runtimeCommands';
import type { TradeExecutionPayload } from '@/logic/logicEvents';

export type MarketSyncPricesCommand = {
  type: 'market/sync-prices';
  pricesBySymbol: Readonly<Record<string, number>>;
};

export type TradingSubmitMarketOrderCommand = {
  type: 'trading/submit-market-order';
  side: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  source: 'right-panel' | 'modal';
};

export type PortfolioApplyTradeExecutionCommand = {
  type: 'portfolio/apply-trade-execution';
  execution: TradeExecutionPayload;
};

export type LogicCommand =
  | RuntimeCommand
  | MarketSyncPricesCommand
  | TradingSubmitMarketOrderCommand
  | PortfolioApplyTradeExecutionCommand;

export interface ModuleContext {
  emit<K extends keyof LogicEventMap>(event: K, payload: LogicEventMap[K]): void;
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
}

