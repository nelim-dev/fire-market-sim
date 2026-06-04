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
import { useGameSettings } from '@/components/game/GameSettings';
import {
  acquireOverlayPause,
  releaseOverlayPause,
} from '@/components/game/overlayPause';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { formatSimulationDateOnly } from '@/logic/utils/formatSimulationClock';
import { formatRub } from '@/components/portfolio/formatRub';
import {
  selectPersistenceBusy,
  selectPersistenceLastError,
  selectSaveSlots,
} from '@/logic/stateSelectors';

type MenuView = 'main' | 'save' | 'load';

type GameMenuContextValue = {
  openMenu: () => void;
};

const GameMenuContext = createContext<GameMenuContextValue | null>(null);

export function useGameMenu(): GameMenuContextValue {
  const ctx = useContext(GameMenuContext);
  if (!ctx) {
    throw new Error('useGameMenu must be used within GameMenuProvider');
  }
  return ctx;
}

function MenuButton({
  children,
  onClick,
  variant = 'default',
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  const base =
    'w-full rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-sky-700 text-white hover:bg-sky-600'
      : variant === 'danger'
        ? 'bg-red-900/80 text-red-100 hover:bg-red-800/80'
        : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700';
  return (
    <button type="button" className={`${base} ${styles}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function GameMenuProvider({ children }: { children: ReactNode }) {
  const { openSettings } = useGameSettings();
  const lm = gameLoop.getLogicManager();
  const saveSlots = useGameState(selectSaveSlots);
  const busy = useGameState(selectPersistenceBusy);
  const lastError = useGameState(selectPersistenceLastError);

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<MenuView>('main');
  const [saveName, setSaveName] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const pendingCloseRef = useRef(false);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setView('main');
    setSaveName('');
    setSelectedSlotId(null);
    pendingCloseRef.current = false;
  }, []);

  const openMenu = useCallback(() => {
    acquireOverlayPause(lm);
    setView('main');
    setSaveName('');
    setSelectedSlotId(null);
    setIsOpen(true);
  }, [lm]);

  const handleContinue = useCallback(() => {
    releaseOverlayPause(lm);
    closeMenu();
  }, [closeMenu, lm]);

  const handleSaveConfirm = useCallback(() => {
    const trimmed = saveName.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    pendingCloseRef.current = true;
    lm.dispatchCommand({ type: 'persistence/save', displayName: trimmed });
  }, [busy, lm, saveName]);

  const handleLoadConfirm = useCallback(() => {
    if (!selectedSlotId || busy) {
      return;
    }
    pendingCloseRef.current = true;
    lm.dispatchCommand({ type: 'persistence/load', slotId: selectedSlotId });
  }, [busy, lm, selectedSlotId]);

  useEffect(() => {
    if (!pendingCloseRef.current || busy) {
      return;
    }
    if (lastError) {
      pendingCloseRef.current = false;
      return;
    }
    releaseOverlayPause(lm);
    closeMenu();
  }, [busy, lastError, closeMenu, lm]);

  useEffect(() => {
    if (!isOpen || view !== 'main') {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleContinue();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleContinue, isOpen, view]);

  return (
    <GameMenuContext.Provider value={{ openMenu }}>
      {children}
      {isOpen ? (
        <GameOverlay>
          {view === 'main' ? (
            <div className="space-y-3">
              <h2 className="text-center text-lg font-semibold">Меню</h2>
              <div className="flex flex-col gap-2">
                <MenuButton onClick={handleContinue}>Продолжить</MenuButton>
                <MenuButton onClick={() => setView('save')}>Сохранить</MenuButton>
                <MenuButton
                  onClick={() => {
                    lm.dispatchCommand({ type: 'persistence/list-saves' });
                    setView('load');
                  }}
                >
                  Загрузить
                </MenuButton>
                <MenuButton
                  onClick={() => {
                    setIsOpen(false);
                    setView('main');
                    openSettings();
                  }}
                >
                  Настройки
                </MenuButton>
                <MenuButton
                  variant="danger"
                  onClick={() => {
                    void window.electron?.quit();
                  }}
                >
                  Выход
                </MenuButton>
              </div>
            </div>
          ) : null}

          {view === 'save' ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Сохранение</h2>
              <label className="block text-sm text-zinc-300">
                Название сохранения
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
                  autoFocus
                  maxLength={64}
                />
              </label>
              {lastError ? (
                <p className="text-xs text-red-400">{lastError}</p>
              ) : null}
              <div className="flex gap-2">
                <MenuButton
                  variant="primary"
                  onClick={handleSaveConfirm}
                  disabled={busy || saveName.trim().length === 0}
                >
                  {busy ? 'Сохранение…' : 'Сохранить'}
                </MenuButton>
                <MenuButton onClick={() => setView('main')} disabled={busy}>
                  Отмена
                </MenuButton>
              </div>
            </div>
          ) : null}

          {view === 'load' ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Загрузка</h2>
              {busy && saveSlots.length === 0 ? (
                <p className="text-sm text-zinc-400">Загрузка списка…</p>
              ) : null}
              {saveSlots.length === 0 && !busy ? (
                <p className="text-sm text-zinc-400">Сохранений пока нет.</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-zinc-800 p-1">
                  {saveSlots.map((slot) => {
                    const selected = selectedSlotId === slot.slotId;
                    return (
                      <li key={slot.slotId}>
                        <button
                          type="button"
                          className={`w-full rounded px-2 py-2 text-left text-sm transition ${
                            selected
                              ? 'bg-sky-900/60 text-white'
                              : 'text-zinc-200 hover:bg-zinc-800'
                          }`}
                          onClick={() => setSelectedSlotId(slot.slotId)}
                          onDoubleClick={() => {
                            setSelectedSlotId(slot.slotId);
                            pendingCloseRef.current = true;
                            lm.dispatchCommand({
                              type: 'persistence/load',
                              slotId: slot.slotId,
                            });
                          }}
                        >
                          <div className="font-medium">{slot.displayName}</div>
                          <div className="text-xs text-zinc-400">
                            {formatSimulationDateOnly(slot.simulationEpochMs)} ·{' '}
                            {formatRub(slot.cashRub)}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {lastError ? (
                <p className="text-xs text-red-400">{lastError}</p>
              ) : null}
              <div className="flex gap-2">
                <MenuButton
                  variant="primary"
                  onClick={handleLoadConfirm}
                  disabled={busy || !selectedSlotId}
                >
                  {busy ? 'Загрузка…' : 'Загрузить'}
                </MenuButton>
                <MenuButton onClick={() => setView('main')} disabled={busy}>
                  Отмена
                </MenuButton>
              </div>
            </div>
          ) : null}
        </GameOverlay>
      ) : null}
    </GameMenuContext.Provider>
  );
}
