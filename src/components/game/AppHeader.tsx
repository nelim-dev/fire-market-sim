'use client';

import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { formatSimulationTime } from '@/logic/simulation/formatSimulationTime';
import {
  TIME_SCALE_PRESETS,
  type TimeScalePreset,
} from '@/logic/simulation/simulationConfig';

export function AppHeader() {
  const simulationEpochMs = useGameState((s) => s.simulationEpochMs);
  const isPaused = useGameState((s) => s.isPaused);
  const timeScale = useGameState((s) => s.timeScale);
  const lm = gameLoop.getLogicManager();

  return (
    <header className="border-b border-gray-700 bg-gray-800 px-4 py-3 text-gray-100">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-lg font-semibold text-sky-300">
          {formatSimulationTime(simulationEpochMs, 'ru-RU')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (isPaused ? lm.resume() : lm.pause())}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium hover:bg-amber-500"
          >
            {isPaused ? '▶ Продолжить' : '⏸ Пауза'}
          </button>
          <div className="flex gap-1">
            {TIME_SCALE_PRESETS.map((p: TimeScalePreset) => (
              <button
                key={p}
                type="button"
                disabled={timeScale === p}
                onClick={() => lm.setTimeScalePreset(p)}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  timeScale === p
                    ? 'bg-sky-700 text-white'
                    : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                }`}
              >
                {p}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
