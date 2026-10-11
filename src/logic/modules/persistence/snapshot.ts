/**
 * snapshot.ts — контракт и утилиты снимка сохранения игры (PersistenceModule).
 *
 * При save/load нужно сериализовать не только `GameState` в памяти, но и
 * **runtime-поля модулей** (счётчики tradeId, pendingSimMs у TimeModule и т.д.),
 * которые не лежат в общем state. Формат описан типом `PersistedGameSnapshot`.
 *
 * Renderer (PersistenceModule) собирает снимок → Electron main пишет JSON в
 * userData/saves/{slotId}.json. При загрузке — validateSnapshot() отсекает битые файлы.
 *
 * schemaVersion — задел на миграции: при изменении формата увеличиваем число и
 * пишем конвертер
 */

import type { GameState } from '@/logic/managers/LogicManager';

/** Текущая версия схемы JSON на диске. Менять при несовместимых изменениях формата. */
export const CURRENT_SNAPSHOT_SCHEMA = 1 as const;

export type SnapshotSchemaVersion = typeof CURRENT_SNAPSHOT_SCHEMA;

/**
 * Полный снимок одного слота сохранения.
 *
 * - gameState — весь GameState на момент save (портфель, рынок, обучение…)
 * - moduleRuntime — map moduleId → opaque blob из exportRuntimeState() каждого модуля
 */
export interface PersistedGameSnapshot {
  schemaVersion: SnapshotSchemaVersion;
  slotId: string;
  displayName: string;
  savedAtEpochMs: number;
  gameState: GameState;
  moduleRuntime: Record<string, unknown>;
}

/** Краткая карточка слота для UI меню (без тяжёлого gameState). */
export interface SaveSlotMeta {
  slotId: string;
  displayName: string;
  savedAtEpochMs: number;
  simulationEpochMs: number;
  cashRub: number;
}

/** Строит SaveSlotMeta из полного снимка (дублирует логику electron/main buildSlotMetaFromSnapshot). */
export function buildSaveSlotMeta(snapshot: PersistedGameSnapshot): SaveSlotMeta {
  return {
    slotId: snapshot.slotId,
    displayName: snapshot.displayName,
    savedAtEpochMs: snapshot.savedAtEpochMs,
    simulationEpochMs: snapshot.gameState.simulationEpochMs,
    cashRub: snapshot.gameState.portfolio.cashRub,
  };
}

/**
 * Строгая проверка JSON после read-save. Бросает Error с кодом-причиной.
 * PersistenceModule ловит и показывает ошибку в UI, не ломая приложение.
 */
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

/**
 * Имя файла из отображаемого названия: латиница/кириллица, дефисы, до 48 символов.
 * Пример: «Моя игра» → «моя-игра»
 */
export function slugifySaveName(displayName: string): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'save';
}

/**
 * Уникальный id слота = slug + timestamp. Используется как имя файла {slotId}.json.
 */
export function createSlotId(displayName: string, nowMs = Date.now()): string {
  return `${slugifySaveName(displayName)}-${nowMs}`;
}
