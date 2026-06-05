import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import type { PortfolioPosition, PortfolioState } from '@/logic/domain/portfolio';
import {
  selectInstrumentPublicCode,
  selectMarketAsset,
} from '@/logic/modules/market/selectors';
import {
  positionMarketValueRub,
  positionPnlPct,
  positionPnlRub,
  positionQuantity,
  positionShareOfTotalNavPct,
} from '@/logic/portfolio/portfolioDerived';
import {
  formatPctSigned,
  formatRub,
  formatRubSignedDetailed,
} from './formatRub';

export function PositionRow({
  position: p,
  portfolio,
  selectedSymbol,
}: {
  position: PortfolioPosition;
  portfolio: PortfolioState;
  selectedSymbol?: string | null;
}) {
  const mkt = positionMarketValueRub(p);
  const pnl = positionPnlRub(p);
  const pnlPct = positionPnlPct(p);
  const shareTotal = positionShareOfTotalNavPct(p, portfolio);
  const pnlPositive = pnl >= 0;

  const assetMeta = useGameState((s) => selectMarketAsset(p.ticker)(s));
  const publicCode = useGameState((s) => selectInstrumentPublicCode(p.ticker)(s));
  const line1Col1 = assetMeta?.displayName ?? p.displayName;
  const line2Col1 = publicCode;
  const isSelected =
    selectedSymbol != null &&
    p.ticker.toUpperCase() === selectedSymbol.toUpperCase();

  return (
    <button
      type="button"
      onClick={() =>
        gameLoop.getLogicManager().dispatchCommand({
          type: 'uiState/select-instrument',
          symbol: p.ticker,
        })
      }
      className={`w-full border-b border-zinc-800/80 py-2 text-left text-[11px] transition last:border-0 hover:bg-zinc-900/50 sm:text-xs ${
        isSelected ? 'bg-sky-950/30 ring-1 ring-inset ring-sky-800/40' : ''
      }`}
    >
      <div
        className="grid grid-cols-4 items-baseline gap-x-2 gap-y-0.5"
        style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,0.9fr) minmax(0,1fr) minmax(0,0.65fr)' }}
      >
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="shrink-0 text-zinc-600" aria-hidden>
            •
          </span>
          <span className="truncate font-medium text-zinc-100">{line1Col1}</span>
        </div>
        <div className="text-right tabular-nums text-zinc-300">
          <span className="text-zinc-600">•</span>
          {formatRub(p.lastPriceRub)}
        </div>
        <div className="text-right tabular-nums text-zinc-200">{formatRub(mkt)}</div>
        <div className="text-right tabular-nums text-zinc-400">
          {shareTotal.toFixed(1).replace('.', ',')}%
        </div>

        <div className="truncate text-zinc-500">{line2Col1}</div>
        <div className="text-right tabular-nums text-zinc-500">
          {positionQuantity(p).toLocaleString('ru-RU')} шт.
        </div>
        <div
          className={`text-right tabular-nums ${
            pnlPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {formatRubSignedDetailed(pnl)}
        </div>
        <div
          className={`text-right tabular-nums ${
            pnlPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {formatPctSigned(pnlPct)} {pnlPositive ? '▲' : '▼'}
        </div>
      </div>
    </button>
  );
}
