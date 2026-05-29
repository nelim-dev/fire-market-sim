'use client';

import Link from 'next/link';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import type { MarketOverviewAssetKindFilter } from '@/logic/modules/uiState/state';
import {
  selectMarketOverviewRows,
  selectUiMarketOverviewFilters,
  selectUiSelectedSymbol,
  type MarketOverviewInstrumentRow,
} from '@/logic/modules/uiState/selectors';
import { formatRub } from '@/components/portfolio/formatRub';

const ASSET_KIND_OPTIONS: { id: MarketOverviewAssetKindFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'stock', label: 'Акции' },
  { id: 'bond', label: 'Облигации' },
  { id: 'fund', label: 'Фонды' },
  { id: 'index', label: 'Индексы' },
];

function formatPct(n: number | null): string {
  if (n === null || Number.isNaN(n)) {
    return '—';
  }
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function MarketOverviewPanel({
  onBackToPortfolio,
}: {
  onBackToPortfolio: () => void;
}) {
  const filters = useGameState(selectUiMarketOverviewFilters);
  const { available, locked } = useGameState(selectMarketOverviewRows);
  const selectedSymbol = useGameState(selectUiSelectedSymbol);
  const lm = gameLoop.getLogicManager();

  const setFilters = (patch: Partial<typeof filters>) => {
    lm.dispatchCommand({
      type: 'uiState/set-market-overview-filters',
      patch,
    });
  };

  const selectInstrument = (symbol: string) => {
    lm.dispatchCommand({ type: 'uiState/select-instrument', symbol });
  };

  return (
    <div className="text-zinc-100">
      <MarketOverviewHeader onBackToPortfolio={onBackToPortfolio} />

      <div className="mt-4 space-y-3">
        <label className="block text-xs text-zinc-500">
          Поиск
          <input
            type="search"
            value={filters.searchQuery}
            onChange={(e) => setFilters({ searchQuery: e.target.value })}
            placeholder="Тикер или название"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {ASSET_KIND_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilters({ assetKindFilter: opt.id })}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                filters.assetKindFilter === opt.id
                  ? 'bg-sky-700 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={filters.showAvailable}
              onChange={(e) => setFilters({ showAvailable: e.target.checked })}
              className="accent-sky-600"
            />
            Доступные
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={filters.showLocked}
              onChange={(e) => setFilters({ showLocked: e.target.checked })}
              className="accent-sky-600"
            />
            Закрытые
          </label>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        {filters.showAvailable ? (
          <InstrumentSection
            title="Доступные"
            rows={available}
            selectedSymbol={selectedSymbol}
            variant="available"
            onSelect={selectInstrument}
          />
        ) : null}
        {filters.showLocked ? (
          <InstrumentSection
            title="Закрытые"
            rows={locked}
            selectedSymbol={selectedSymbol}
            variant="locked"
            onSelect={selectInstrument}
          />
        ) : null}
      </div>

    </div>
  );
}

function MarketOverviewHeader({
  onBackToPortfolio,
}: {
  onBackToPortfolio: () => void;
}) {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Обзор рынка</h1>
      <button
        type="button"
        onClick={onBackToPortfolio}
        className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-sky-700/60 hover:bg-zinc-800 hover:text-white"
      >
        Мой портфель
      </button>
    </div>
  );
}

function InstrumentSection({
  title,
  rows,
  selectedSymbol,
  variant,
  onSelect,
}: {
  title: string;
  rows: MarketOverviewInstrumentRow[];
  selectedSymbol: string | null;
  variant: 'available' | 'locked';
  onSelect: (symbol: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {variant === 'locked' ? '🔒 ' : ''}
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-zinc-600">Нет инструментов</p>
      ) : (
        <ul className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-black/30">
          {rows.map((row) => (
            <li key={row.symbol}>
              {variant === 'available' ? (
                <AvailableRow
                  row={row}
                  isSelected={selectedSymbol === row.symbol}
                  onSelect={() => onSelect(row.symbol)}
                />
              ) : (
                <LockedRow row={row} onSelect={() => onSelect(row.symbol)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AvailableRow({
  row,
  isSelected,
  onSelect,
}: {
  row: MarketOverviewInstrumentRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const change = row.changePct1d;
  const changePositive = change != null && change >= 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-zinc-900/80 ${
        isSelected ? 'bg-sky-950/40 ring-1 ring-inset ring-sky-800/50' : ''
      }`}
    >
      <span className="min-w-0">
        <span className="font-mono font-medium text-zinc-100">{row.ticker}</span>
        <span className="ml-2 truncate text-xs text-zinc-500">{row.displayName}</span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        <span className="block text-zinc-200">
          {row.currentPriceRub == null ? '—' : formatRub(row.currentPriceRub)}
        </span>
        <span
          className={`text-xs ${
            change == null
              ? 'text-zinc-500'
              : changePositive
                ? 'text-emerald-400'
                : 'text-red-400'
          }`}
        >
          {formatPct(change)}
        </span>
      </span>
    </button>
  );
}

function LockedRow({
  row,
  onSelect,
}: {
  row: MarketOverviewInstrumentRow;
  onSelect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 text-left font-mono text-zinc-400 hover:text-zinc-200"
      >
        {row.ticker}
      </button>
      <Link
        href="/learn"
        className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition hover:border-amber-700/50 hover:text-amber-200"
      >
        Пройти тест
      </Link>
    </div>
  );
}
