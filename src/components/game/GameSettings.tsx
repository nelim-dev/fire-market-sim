'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { GameOverlay } from '@/components/game/GameOverlay';
import {
  acquireOverlayPause,
  getOverlayPauseDepth,
  releaseOverlayPause,
} from '@/components/game/overlayPause';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import type { WindowDisplayMode } from '@/logic/modules/settings/state';
import {
  selectMasterVolume,
  selectMusicEnabled,
  selectSoundEnabled,
  selectWindowDisplayMode,
} from '@/logic/stateSelectors';

type GameSettingsContextValue = {
  openSettings: () => void;
};

const GameSettingsContext = createContext<GameSettingsContextValue | null>(null);

export function useGameSettings(): GameSettingsContextValue {
  const ctx = useContext(GameSettingsContext);
  if (!ctx) {
    throw new Error('useGameSettings must be used within GameSettingsProvider');
  }
  return ctx;
}

function PanelButton({
  children,
  onClick,
  variant = 'default',
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary';
}) {
  const base =
    'w-full rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-sky-700 text-white hover:bg-sky-600'
      : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700';
  return (
    <button type="button" className={`${base} ${styles}`} onClick={onClick}>
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-200">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 text-sky-600 focus:ring-sky-600"
      />
    </label>
  );
}

const WINDOW_MODE_LABELS: Record<WindowDisplayMode, string> = {
  windowed: 'Обычное окно',
  fullscreen: 'Во весь экран',
};

export function GameSettingsProvider({ children }: { children: ReactNode }) {
  const lm = gameLoop.getLogicManager();
  const soundEnabled = useGameState(selectSoundEnabled);
  const musicEnabled = useGameState(selectMusicEnabled);
  const volume = useGameState(selectMasterVolume);
  const windowMode = useGameState(selectWindowDisplayMode);

  const [isOpen, setIsOpen] = useState(false);
  const acquiredPauseRef = useRef(false);

  const closeSettings = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openSettings = useCallback(() => {
    if (getOverlayPauseDepth() === 0) {
      acquireOverlayPause(lm);
      acquiredPauseRef.current = true;
    } else {
      acquiredPauseRef.current = false;
    }
    setIsOpen(true);
  }, [lm]);

  const handleClose = useCallback(() => {
    if (acquiredPauseRef.current) {
      releaseOverlayPause(lm);
      acquiredPauseRef.current = false;
    } else if (getOverlayPauseDepth() > 0) {
      // Паузу держало меню (Меню → Настройки): снимаем при закрытии настроек.
      releaseOverlayPause(lm);
    }
    closeSettings();
  }, [closeSettings, lm]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void window.electron?.getWindowMode?.().then((result) => {
      if (result?.mode) {
        lm.dispatchCommand({
          type: 'settings/sync-window-mode',
          mode: result.mode,
        });
      }
    });
  }, [isOpen, lm]);

  const volumePercent = Math.round(volume * 100);

  return (
    <GameSettingsContext.Provider value={{ openSettings }}>
      {children}
      {isOpen ? (
        <GameOverlay onBackdropClick={handleClose}>
          <div className="space-y-4">
            <h2 className="text-center text-lg font-semibold">Настройки</h2>

            <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
              <ToggleRow
                label="Отключить звуки"
                checked={!soundEnabled}
                onChange={(disabled) =>
                  lm.dispatchCommand({
                    type: 'settings/set-sound-enabled',
                    enabled: !disabled,
                  })
                }
              />
              <ToggleRow
                label="Отключить музыку"
                checked={!musicEnabled}
                onChange={(disabled) =>
                  lm.dispatchCommand({
                    type: 'settings/set-music-enabled',
                    enabled: !disabled,
                  })
                }
              />
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm text-zinc-200">
                  <span>Громкость</span>
                  <span className="font-mono text-xs text-zinc-400 tabular-nums">
                    {volumePercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volumePercent}
                  onChange={(e) =>
                    lm.dispatchCommand({
                      type: 'settings/set-volume',
                      volume: Number(e.target.value) / 100,
                    })
                  }
                  className="w-full accent-sky-600"
                />
              </div>
            </div>

            <label className="block text-sm text-zinc-300">
              Режим окна
              <select
                value={windowMode}
                onChange={(e) =>
                  lm.dispatchCommand({
                    type: 'settings/set-window-mode',
                    mode: e.target.value as WindowDisplayMode,
                  })
                }
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
              >
                {(Object.keys(WINDOW_MODE_LABELS) as WindowDisplayMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {WINDOW_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>

            <PanelButton variant="primary" onClick={handleClose}>
              Закрыть
            </PanelButton>
          </div>
        </GameOverlay>
      ) : null}
    </GameSettingsContext.Provider>
  );
}
