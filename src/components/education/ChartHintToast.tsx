'use client';

import { useEffect, useRef } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { selectActiveChartHint } from '@/logic/modules/education/selectors';
import { HINT_VISIBLE_MS } from '@/logic/modules/education/hintSchedule';

export function ChartHintToast({
  schedulingActive,
  chartSurfaceActive,
}: {
  /** Таймер идёт при выбранном разблокированном инструменте (любая вкладка карточки). */
  schedulingActive: boolean;
  /** Вкладка «График» — здесь рисуем toast. */
  chartSurfaceActive: boolean;
}) {
  const hint = useGameState(selectActiveChartHint);
  const lm = gameLoop.getLogicManager();
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lm.dispatchCommand({ type: 'education/bootstrap' });
  }, [lm]);

  useEffect(() => {
    lm.dispatchCommand({
      type: 'education/on-chart-hints-surface',
      active: chartSurfaceActive,
    });
  }, [chartSurfaceActive, lm]);

  useEffect(() => {
    if (!schedulingActive) {
      return;
    }
    const tick = () => {
      lm.dispatchCommand({
        type: 'education/hint-scheduler-tick',
        chartSurfaceActive,
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [schedulingActive, chartSurfaceActive, lm]);

  useEffect(() => {
    if (!hint || !chartSurfaceActive) {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      return;
    }

    dismissTimerRef.current = setTimeout(() => {
      lm.dispatchCommand({ type: 'education/dismiss-hint' });
    }, HINT_VISIBLE_MS);

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [hint, chartSurfaceActive, lm]);

  if (!hint || !chartSurfaceActive) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute right-3 top-2 z-30 max-w-sm rounded-lg border border-zinc-600 bg-zinc-900/95 p-3 shadow-xl transition-opacity duration-300 sm:right-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none" aria-hidden>
          💡
        </span>
        <p className="flex-1 text-xs leading-relaxed text-zinc-200">{hint.text}</p>
        <button
          type="button"
          aria-label="Закрыть подсказку"
          onClick={() => lm.dispatchCommand({ type: 'education/dismiss-hint' })}
          className="shrink-0 text-zinc-500 hover:text-zinc-200"
        >
          ×
        </button>
      </div>
    </div>
  );
}
