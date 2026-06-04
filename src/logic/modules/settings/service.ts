import type { GameState } from '@/logic/managers/LogicManager';
import type { LogicCommand, LogicModule, ModuleContext } from '@/logic/modules/contracts';
import type { SettingsDisplayHost } from './displayHost';
import { createDefaultSettingsDisplayHost } from './displayHost';
import {
  clampVolume,
  DEFAULT_SETTINGS_STATE,
  type SettingsModuleState,
  type WindowDisplayMode,
} from './state';

export class SettingsModuleService implements LogicModule<GameState> {
  readonly id = 'settings';

  constructor(
    private readonly displayHost: SettingsDisplayHost = createDefaultSettingsDisplayHost()
  ) {}

  createInitialState(): SettingsModuleState {
    return { ...DEFAULT_SETTINGS_STATE };
  }

  update(): void {
    // Пассивный модуль: изменения через команды UI.
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    switch (command.type) {
      case 'settings/set-sound-enabled':
        return this.setSoundEnabled(state, command.enabled);
      case 'settings/set-music-enabled':
        return this.setMusicEnabled(state, command.enabled);
      case 'settings/set-volume':
        return this.setVolume(state, command.volume);
      case 'settings/set-window-mode':
        return this.setWindowMode(state, command.mode);
      case 'settings/sync-window-mode':
        return this.syncWindowMode(state, command.mode);
      default:
        return false;
    }
  }

  private setSoundEnabled(state: GameState, enabled: boolean): boolean {
    if (state.settings.soundEnabled === enabled) {
      return false;
    }
    state.settings.soundEnabled = enabled;
    state.settings.ready = true;
    return true;
  }

  private setMusicEnabled(state: GameState, enabled: boolean): boolean {
    if (state.settings.musicEnabled === enabled) {
      return false;
    }
    state.settings.musicEnabled = enabled;
    state.settings.ready = true;
    return true;
  }

  private setVolume(state: GameState, volume: number): boolean {
    const next = clampVolume(volume);
    if (state.settings.volume === next) {
      return false;
    }
    state.settings.volume = next;
    state.settings.ready = true;
    return true;
  }

  private syncWindowMode(state: GameState, mode: WindowDisplayMode): boolean {
    if (state.settings.windowMode === mode) {
      return false;
    }
    state.settings.windowMode = mode;
    state.settings.ready = true;
    return true;
  }

  private setWindowMode(state: GameState, mode: WindowDisplayMode): boolean {
    if (state.settings.windowMode === mode) {
      return false;
    }
    state.settings.windowMode = mode;
    state.settings.ready = true;
    void this.displayHost.applyWindowMode(mode);
    return true;
  }
}
