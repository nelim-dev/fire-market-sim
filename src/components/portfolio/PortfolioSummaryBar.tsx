import type { PortfolioState } from '@/logic/domain/portfolio';
import { totalNavRub } from '@/logic/portfolio/portfolioDerived';
import {
  type PortfolioPeriodId,
  selectPortfolioProfitForPeriod,
} from '@/logic/modules/portfolio/selectors';
import { formatRub, formatRubSigned, formatPctSigned } from './formatRub';

const PERIODS: ReadonlyArray<{ id: PortfolioPeriodId; label: string }> = [
  { id: 'week', label: 'неделя' },
  { id: 'month', label: 'месяц' },
  { id: 'year', label: 'год' },
  { id: 'all', label: 'всё время' },
];

export function PortfolioSummaryBar({
  portfolio,
  periodId,
  onPeriodChange,
  simulationEpochMs,
}: {
  portfolio: PortfolioState;
  periodId: PortfolioPeriodId;
  onPeriodChange: (id: PortfolioPeriodId) => void;
  simulationEpochMs: number;
}) {
  const total = totalNavRub(portfolio);
  const { profitRub: profit, profitPct } = selectPortfolioProfitForPeriod(
    portfolio,
    periodId,
    simulationEpochMs
  );
  const profitPositive = profit >= 0;

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <span>Период:</span>
          <select
            value={periodId}
            onChange={(e) =>
              onPeriodChange(e.target.value as (typeof PERIODS)[number]['id'])
            }
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <div className="text-zinc-500">Денежный баланс</div>
          <div className="text-lg font-medium text-zinc-100">
            {formatRub(portfolio.cashRub)}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Всего</div>
          <div className="text-lg font-medium text-zinc-100">
            {formatRub(total)}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Прибыль</div>
          <div
            className={`text-lg font-medium ${
              profitPositive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {formatRubSigned(profit)} ({formatPctSigned(profitPct)}
            {profitPositive ? ' ▲' : ' ▼'})
          </div>
        </div>
      </div>
    </div>
  );
}
