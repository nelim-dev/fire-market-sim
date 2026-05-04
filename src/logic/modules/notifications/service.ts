import type { NotificationsModuleState } from './state';

export class NotificationsModuleService {
  createInitialState(): NotificationsModuleState {
    return { ready: false };
  }
}

