import type { WindowDisplayMode } from './state';

export type SettingsSetSoundEnabledCommand = {
  type: 'settings/set-sound-enabled';
  enabled: boolean;
};

export type SettingsSetMusicEnabledCommand = {
  type: 'settings/set-music-enabled';
  enabled: boolean;
};

export type SettingsSetVolumeCommand = {
  type: 'settings/set-volume';
  volume: number;
};

export type SettingsSetWindowModeCommand = {
  type: 'settings/set-window-mode';
  mode: WindowDisplayMode;
};

export type SettingsSyncWindowModeCommand = {
  type: 'settings/sync-window-mode';
  mode: WindowDisplayMode;
};

export type SettingsCommand =
  | SettingsSetSoundEnabledCommand
  | SettingsSetMusicEnabledCommand
  | SettingsSetVolumeCommand
  | SettingsSetWindowModeCommand
  | SettingsSyncWindowModeCommand;
