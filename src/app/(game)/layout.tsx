'use client';

import { useEffect, type ReactNode } from 'react';
import { AppHeader } from '@/components/game/AppHeader';
import { gameLoop } from '@/logic/runners/GameLoop';

export default function GameLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    gameLoop.start();
    return () => {
      gameLoop.stop();
    };
  }, []);

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#121212] text-zinc-100">
      <AppHeader />
      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
