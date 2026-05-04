import type { UiStateModuleState } from './state';

export class UiStateModuleService {
  createInitialState(): UiStateModuleState {
    return { ready: false };
  }
}

