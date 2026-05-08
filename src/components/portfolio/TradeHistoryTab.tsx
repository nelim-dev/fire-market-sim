'use client';

import { useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { TradeLedgerEntry } from '@/logic/domain/portfolio';
import { formatRub } from './formatRub';

type SortColumn = 'date' | 'ticker' | 'action' | 'price' | 'quantity' | 'amount';
type SortDirection = 'asc' | 'desc';

const PAGE_SIZE = 50;

const SORT_OPTIONS: { id: SortColumn; label: string }[] = [
  { id: 'date', label: 'Дата' },
  { id: 'ticker', label: 'Тикер' },
  { id: 'action', label: 'Действие' },
  { id: 'price', label: 'Цена' },
  { id: 'quantity', label: 'Кол-во' },
  { id: 'amount', label: 'Сумма' },
];

function formatDate(epochMs: number): string {
  return formatInTimeZone(epochMs, 'Europe/Moscow', 'dd.MM.yyyy HH:mm');
}

function toCsv(entries: readonly TradeLedgerEntry[]): string {
  const header = 'Дата,Тикер,Действие,Цена,Количество,Сумма';
  const rows = entries.map((entry) =>
    [
      formatDate(entry.simulationEpochMs),
      entry.ticker,
      entry.action === 'buy' ? 'Купить' : 'Продать',
      entry.priceRub.toFixed(2),
      entry.quantity,
      entry.amountRub.toFixed(2),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

function sortedEntries(
  entries: readonly TradeLedgerEntry[],
  sortBy: SortColumn,
  direction: SortDirection
): TradeLedgerEntry[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return sign * (a.simulationEpochMs - b.simulationEpochMs);
      case 'ticker':
        return sign * a.ticker.localeCompare(b.ticker);
      case 'action':
        return sign * a.action.localeCompare(b.action);
      case 'price':
        return sign * (a.priceRub - b.priceRub);
      case 'quantity':
        return sign * (a.quantity - b.quantity);
      case 'amount':
      default:
        return sign * (a.amountRub - b.amountRub);
    }
  });
}

export function TradeHistoryTab({
  entries,
}: {
  entries: readonly TradeLedgerEntry[];
}) {
  const [sortBy, setSortBy] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const sorted = useMemo(
    () => sortedEntries(entries, sortBy, sortDirection),
    [entries, sortBy, sortDirection]
  );
  const visible = sorted.slice(0, visibleCount);

  const toggleSort = (nextColumn: SortColumn) => {
    if (sortBy === nextColumn) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(nextColumn);
    setSortDirection('desc');
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(sorted)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trade-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (entries.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-100">История сделок</h2>
        <p className="text-sm text-zinc-400">Сделок пока нет.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">История сделок</h2>
        <button
          type="button"
          onClick={exportCsv}
          className="shrink-0 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600"
        >
          Экспорт CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-zinc-500">
        <span className="shrink-0 font-medium text-zinc-600">Сортировка:</span>
        {SORT_OPTIONS.map(({ id, label }) => {
          const active = sortBy === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleSort(id)}
              className={`rounded px-1.5 py-0.5 font-medium transition ${
                active
                  ? 'bg-zinc-800 text-zinc-200'
                  : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
              }`}
            >
              {label}
              {active ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          );
        })}
      </div>

      <ul className="divide-y divide-zinc-800">
        {visible.map((entry) => {
          const isBuy = entry.action === 'buy';
          const actionLabel = isBuy ? 'Купить' : 'Продать';
          return (
            <li key={entry.id} className="py-3 first:pt-0">
              {/* Первая колонка — гибкая (тикер/дата), 2–3 — по ширине контента рядом, без «дыры» между ними */}
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-0.5 text-xs leading-snug sm:text-sm">
                <div className="min-w-0 truncate font-mono text-zinc-200">{entry.ticker}</div>
                <div className="shrink-0 whitespace-nowrap font-mono tabular-nums text-zinc-300">
                  {formatRub(entry.priceRub)}
                </div>
                <div
                  className={`shrink-0 whitespace-nowrap text-right font-medium ${
                    isBuy ? 'text-sky-300' : 'text-emerald-400'
                  }`}
                >
                  {actionLabel}
                </div>
              </div>
              <div className="mt-0.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-0.5 text-xs leading-snug sm:text-sm">
                <div className="min-w-0 truncate font-mono text-zinc-400">
                  {formatDate(entry.simulationEpochMs)}
                </div>
                <div className="shrink-0 whitespace-nowrap font-mono tabular-nums text-zinc-300">
                  {entry.quantity} ед.
                </div>
                <div className="shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-zinc-200">
                  {formatRub(entry.amountRub)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          Показано: {visible.length} из {sorted.length}
        </span>
        <button
          type="button"
          disabled={visible.length >= sorted.length}
          onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-zinc-600"
        >
          Показать ещё
        </button>
      </div>
    </div>
  );
}
