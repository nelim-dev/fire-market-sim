import type { MarketModuleState } from './state';

export class MarketModuleService {
  createInitialState(): MarketModuleState {
    return { ready: false };
  }
}

