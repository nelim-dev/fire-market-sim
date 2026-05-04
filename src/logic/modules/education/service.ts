import type { EducationModuleState } from './state';

export class EducationModuleService {
  createInitialState(): EducationModuleState {
    return { ready: false };
  }
}

