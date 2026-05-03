import { GameWorkspace } from '@/components/game/GameWorkspace';
import { RightPanelPlaceholder } from '@/components/game/RightPanelPlaceholder';
import { PortfolioScreen } from '@/components/portfolio/PortfolioScreen';

/**
 * Главная: портфель слева, рабочая область справа (ТЗ §6).
 */
export default function GameHomePage() {
  return (
    <GameWorkspace
      left={<PortfolioScreen />}
      right={<RightPanelPlaceholder />}
    />
  );
}
