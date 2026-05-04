import type { AchievementsModuleState } from './state';

export class AchievementsModuleService {
  createInitialState(): AchievementsModuleState {
    return { ready: false };
  }
}

