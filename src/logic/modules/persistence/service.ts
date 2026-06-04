import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
} from '@/logic/modules/contracts';
import type { GameState } from '@/logic/managers/LogicManager';
import {
  PERSISTENCE_ERROR,
  PERSISTENCE_LOAD_COMPLETED,
  PERSISTENCE_SAVE_COMPLETED,
  type PersistenceErrorPayload,
  type PersistenceLoadCompletedPayload,
  type PersistenceSaveCompletedPayload,
} from './events';
import type { PersistenceHost } from './host';
import {
  buildSaveSlotMeta,
  createSlotId,
  validateSnapshot,
} from './snapshot';
import {
  createInitialPersistenceState,
  type PersistenceModuleState,
} from './state';
import type { PersistenceStorageAdapter } from './storage';
import { createDefaultPersistenceStorage } from './storage';

export class PersistenceModuleService implements LogicModule<GameState> {
  readonly id = 'persistence';

  constructor(
    private readonly host: PersistenceHost,
    private storage: PersistenceStorageAdapter = createDefaultPersistenceStorage()
  ) {}

  setStorage(storage: PersistenceStorageAdapter): void {
    this.storage = storage;
  }

  createInitialState(): PersistenceModuleState {
    return createInitialPersistenceState();
  }

  update(): void {
    // Persistence — command-driven.
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    context: ModuleContext
  ): boolean {
    switch (command.type) {
      case 'persistence/list-saves':
        void this.runList(state, context);
        return true;
      case 'persistence/save':
        void this.runSave(state, command.displayName, context);
        return true;
      case 'persistence/load':
        void this.runLoad(state, command.slotId, context);
        return true;
      default:
        return false;
    }
  }

  private emitError(context: ModuleContext, code: string, message: string): void {
    const payload: PersistenceErrorPayload = { code, message };
    context.emit(PERSISTENCE_ERROR, payload);
    this.host.processEventQueue();
  }

  private async runList(_state: GameState, context: ModuleContext): Promise<void> {
    this.host.patchPersistenceState({ busy: true, lastError: null });
    this.host.notifyPersistenceSubscribers();
    try {
      const slots = await this.storage.listSaves();
      this.host.patchPersistenceState({ saveSlots: slots, busy: false });
      this.host.notifyPersistenceSubscribers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.host.patchPersistenceState({ busy: false, lastError: message });
      this.host.notifyPersistenceSubscribers();
      this.emitError(context, 'list_failed', message);
    }
  }

  private async runSave(
    _state: GameState,
    displayName: string,
    context: ModuleContext
  ): Promise<void> {
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      this.emitError(context, 'invalid_name', 'invalid_display_name');
      return;
    }

    this.host.patchPersistenceState({ busy: true, lastError: null });
    this.host.notifyPersistenceSubscribers();
    try {
      const slotId = createSlotId(trimmed);
      const snapshot = this.host.exportSnapshot(trimmed, slotId);
      await this.storage.writeSave(snapshot);
      const slot = buildSaveSlotMeta(snapshot);
      const slots = await this.storage.listSaves();
      this.host.patchPersistenceState({
        saveSlots: slots,
        busy: false,
        lastError: null,
      });
      this.host.notifyPersistenceSubscribers();
      const payload: PersistenceSaveCompletedPayload = { slot };
      context.emit(PERSISTENCE_SAVE_COMPLETED, payload);
      this.host.processEventQueue();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.host.patchPersistenceState({ busy: false, lastError: message });
      this.host.notifyPersistenceSubscribers();
      this.emitError(context, 'save_failed', message);
    }
  }

  private async runLoad(
    _state: GameState,
    slotId: string,
    context: ModuleContext
  ): Promise<void> {
    this.host.patchPersistenceState({ busy: true, lastError: null });
    this.host.notifyPersistenceSubscribers();
    try {
      const raw = await this.storage.readSave(slotId);
      const snapshot = validateSnapshot(raw);
      this.host.restoreSnapshot(snapshot);
      this.host.patchPersistenceState({ busy: false, lastError: null });
      this.host.notifyPersistenceSubscribers();
      const payload: PersistenceLoadCompletedPayload = { slotId: snapshot.slotId };
      context.emit(PERSISTENCE_LOAD_COMPLETED, payload);
      this.host.processEventQueue();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.host.patchPersistenceState({ busy: false, lastError: message });
      this.host.notifyPersistenceSubscribers();
      this.emitError(context, 'load_failed', message);
    }
  }
}
