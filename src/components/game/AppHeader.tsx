'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGameMenu } from '@/components/game/GameMenu';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import {
  formatSimulationDateOnly,
  formatSimulationTimeOnly,
} from '@/logic/utils/formatSimulationClock';
import {
  TIME_SCALE_PRESETS,
  type TimeScalePreset,
} from '@/logic/simulation/simulationConfig';
import { formatRub } from '@/components/portfolio/formatRub';
import {
  selectIsPaused,
  selectMacroSnapshot,
  selectPortfolio,
  selectSimulationEpochMs,
  selectTimeScale,
} from '@/logic/stateSelectors';

function NavLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={`whitespace-nowrap text-xs font-medium transition hover:text-white sm:text-sm ${
        active ? 'text-white' : 'text-zinc-500'
      }`}
    >
      {children}
    </Link>
  );
}

function formatMacroPrice(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

export function AppHeader() {
  const { openMenu } = useGameMenu();
  const simulationEpochMs = useGameState(selectSimulationEpochMs);
  const isPaused = useGameState(selectIsPaused);
  const timeScale = useGameState(selectTimeScale);
  const cashRub = useGameState((s) => selectPortfolio(s).cashRub);
  const macro = useGameState(selectMacroSnapshot);
  const lm = gameLoop.getLogicManager();

  const dateStr = formatSimulationDateOnly(simulationEpochMs);
  const timeStr = formatSimulationTimeOnly(simulationEpochMs);

  return (
    <header className="shrink-0 border-b border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 sm:gap-x-4 sm:px-5 lg:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 font-semibold tracking-tight text-white hover:text-zinc-200"
          >
            <span className="text-base sm:text-lg" aria-hidden>
              🔥
            </span>
            <span className="whitespace-nowrap text-sm sm:text-base">
              FIRE Market Sim
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-zinc-500 sm:gap-x-3 sm:text-xs lg:text-sm">
            <span className="text-zinc-300" title="Денежный баланс">
              💰 {formatRub(cashRub)}
            </span>
            <span title="Нефть Brent, $/ббл">
              🛢 {formatMacroPrice(macro.brentUsd, 2)}
            </span>
            <span title="Курс USD/RUB">
              💵 {formatMacroPrice(macro.usdRub, 2)} ₽/$
            </span>
            {macro.keyRatePct !== null ? (
              <span title="Ключевая ставка ЦБ РФ">
                📈 {macro.keyRatePct.toFixed(1)}%
              </span>
            ) : null}
            {macro.inflation12mPct !== null ? (
              <span
                title="Инфляция за последние 12 месяцев (MoM, % годовых экв.)"
              >
                📉 {macro.inflation12mPct.toFixed(1)}%
              </span>
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
          <nav className="flex flex-wrap items-center justify-end gap-x-2 sm:gap-x-3 md:gap-x-4">
            <NavLink href="/">Портфель</NavLink>
            <NavLink href="/learn">Обучение</NavLink>
            <NavLink href="/achievements">Достижения</NavLink>
            <button
              type="button"
              onClick={openMenu}
              className="whitespace-nowrap text-xs font-medium text-zinc-500 transition hover:text-white sm:text-sm"
            >
              Меню
            </button>
          </nav>

          <div className="flex shrink-0 flex-col items-center gap-1 border-l border-zinc-800 pl-2 sm:gap-1.5 sm:pl-3 md:pl-4">
            <div className="text-center font-mono text-[10px] leading-tight text-sky-400 tabular-nums sm:text-[11px]">
              <div>{dateStr}</div>
              <div>{timeStr}</div>
            </div>
            <div className="flex items-center justify-center gap-0.5">
              <button
                type="button"
                onClick={() =>
                  lm.dispatchCommand(
                    isPaused ? { type: 'runtime/resume' } : { type: 'runtime/pause' }
                  )
                }
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-amber-600 text-[10px] font-medium text-white hover:bg-amber-500"
                title={isPaused ? 'Продолжить' : 'Пауза'}
              >
                {isPaused ? '▶' : '⏸'}
              </button>
              <div className="flex flex-wrap items-center justify-center gap-0.5">
                {TIME_SCALE_PRESETS.map((p: TimeScalePreset) => (
                  <button
                    key={p}
                    type="button"
                    disabled={timeScale === p}
                    onClick={() =>
                      lm.dispatchCommand({ type: 'runtime/set-time-scale', preset: p })
                    }
                    className={`flex h-6 min-w-[1.4rem] items-center justify-center rounded px-0.5 text-[9px] font-medium tabular-nums sm:min-w-[1.5rem] sm:text-[10px] ${
                      timeScale === p
                        ? 'bg-sky-700 text-white'
                        : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                    }`}
                  >
                    {p}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}