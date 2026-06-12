'use client';

import { useState } from 'react';
import type { PortfolioAssetKind, PortfolioState } from '@/logic/domain/portfolio';
import {
  categoryMarketTotalRub,
  categoryPctOfPortfolio,
  positionsByKind,
} from '@/logic/portfolio/portfolioDerived';
import { formatRub } from './formatRub';
import { PositionRow } from './PositionRow';

const META: Record<PortfolioAssetKind, { title: string; emoji: string }> = {
  stock: { title: 'Акции', emoji: '📈' },
  // Индексы в игре можно только наблюдать (фьючерсы реализуем позже),
  // поэтому в UI секция называется «Фьючерсы».
  index: { title: 'Фьючерсы', emoji: '📊' },
  bond: { title: 'Облигации', emoji: '📜' },
  fund: { title: 'Фонды', emoji: '🏛️' },
};

export function AssetCategorySection({
  kind,
  portfolio,
  selectedSymbol,
}: {
  kind: PortfolioAssetKind;
  portfolio: PortfolioState;
  selectedSymbol?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const list = positionsByKind(portfolio, kind);
  const catTotal = categoryMarketTotalRub(portfolio, kind);
  const pctOfPort = categoryPctOfPortfolio(portfolio, kind);
  const { title, emoji } = META[kind];

  return (
    <section className="rounded-xl border border-zinc-800 bg-black/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-900/50"
      >
        <span className="flex flex-wrap items-center gap-2 text-zinc-100">
          <span className="text-zinc-500">{open ? '▼' : '▶'}</span>
          <span className="font-semibold">
            {title} {emoji}
          </span>
          <span className="text-sm text-zinc-400">
            ({pctOfPort.toFixed(0)}% | {formatRub(catTotal)})
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 pb-2">
          {list.length === 0 ? (
            <p className="px-4 py-4 text-sm text-zinc-500">Нет позиций</p>
          ) : (
            list.map((p) => (
              <PositionRow
                key={p.id}
                position={p}
                portfolio={portfolio}
                selectedSymbol={selectedSymbol}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

export const PORTFOLIO_CATEGORY_ORDER: PortfolioAssetKind[] = [
  'stock',
  'index',
  'bond',
  'fund',
];
