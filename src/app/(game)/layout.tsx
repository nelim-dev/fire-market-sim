'use client';

import { useEffect, type ReactNode } from 'react';
import { AppHeader } from '@/components/game/AppHeader';
import { GameMenuProvider } from '@/components/game/GameMenu';
import { GameAudioProvider } from '@/components/game/GameAudioProvider';
import { GameSettingsProvider } from '@/components/game/GameSettings';
import { registerFireDevConsole, unregisterFireDevConsole } from '@/dev/fireConsole';
import { gameLoop } from '@/logic/runners/GameLoop';

export default function GameLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    gameLoop.start();
    registerFireDevConsole();
    return () => {
      unregisterFireDevConsole();
      gameLoop.stop();
    };
  }, []);

  useEffect(() => {
    void gameLoop.getLogicManager().hydrateMarketFromDatabase();
  }, []);

  return (
    <GameAudioProvider>
      <GameSettingsProvider>
        <GameMenuProvider>
          <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#121212] text-zinc-100">
            <AppHeader />
            <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
              {children}
            </main>
          </div>
        </GameMenuProvider>
      </GameSettingsProvider>
    </GameAudioProvider>
  );
}
