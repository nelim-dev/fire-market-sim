export type WindowDisplayMode = 'windowed' | 'fullscreen';

export interface SettingsModuleState {
  soundEnabled: boolean;
  musicEnabled: boolean;
  /** Мастер-громкость 0..1 */
  volume: number;
  windowMode: WindowDisplayMode;
  ready: boolean;
}

export const DEFAULT_SETTINGS_STATE: SettingsModuleState = {
  soundEnabled: true,
  musicEnabled: true,
  volume: 0.8,
  windowMode: 'windowed',
  ready: true,
};

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS_STATE.volume;
  }
  return Math.min(1, Math.max(0, value));
}
