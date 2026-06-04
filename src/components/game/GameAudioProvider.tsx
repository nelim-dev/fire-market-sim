'use client';

import { useEffect, type ReactNode } from 'react';
import { getGameAudioEngine } from '@/audio/browserAudioEngine';
import { useGameState } from '@/hooks/useGameState';
import {
  selectMasterVolume,
  selectMusicEnabled,
  selectSoundEnabled,
} from '@/logic/stateSelectors';

/**
 * Синхронизирует SettingsModule с браузерным аудио и воспроизводит ui.click на клик мыши.
 */
export function GameAudioProvider({ children }: { children: ReactNode }) {
  const soundEnabled = useGameState(selectSoundEnabled);
  const musicEnabled = useGameState(selectMusicEnabled);
  const volume = useGameState(selectMasterVolume);

  useEffect(() => {
    const engine = getGameAudioEngine();
    engine.applyPreferences({
      soundEnabled,
      musicEnabled,
      volume,
    });
  }, [soundEnabled, musicEnabled, volume]);

  useEffect(() => {
    const engine = getGameAudioEngine();

    const onPointerDown = () => {
      engine.playEffect('ui.click');
    };

    const onKeyDown = () => {
      engine.unlockFromUserGesture();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return <>{children}</>;
}
