'use client';

import { useGameState } from '@/hooks/useGameState';
import { selectEducationIsSymbolUnlocked } from '@/logic/modules/education/selectors';
import {
  selectUiLeftPanelMode,
  selectUiPortfolioMainTab,
  selectUiSelectedSymbol,
} from '@/logic/modules/uiState/selectors';
import { AnalyticsRightPanel } from '@/components/analytics/AnalyticsRightPanel';
import { PortfolioCompositionRightPanel } from '@/components/portfolio/PortfolioCompositionRightPanel';
import { LockedInstrumentPanel } from './LockedInstrumentPanel';
import { MarketAssetRightPanel } from './MarketAssetRightPanel';

export function TradingRightPanel() {
  const leftPanelMode = useGameState(selectUiLeftPanelMode);
  const portfolioMainTab = useGameState(selectUiPortfolioMainTab);
  const symbol = useGameState(selectUiSelectedSymbol);
  const isUnlocked = useGameState((s) =>
    symbol ? selectEducationIsSymbolUnlocked(symbol)(s) : true
  );

  if (leftPanelMode === 'analytics') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AnalyticsRightPanel />
      </div>
    );
  }

  if (
    leftPanelMode === 'portfolio' &&
    portfolioMainTab === 'stats'
  ) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <PortfolioCompositionRightPanel />
      </div>
    );
  }

  if (!symbol) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/50 p-8 text-sm text-zinc-500">
        Выберите инструмент в портфеле или в обзоре рынка слева.
      </div>
    );
  }

  if (!isUnlocked) {
    return <LockedInstrumentPanel symbol={symbol} />;
  }

  return <MarketAssetRightPanel symbol={symbol} />;
}
