'use client';

import { useMemo } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { selectUpcomingPayments } from '@/logic/modules/portfolio/selectors';
import { selectUiPortfolioMainTab } from '@/logic/modules/uiState/selectors';
import type { PortfolioMainTab } from '@/logic/modules/uiState/state';
import { PortfolioCompositionTab } from './PortfolioCompositionTab';
import { PortfolioStatsTab } from './PortfolioStatsTab';
import { TradeHistoryTab } from './TradeHistoryTab';
import { OpenOrdersTab } from './OpenOrdersTab';

const tabs: { id: PortfolioMainTab; label: string }[] = [
  { id: 'composition', label: 'Состав' },
  { id: 'history', label: 'История' },
  { id: 'orders', label: 'Заявки' },
  { id: 'stats', label: 'Статистика' },
];

const PANEL_SWITCH_BUTTON_CLASS =
  'rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-sky-700/60 hover:bg-zinc-800 hover:text-white';

function setPortfolioMainTab(tab: PortfolioMainTab): void {
  gameLoop.getLogicManager().dispatchCommand({
    type: 'uiState/set-portfolio-main-tab',
    tab,
  });
}

export function PortfolioScreen({
  onOpenMarketOverview,
  onOpenAnalytics,
}: {
  onOpenMarketOverview?: () => void;
  onOpenAnalytics?: () => void;
} = {}) {
  const portfolio = useGameState((s) => s.portfolio);
  const market = useGameState((s) => s.market);
  const simulationEpochMs = useGameState((s) => s.simulationEpochMs);
  const tab = useGameState(selectUiPortfolioMainTab);
  const marketDetails = useGameState((s) => s.market.details);
  const instrumentCatalog = useGameState((s) => s.market.instrumentCatalog);
  const upcomingPayments = useMemo(
    () =>
      selectUpcomingPayments(
        portfolio,
        marketDetails,
        instrumentCatalog,
        simulationEpochMs
      ),
    [portfolio, marketDetails, instrumentCatalog, simulationEpochMs]
  );

  return (
    <div className="text-zinc-100">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Мой портфель</h1>
      {onOpenMarketOverview || onOpenAnalytics ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {onOpenMarketOverview ? (
            <button
              type="button"
              onClick={onOpenMarketOverview}
              className={PANEL_SWITCH_BUTTON_CLASS}
            >
              Обзор рынка
            </button>
          ) : null}
          {onOpenAnalytics ? (
            <button
              type="button"
              onClick={onOpenAnalytics}
              className={PANEL_SWITCH_BUTTON_CLASS}
            >
              Аналитика
            </button>
          ) : null}
        </div>
      ) : null}
      <nav className="mt-3 flex flex-wrap gap-2 border-b border-zinc-800 pb-2 sm:mt-4 sm:gap-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPortfolioMainTab(t.id)}
            className={`rounded-md px-2 py-1 text-sm font-medium transition ${
              tab === t.id
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="mt-4 sm:mt-6">
        {tab === 'composition' && (
          <PortfolioCompositionTab
            portfolio={portfolio}
            simulationEpochMs={simulationEpochMs}
            upcomingPayments={upcomingPayments}
          />
        )}
        {tab === 'history' && (
          <TradeHistoryTab entries={portfolio.ledger} />
        )}
        {tab === 'orders' && <OpenOrdersTab />}
        {tab === 'stats' && (
          <PortfolioStatsTab
            portfolio={portfolio}
            simulationEpochMs={simulationEpochMs}
            market={market}
          />
        )}
      </div>
    </div>
  );
}
