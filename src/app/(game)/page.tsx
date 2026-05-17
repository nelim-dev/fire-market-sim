import { GameWorkspace } from '@/components/game/GameWorkspace';
import { LeftTradingPanel } from '@/components/game/LeftTradingPanel';
import { TradingRightPanel } from '@/components/market/TradingRightPanel';

/**
 * Главная: портфель слева, рабочая область справа (ТЗ §6).
 */
export default function GameHomePage() {
  return (
    <GameWorkspace
      left={<LeftTradingPanel />}
      right={<TradingRightPanel />}
    />
  );
}
