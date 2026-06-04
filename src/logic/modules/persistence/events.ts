import type { SaveSlotMeta } from './snapshot';

export const PERSISTENCE_SAVE_COMPLETED = 'PERSISTENCE_SAVE_COMPLETED' as const;
export const PERSISTENCE_LOAD_COMPLETED = 'PERSISTENCE_LOAD_COMPLETED' as const;
export const PERSISTENCE_ERROR = 'PERSISTENCE_ERROR' as const;

export type PersistenceSaveCompletedPayload = {
  slot: SaveSlotMeta;
};

export type PersistenceLoadCompletedPayload = {
  slotId: string;
};

export type PersistenceErrorPayload = {
  code: string;
  message: string;
};
