import type { PersistenceModuleState } from './state';

export class PersistenceModuleService {
  createInitialState(): PersistenceModuleState {
    return { ready: false };
  }
}

