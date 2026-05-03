import type { PortfolioPosition, PortfolioState } from '@/logic/domain/portfolio';
import {
  positionMarketValueRub,
  positionPnlPct,
  positionPnlRub,
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
}: {
  position: PortfolioPosition;
  portfolio: PortfolioState;
}) {
  const mkt = positionMarketValueRub(p);
  const pnl = positionPnlRub(p);
  const pnlPct = positionPnlPct(p);
  const shareTotal = positionShareOfTotalNavPct(p, portfolio);
  const pnlPositive = pnl >= 0;

  const line1Col1 = p.displayName;
  const line2Col1 =
    p.kind === 'bond' && p.secondaryId ? p.secondaryId : p.ticker;

  return (
    <div className="border-b border-zinc-800/80 py-2 text-[11px] last:border-0 sm:text-xs">
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
        <div className="text-right tabular-nums text-zinc-200">
          {formatRub(mkt)}
        </div>
        <div className="text-right tabular-nums text-zinc-400">
          {shareTotal.toFixed(1).replace('.', ',')}%
        </div>

        <div className="truncate text-zinc-500">{line2Col1}</div>
        <div className="text-right tabular-nums text-zinc-500">
          {p.quantity.toLocaleString('ru-RU')} шт.
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
    </div>
  );
}
