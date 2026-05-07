import type { LogicEventMap } from '@/logic/logicEvents';
import type { RuntimeCommand } from '@/logic/runtimeCommands';

export type MarketSyncPricesCommand = {
  type: 'market/sync-prices';
  pricesBySymbol: Readonly<Record<string, number>>;
};

export type LogicCommand = RuntimeCommand | MarketSyncPricesCommand;

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

