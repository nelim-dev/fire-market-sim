'use client';

import { useState } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { PortfolioCompositionTab } from './PortfolioCompositionTab';
import { PortfolioPlaceholderTab } from './PortfolioPlaceholderTab';

type MainTab = 'composition' | 'history' | 'stats';

const tabs: { id: MainTab; label: string }[] = [
  { id: 'composition', label: 'Состав' },
  { id: 'history', label: 'История' },
  { id: 'stats', label: 'Статистика' },
];

export function PortfolioScreen() {
  const portfolio = useGameState((s) => s.portfolio);
  const [tab, setTab] = useState<MainTab>('composition');

  return (
    <div className="text-zinc-100">
      <h1 className="text-2xl font-bold tracking-tight">Мой портфель</h1>
      <nav className="mt-4 flex flex-wrap gap-4 border-b border-zinc-800 pb-2">
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
      <div className="mt-6">
        {tab === 'composition' && (
          <PortfolioCompositionTab portfolio={portfolio} />
        )}
        {tab === 'history' && <PortfolioPlaceholderTab tab="history" />}
        {tab === 'stats' && <PortfolioPlaceholderTab tab="stats" />}
      </div>
    </div>
  );
}
