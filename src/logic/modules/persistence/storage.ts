import {
  buildSaveSlotMeta,
  validateSnapshot,
  type PersistedGameSnapshot,
  type SaveSlotMeta,
} from './snapshot';

export interface PersistenceStorageAdapter {
  listSaves(): Promise<SaveSlotMeta[]>;
  writeSave(snapshot: PersistedGameSnapshot): Promise<void>;
  readSave(slotId: string): Promise<PersistedGameSnapshot>;
}

export class MemoryPersistenceStorage implements PersistenceStorageAdapter {
  private readonly files = new Map<string, PersistedGameSnapshot>();

  async listSaves(): Promise<SaveSlotMeta[]> {
    return [...this.files.values()]
      .map(buildSaveSlotMeta)
      .sort((a, b) => b.savedAtEpochMs - a.savedAtEpochMs);
  }

  async writeSave(snapshot: PersistedGameSnapshot): Promise<void> {
    this.files.set(snapshot.slotId, structuredClone(snapshot));
  }

  async readSave(slotId: string): Promise<PersistedGameSnapshot> {
    const found = this.files.get(slotId);
    if (!found) {
      throw new Error('save_not_found');
    }
    return structuredClone(found);
  }
}

export class ElectronPersistenceStorage implements PersistenceStorageAdapter {
  async listSaves(): Promise<SaveSlotMeta[]> {
    if (typeof window === 'undefined' || !window.persistence) {
      throw new Error('persistence_unavailable');
    }
    const result = await window.persistence.listSaves();
    if (!result.ok) {
      throw new Error(result.error ?? 'list_failed');
    }
    return result.slots ?? [];
  }

  async writeSave(snapshot: PersistedGameSnapshot): Promise<void> {
    if (typeof window === 'undefined' || !window.persistence) {
      throw new Error('persistence_unavailable');
    }
    const result = await window.persistence.writeSave(snapshot);
    if (!result.ok) {
      throw new Error(result.error ?? 'write_failed');
    }
  }

  async readSave(slotId: string): Promise<PersistedGameSnapshot> {
    if (typeof window === 'undefined' || !window.persistence) {
      throw new Error('persistence_unavailable');
    }
    const result = await window.persistence.readSave(slotId);
    if (!result.ok) {
      throw new Error('error' in result ? result.error ?? 'read_failed' : 'read_failed');
    }
    if (!result.snapshot) {
      throw new Error('read_failed');
    }
    return validateSnapshot(result.snapshot);
  }
}

export function createDefaultPersistenceStorage(): PersistenceStorageAdapter {
  if (typeof window !== 'undefined' && window.persistence) {
    return new ElectronPersistenceStorage();
  }
  return new MemoryPersistenceStorage();
}
