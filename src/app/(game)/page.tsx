import { GameWorkspace } from '@/components/game/GameWorkspace';
import { MarketAssetRightPanel } from '@/components/market/MarketAssetRightPanel';
import { PortfolioScreen } from '@/components/portfolio/PortfolioScreen';

/**
 * Главная: портфель слева, рабочая область справа (ТЗ §6).
 */
export default function GameHomePage() {
  return (
    <GameWorkspace
      left={<PortfolioScreen />}
      right={<MarketAssetRightPanel />}
    />
  );
}
