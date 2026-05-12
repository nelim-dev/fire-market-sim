'use client';

import { useState } from 'react';
import type { PortfolioState, UpcomingPayment } from '@/logic/domain/portfolio';
import type { PortfolioPeriodId } from '@/logic/modules/portfolio/selectors';
import {
  AssetCategorySection,
  PORTFOLIO_CATEGORY_ORDER,
} from './AssetCategorySection';
import { PortfolioSummaryBar } from './PortfolioSummaryBar';
import { UpcomingPayments } from './UpcomingPayments';

export function PortfolioCompositionTab({
  portfolio,
  simulationEpochMs,
  upcomingPayments,
}: {
  portfolio: PortfolioState;
  simulationEpochMs: number;
  upcomingPayments: UpcomingPayment[];
}) {
  const [periodId, setPeriodId] = useState<PortfolioPeriodId>('month');

  return (
    <div className="space-y-6">
      <PortfolioSummaryBar
        portfolio={portfolio}
        periodId={periodId}
        onPeriodChange={setPeriodId}
        simulationEpochMs={simulationEpochMs}
      />
      <div className="space-y-4">
        {PORTFOLIO_CATEGORY_ORDER.map((kind) => (
          <AssetCategorySection key={kind} kind={kind} portfolio={portfolio} />
        ))}
      </div>
      <UpcomingPayments items={upcomingPayments} />
    </div>
  );
}
