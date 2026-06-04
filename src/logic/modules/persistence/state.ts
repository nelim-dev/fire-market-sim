import type { SaveSlotMeta } from './snapshot';

export interface PersistenceModuleState {
  ready: boolean;
  busy: boolean;
  saveSlots: SaveSlotMeta[];
  lastError: string | null;
}

export function createInitialPersistenceState(): PersistenceModuleState {
  return {
    ready: true,
    busy: false,
    saveSlots: [],
    lastError: null,
  };
}
