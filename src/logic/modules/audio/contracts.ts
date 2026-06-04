/**
 * Контракт аудиодвижка (M7+). Реализация подключается позже;
 * SettingsModule хранит предпочтения, потребитель — отдельный runtime.
 */
export interface AudioEngineContract {
  /** Включить/выключить звуковые эффекты (UI, сделки и т.д.). */
  setSoundEnabled(enabled: boolean): void;
  /** Включить/выключить фоновую музыку. */
  setMusicEnabled(enabled: boolean): void;
  /** Громкость 0..1 (мастер, влияет на SFX и музыку одинаково). */
  setMasterVolume(volume: number): void;
  /** Применить текущие предпочтения одним вызовом. */
  applyPreferences(preferences: AudioPreferences): void;
  /** Разблокировать autoplay после жеста пользователя (клавиатура и т.п.). */
  unlockFromUserGesture(): void;
}

export interface AudioPreferences {
  soundEnabled: boolean;
  musicEnabled: boolean;
  volume: number;
}
