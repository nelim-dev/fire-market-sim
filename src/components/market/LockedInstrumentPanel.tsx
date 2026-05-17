'use client';

import Link from 'next/link';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import {
  selectMarketAsset,
  selectMarketInstrumentCatalog,
} from '@/logic/modules/market/selectors';
import { selectEducationIsSymbolUnlocked } from '@/logic/modules/education/selectors';

export function LockedInstrumentPanel({ symbol }: { symbol: string }) {
  const asset = useGameState(selectMarketAsset(symbol));
  const catalog = useGameState(selectMarketInstrumentCatalog);
  const catalogRow = catalog.find(
    (row) => row.symbol.toUpperCase() === symbol.toUpperCase()
  );
  const displayName = asset?.displayName ?? catalogRow?.displayName ?? symbol;
  const lm = gameLoop.getLogicManager();

  const goBack = () => {
    const state = lm.getState();
    const firstUnlocked = catalog.find((row) =>
      selectEducationIsSymbolUnlocked(row.symbol)(state)
    )?.symbol;
    if (firstUnlocked) {
      lm.dispatchCommand({
        type: 'uiState/select-instrument',
        symbol: firstUnlocked,
      });
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 rounded-xl border border-zinc-800 bg-zinc-950/50 p-8 text-zinc-100">
      <div>
        <p className="text-2xl" aria-hidden>
          🔒
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">
          {symbol} — {displayName}
        </h2>
      </div>
      <p className="text-sm leading-relaxed text-zinc-400">
        Для доступа к этому инструменту необходимо пройти тест в разделе «Обучение».
        После успешного прохождения инструмент появится в списке доступных.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/learn"
          className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600"
        >
          Перейти к тесту
        </Link>
        <button
          type="button"
          onClick={goBack}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
        >
          Вернуться
        </button>
      </div>
    </div>
  );
}
