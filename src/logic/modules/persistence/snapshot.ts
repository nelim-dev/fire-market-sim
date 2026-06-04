import type { GameState } from '@/logic/managers/LogicManager';

export const CURRENT_SNAPSHOT_SCHEMA = 1 as const;

export type SnapshotSchemaVersion = typeof CURRENT_SNAPSHOT_SCHEMA;

export interface PersistedGameSnapshot {
  schemaVersion: SnapshotSchemaVersion;
  slotId: string;
  displayName: string;
  savedAtEpochMs: number;
  gameState: GameState;
  moduleRuntime: Record<string, unknown>;
}

export interface SaveSlotMeta {
  slotId: string;
  displayName: string;
  savedAtEpochMs: number;
  simulationEpochMs: number;
  cashRub: number;
}

export function buildSaveSlotMeta(snapshot: PersistedGameSnapshot): SaveSlotMeta {
  return {
    slotId: snapshot.slotId,
    displayName: snapshot.displayName,
    savedAtEpochMs: snapshot.savedAtEpochMs,
    simulationEpochMs: snapshot.gameState.simulationEpochMs,
    cashRub: snapshot.gameState.portfolio.cashRub,
  };
}

export function validateSnapshot(raw: unknown): PersistedGameSnapshot {
  if (raw == null || typeof raw !== 'object') {
    throw new Error('invalid_snapshot');
  }
  const s = raw as Partial<PersistedGameSnapshot>;
  if (s.schemaVersion !== CURRENT_SNAPSHOT_SCHEMA) {
    throw new Error('unsupported_schema_version');
  }
  if (typeof s.slotId !== 'string' || s.slotId.length === 0) {
    throw new Error('invalid_slot_id');
  }
  if (typeof s.displayName !== 'string' || s.displayName.trim().length === 0) {
    throw new Error('invalid_display_name');
  }
  if (typeof s.savedAtEpochMs !== 'number' || !Number.isFinite(s.savedAtEpochMs)) {
    throw new Error('invalid_saved_at');
  }
  if (s.gameState == null || typeof s.gameState !== 'object') {
    throw new Error('invalid_game_state');
  }
  if (s.moduleRuntime == null || typeof s.moduleRuntime !== 'object') {
    throw new Error('invalid_module_runtime');
  }
  return s as PersistedGameSnapshot;
}

export function slugifySaveName(displayName: string): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'save';
}

export function createSlotId(displayName: string, nowMs = Date.now()): string {
  return `${slugifySaveName(displayName)}-${nowMs}`;
}
