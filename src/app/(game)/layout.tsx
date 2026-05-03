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
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <AppHeader />
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
