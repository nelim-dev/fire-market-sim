import type { TradingModuleState } from './state';

export class TradingModuleService {
  createInitialState(): TradingModuleState {
    return { ready: false };
  }
}

