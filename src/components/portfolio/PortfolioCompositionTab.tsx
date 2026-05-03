'use client';

import { useState } from 'react';
import type { PortfolioState } from '@/logic/domain/portfolio';
import {
  AssetCategorySection,
  PORTFOLIO_CATEGORY_ORDER,
} from './AssetCategorySection';
import { PortfolioSummaryBar } from './PortfolioSummaryBar';
import { UpcomingPayments } from './UpcomingPayments';

type PeriodId = 'week' | 'month' | 'year' | 'all';

export function PortfolioCompositionTab({
  portfolio,
}: {
  portfolio: PortfolioState;
}) {
  const [periodId, setPeriodId] = useState<PeriodId>('month');

  return (
    <div className="space-y-6">
      <PortfolioSummaryBar
        portfolio={portfolio}
        periodId={periodId}
        onPeriodChange={setPeriodId}
      />
      <div className="space-y-4">
        {PORTFOLIO_CATEGORY_ORDER.map((kind) => (
          <AssetCategorySection key={kind} kind={kind} portfolio={portfolio} />
        ))}
      </div>
      <UpcomingPayments items={portfolio.upcomingPayments} />
    </div>
  );
}
