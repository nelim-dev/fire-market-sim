import type { SettingsModuleState } from './state';

export class SettingsModuleService {
  createInitialState(): SettingsModuleState {
    return { ready: false };
  }
}

