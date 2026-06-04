import type { GameState } from '@/logic/managers/LogicManager';
import type { SettingsModuleState } from './state';

export const selectSettingsModule = (state: GameState): SettingsModuleState =>
  state.settings;

export const selectSoundEnabled = (state: GameState): boolean =>
  state.settings.soundEnabled;

export const selectMusicEnabled = (state: GameState): boolean =>
  state.settings.musicEnabled;

export const selectMasterVolume = (state: GameState): number => state.settings.volume;

export const selectWindowDisplayMode = (state: GameState): SettingsModuleState['windowMode'] =>
  state.settings.windowMode;
