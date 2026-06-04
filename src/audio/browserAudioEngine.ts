import type { AudioEngineContract, AudioPreferences } from '@/logic/modules/audio/contracts';
import { BackgroundMusicController } from './backgroundMusic';
import {
  MUSIC_RELATIVE_GAIN,
  SOUND_EFFECT_SOURCES,
  type SoundEffectId,
} from './soundCatalog';

function musicVolumeFromMaster(master: number): number {
  return master * MUSIC_RELATIVE_GAIN;
}

export interface SoundPlaybackContract {
  playEffect(id: SoundEffectId): void;
}

export type GameAudioEngine = AudioEngineContract & SoundPlaybackContract;

export function createBrowserAudioEngine(): GameAudioEngine {
  const music = new BackgroundMusicController();
  let soundEnabled = true;
  let musicEnabled = true;
  let masterVolume = 0.8;
  let unlocked = false;

  const unlockFromUserGesture = (): void => {
    if (unlocked) {
      return;
    }
    unlocked = true;
    if (musicEnabled) {
      music.start();
    }
  };

  return {
    setSoundEnabled(enabled: boolean) {
      soundEnabled = enabled;
    },

    setMusicEnabled(enabled: boolean) {
      const wasEnabled = musicEnabled;
      musicEnabled = enabled;
      music.setEnabled(enabled);
      if (enabled && !wasEnabled && unlocked) {
        music.start();
      }
    },

    setMasterVolume(volume: number) {
      masterVolume = volume;
      music.setMasterVolume(musicVolumeFromMaster(masterVolume));
    },

    applyPreferences(preferences: AudioPreferences) {
      const wasMusicEnabled = musicEnabled;
      soundEnabled = preferences.soundEnabled;
      musicEnabled = preferences.musicEnabled;
      masterVolume = preferences.volume;
      music.setMasterVolume(musicVolumeFromMaster(masterVolume));
      if (musicEnabled !== wasMusicEnabled) {
        music.setEnabled(musicEnabled);
        if (musicEnabled && unlocked) {
          music.start();
        }
      }
    },

    unlockFromUserGesture,

    playEffect(id: SoundEffectId) {
      if (!soundEnabled || masterVolume <= 0) {
        return;
      }
      unlockFromUserGesture();
      const src = SOUND_EFFECT_SOURCES[id];
      if (!src) {
        return;
      }
      const clip = new Audio(src);
      clip.volume = masterVolume;
      void clip.play().catch(() => {});
    },
  };
}

/** Singleton для клиентского рантайма. */
let engineInstance: GameAudioEngine | null = null;

export function getGameAudioEngine(): GameAudioEngine {
  if (typeof window === 'undefined') {
    throw new Error('Game audio is only available in the browser');
  }
  if (!engineInstance) {
    engineInstance = createBrowserAudioEngine();
  }
  return engineInstance;
}

export function disposeGameAudioEngine(): void {
  engineInstance = null;
}
