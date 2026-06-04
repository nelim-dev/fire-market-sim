import type { PersistedGameSnapshot, SaveSlotMeta } from './snapshot';
import type { PersistenceModuleState } from './state';

/** Оркестрация snapshot — реализуется LogicManager, не domain services. */
export interface PersistenceHost {
  exportSnapshot(displayName: string, slotId: string): PersistedGameSnapshot;
  restoreSnapshot(snapshot: PersistedGameSnapshot): void;
  listSnapshotMetas(): Promise<SaveSlotMeta[]>;
  writeSnapshot(snapshot: PersistedGameSnapshot): Promise<void>;
  readSnapshot(slotId: string): Promise<PersistedGameSnapshot>;
  patchPersistenceState(patch: Partial<PersistenceModuleState>): void;
  notifyPersistenceSubscribers(): void;
  processEventQueue(): void;
}
