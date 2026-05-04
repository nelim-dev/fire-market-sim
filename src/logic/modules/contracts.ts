import type { LogicEventMap } from '@/logic/logicEvents';
import type { RuntimeCommand } from '@/logic/runtimeCommands';

export type LogicCommand = RuntimeCommand;

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

