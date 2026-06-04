import type { GameState } from '@/logic/managers/LogicManager';

export const selectPersistenceModule = (state: GameState) => state.persistence;

export const selectSaveSlots = (state: GameState) => state.persistence.saveSlots;

export const selectPersistenceBusy = (state: GameState) => state.persistence.busy;

export const selectPersistenceLastError = (state: GameState) =>
  state.persistence.lastError;
