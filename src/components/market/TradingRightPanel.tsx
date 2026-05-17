'use client';

import { useGameState } from '@/hooks/useGameState';
import { selectEducationIsSymbolUnlocked } from '@/logic/modules/education/selectors';
import { selectUiSelectedSymbol } from '@/logic/modules/uiState/selectors';
import { LockedInstrumentPanel } from './LockedInstrumentPanel';
import { MarketAssetRightPanel } from './MarketAssetRightPanel';

export function TradingRightPanel() {
  const symbol = useGameState(selectUiSelectedSymbol);
  const isUnlocked = useGameState((s) =>
    symbol ? selectEducationIsSymbolUnlocked(symbol)(s) : true
  );

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
