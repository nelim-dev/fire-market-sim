import type { PortfolioPosition } from '@/logic/domain/portfolio';
import {
  positionMarketValueRub,
  positionPnlPct,
  positionPnlRub,
  positionShareOfCategoryRub,
} from '@/logic/portfolio/portfolioDerived';
import {
  formatPctSigned,
  formatRub,
  formatRubSignedDetailed,
} from './formatRub';

export function PositionRow({
  position: p,
  categoryTotalRub,
}: {
  position: PortfolioPosition;
  categoryTotalRub: number;
}) {
  const mkt = positionMarketValueRub(p);
  const pnl = positionPnlRub(p);
  const pnlPct = positionPnlPct(p);
  const share = positionShareOfCategoryRub(p, categoryTotalRub);
  const pnlPositive = pnl >= 0;

  const subLabel =
    p.kind === 'bond' && p.secondaryId
      ? p.secondaryId
      : p.ticker;

  return (
    <div className="grid grid-cols-1 gap-2 border-b border-zinc-800/80 py-3 text-sm last:border-0 sm:grid-cols-12 sm:items-center sm:gap-3">
      <div className="sm:col-span-3">
        <div className="font-medium text-zinc-100">{p.displayName}</div>
        <div className="text-xs text-zinc-500">{subLabel}</div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-400 sm:col-span-6">
        <span>
          Цена:{' '}
          <span className="text-zinc-200">{formatRub(p.lastPriceRub)}</span>
        </span>
        <span>
          Кол-во:{' '}
          <span className="text-zinc-200">
            {p.quantity.toLocaleString('ru-RU')} шт.
          </span>
        </span>
        <span>
          Всего:{' '}
          <span className="text-zinc-200">{formatRub(mkt)}</span>
        </span>
        <span>
          Доля:{' '}
          <span className="text-zinc-200">
            {share.toFixed(1).replace('.', ',')}%
          </span>
        </span>
      </div>
      <div
        className={`text-right sm:col-span-3 ${
          pnlPositive ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        <div className="font-medium">
          {formatRubSignedDetailed(pnl)} ({formatPctSigned(pnlPct)})
        </div>
        <div className="text-xs text-zinc-500">
          {pnlPositive ? '▲' : '▼'}
        </div>
      </div>
    </div>
  );
}
