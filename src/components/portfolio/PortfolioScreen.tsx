'use client';

import { useMemo, useState } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { selectUpcomingPayments } from '@/logic/modules/portfolio/selectors';
import { PortfolioCompositionTab } from './PortfolioCompositionTab';
import { PortfolioPlaceholderTab } from './PortfolioPlaceholderTab';
import { TradeHistoryTab } from './TradeHistoryTab';
import { OpenOrdersTab } from './OpenOrdersTab';

type MainTab = 'composition' | 'history' | 'orders' | 'stats';

const tabs: { id: MainTab; label: string }[] = [
  { id: 'composition', label: 'Состав' },
  { id: 'history', label: 'История' },
  { id: 'orders', label: 'Заявки' },
  { id: 'stats', label: 'Статистика' },
];

const PANEL_SWITCH_BUTTON_CLASS =
  'mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-sky-700/60 hover:bg-zinc-800 hover:text-white';

export function PortfolioScreen({
  onOpenMarketOverview,
}: {
  onOpenMarketOverview?: () => void;
} = {}) {
  const portfolio = useGameState((s) => s.portfolio);
  const simulationEpochMs = useGameState((s) => s.simulationEpochMs);
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
  const [tab, setTab] = useState<MainTab>('composition');

  return (
    <div className="text-zinc-100">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Мой портфель</h1>
      {onOpenMarketOverview ? (
        <button
          type="button"
          onClick={onOpenMarketOverview}
          className={PANEL_SWITCH_BUTTON_CLASS}
        >
          Обзор рынка
        </button>
      ) : null}
      <nav className="mt-3 flex flex-wrap gap-2 border-b border-zinc-800 pb-2 sm:mt-4 sm:gap-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
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
        {tab === 'stats' && <PortfolioPlaceholderTab tab="stats" />}
      </div>
    </div>
  );
}
