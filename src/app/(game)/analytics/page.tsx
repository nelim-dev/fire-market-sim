'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { gameLoop } from '@/logic/runners/GameLoop';

/** Старый маршрут: открывает аналитику в левой панели на главной. */
export default function AnalyticsPage() {
  const router = useRouter();

  useEffect(() => {
    gameLoop.getLogicManager().dispatchCommand({
      type: 'uiState/set-left-panel-mode',
      mode: 'analytics',
    });
    router.replace('/');
  }, [router]);

  return null;
}
