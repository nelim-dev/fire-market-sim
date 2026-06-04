import type { AudioEngineContract, AudioPreferences } from './contracts';

/** Заглушка до появления реального аудиорантайма. */
export const noopAudioEngine: AudioEngineContract = {
  setSoundEnabled() {},
  setMusicEnabled() {},
  setMasterVolume() {},
  applyPreferences(_preferences: AudioPreferences) {},
  unlockFromUserGesture() {},
};
