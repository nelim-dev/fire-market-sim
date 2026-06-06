'use client';

import { useMemo } from 'react';
import { useGameState } from '@/hooks/useGameState';
import {
  buildNkdBySymbolFromMarket,
  selectPortfolioCompositionSlices,
} from '@/logic/modules/portfolio/statsSelectors';
import { PortfolioCompositionPieChart } from './PortfolioCompositionPieChart';

export function PortfolioCompositionRightPanel() {
  const portfolio = useGameState((s) => s.portfolio);
  const market = useGameState((s) => s.market);

  const slices = useMemo(() => {
    const cached = portfolio.compositionSnapshot?.slices;
    if (cached && cached.length > 0) {
      return cached;
    }
    return selectPortfolioCompositionSlices(
      portfolio,
      buildNkdBySymbolFromMarket(market)
    );
  }, [portfolio, market]);

  return (
    <div className="mx-auto flex min-h-0 flex-1 w-[90%] max-w-full flex-col gap-4 overflow-hidden text-zinc-100">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Состав портфеля
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Доли по рыночной стоимости (кэш и позиции с НКД облигаций)
        </p>
      </div>
      <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50">
        <PortfolioCompositionPieChart slices={slices} layout="panel" />
      </div>
    </div>
  );
}
