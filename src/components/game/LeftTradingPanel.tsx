'use client';

import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { selectUiLeftPanelMode } from '@/logic/modules/uiState/selectors';
import { MarketOverviewPanel } from '@/components/market/MarketOverviewPanel';
import { PortfolioScreen } from '@/components/portfolio/PortfolioScreen';

function switchLeftPanelMode(mode: 'portfolio' | 'market-overview') {
  gameLoop.getLogicManager().dispatchCommand({
    type: 'uiState/set-left-panel-mode',
    mode,
  });
}

export function LeftTradingPanel() {
  const leftPanelMode = useGameState(selectUiLeftPanelMode);

  if (leftPanelMode === 'market-overview') {
    return <MarketOverviewPanel onBackToPortfolio={() => switchLeftPanelMode('portfolio')} />;
  }

  return (
    <PortfolioScreen
      onOpenMarketOverview={() => switchLeftPanelMode('market-overview')}
    />
  );
}
