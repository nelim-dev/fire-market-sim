'use client';

import { useMemo } from 'react';
import type { PortfolioState } from '@/logic/domain/portfolio';
import type { MarketModuleState } from '@/logic/modules/market/state';
import { FIREIDX_SYMBOL } from '@/logic/modules/market/compositeIndex';
import {
  buildNkdBySymbolFromMarket,
  buildPortfolioStatsViewModel,
} from '@/logic/modules/portfolio/statsSelectors';
import { formatRub, formatRubSigned, formatPctSigned } from './formatRub';

function StatCard({
  title,
  value,
  sub,
  valueClassName,
}: {
  title: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="text-xs text-zinc-500 sm:text-sm">{title}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${valueClassName ?? 'text-zinc-100'}`}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}

export function PortfolioStatsTab({
  portfolio,
  simulationEpochMs,
  market,
}: {
  portfolio: PortfolioState;
  simulationEpochMs: number;
  market: MarketModuleState;
}) {
  const stats = useMemo(() => {
    const indexNow =
      market.assetsBySymbol[FIREIDX_SYMBOL]?.currentPriceRub ?? null;
    return buildPortfolioStatsViewModel({
      portfolio,
      simulationEpochMs,
      nkdBySymbol: buildNkdBySymbolFromMarket(market),
      indexNow,
    });
  }, [portfolio, simulationEpochMs, market]);

  const profitPositive = stats.nominalProfitRub >= 0;
  const realPositive = stats.realProfitRub >= 0;
  const excess = stats.vsFireidx;

  return (
    <div className="space-y-3">
      <StatCard
        title="Чистая прибыль"
        value={formatRubSigned(stats.nominalProfitRub)}
        sub={formatPctSigned(stats.nominalProfitPct)}
        valueClassName={profitPositive ? 'text-emerald-400' : 'text-rose-400'}
      />
      <StatCard
        title="Чистая прибыль с учётом инфляции"
        value={formatRubSigned(stats.realProfitRub)}
        valueClassName={realPositive ? 'text-emerald-400' : 'text-rose-400'}
      />
      <StatCard
        title="Число сделок"
        value={String(stats.tradeCount)}
      />
      <StatCard
        title="Комиссии (всего)"
        value={formatRub(stats.totalCommissionRub)}
      />
      <StatCard
        title="Налоги (всего)"
        value={formatRub(stats.totalTaxRub)}
      />
      <StatCard
        title="Превышение над FIRE INDEX (1 год)"
        value={excess ? formatPctSigned(excess.excessReturnPct) : '—'}
        sub={
          excess
            ? [
                `Портфель ${formatPctSigned(excess.portfolioReturnPct)}, индекс ${formatPctSigned(excess.fireidxReturnPct)}`,
                excess.mode === 'earliest-available'
                  ? 'за период с начала доступных данных'
                  : undefined,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Нет данных FIRE INDEX'
        }
        valueClassName={
          excess
            ? excess.excessReturnPct >= 0
              ? 'text-emerald-400'
              : 'text-rose-400'
            : 'text-zinc-400'
        }
      />
    </div>
  );
}
