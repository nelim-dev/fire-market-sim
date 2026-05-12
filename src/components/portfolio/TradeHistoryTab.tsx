'use client';

import { useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { LedgerEntry, LedgerEntryKind } from '@/logic/domain/portfolio';
import { formatRub } from './formatRub';

type SortColumn = 'date' | 'ticker' | 'kind' | 'amount';
type SortDirection = 'asc' | 'desc';

const PAGE_SIZE = 50;

const SORT_OPTIONS: { id: SortColumn; label: string }[] = [
  { id: 'date', label: 'Дата' },
  { id: 'ticker', label: 'Тикер' },
  { id: 'kind', label: 'Тип' },
  { id: 'amount', label: 'Сумма' },
];

interface FilterGroup {
  id: string;
  label: string;
  kinds: readonly LedgerEntryKind[];
}

/**
 * Группы фильтров «по смыслу операции» (см. план M4 §10).
 * UI хранит активные группы; запись попадает в выдачу если её `kind` входит хотя бы в одну.
 */
const FILTER_GROUPS: readonly FilterGroup[] = [
  { id: 'trades', label: 'Покупки/Продажи', kinds: ['trade-buy', 'trade-sell'] },
  { id: 'dividends', label: 'Дивиденды', kinds: ['dividend-gross', 'dividend-tax'] },
  { id: 'coupons', label: 'Купоны', kinds: ['coupon-gross', 'coupon-tax'] },
  {
    id: 'nkd',
    label: 'НКД',
    kinds: ['accrued-coupon-paid', 'accrued-coupon-received'],
  },
  { id: 'commission', label: 'Комиссии', kinds: ['commission'] },
  { id: 'capital-gain', label: 'Налог с прибыли', kinds: ['capital-gain-tax'] },
  { id: 'redemption', label: 'Погашения', kinds: ['redemption'] },
];

const KIND_LABELS: Record<LedgerEntryKind, string> = {
  'trade-buy': 'Покупка',
  'trade-sell': 'Продажа',
  commission: 'Комиссия',
  'accrued-coupon-paid': 'НКД при покупке',
  'accrued-coupon-received': 'НКД при продаже',
  'dividend-gross': 'Дивиденд (gross)',
  'dividend-tax': 'НДФЛ с дивиденда',
  'coupon-gross': 'Купон (gross)',
  'coupon-tax': 'НДФЛ с купона',
  'capital-gain-tax': 'НДФЛ с прибыли',
  redemption: 'Погашение облигации',
};

function formatDate(epochMs: number): string {
  return formatInTimeZone(epochMs, 'Europe/Moscow', 'dd.MM.yyyy HH:mm');
}

function formatSignedRub(amountRub: number): string {
  const sign = amountRub >= 0 ? '+' : '';
  return `${sign}${formatRub(amountRub)} ₽`;
}

function toCsv(entries: readonly LedgerEntry[]): string {
  const header = 'Дата,Тикер,Тип,Сумма (₽),Количество,Цена (₽),Налоговая база (₽)';
  const rows = entries.map((entry) =>
    [
      formatDate(entry.simulationEpochMs),
      entry.ticker,
      KIND_LABELS[entry.kind] ?? entry.kind,
      entry.amountRub.toFixed(2),
      entry.quantity ?? '',
      entry.priceRub !== undefined ? entry.priceRub.toFixed(2) : '',
      entry.taxBaseRub !== undefined ? entry.taxBaseRub.toFixed(2) : '',
    ]
      .map((cell) => String(cell))
      .join(',')
  );
  return [header, ...rows].join('\n');
}

function sortedEntries(
  entries: readonly LedgerEntry[],
  sortBy: SortColumn,
  direction: SortDirection
): LedgerEntry[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return sign * (a.simulationEpochMs - b.simulationEpochMs);
      case 'ticker':
        return sign * a.ticker.localeCompare(b.ticker);
      case 'kind':
        return sign * a.kind.localeCompare(b.kind);
      case 'amount':
      default:
        return sign * (a.amountRub - b.amountRub);
    }
  });
}

export function TradeHistoryTab({
  entries,
}: {
  entries: readonly LedgerEntry[];
}) {
  const [sortBy, setSortBy] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeGroupIds, setActiveGroupIds] = useState<Set<string>>(
    () => new Set(FILTER_GROUPS.map((g) => g.id))
  );

  const allowedKinds = useMemo<Set<LedgerEntryKind>>(() => {
    const result = new Set<LedgerEntryKind>();
    for (const group of FILTER_GROUPS) {
      if (activeGroupIds.has(group.id)) {
        for (const kind of group.kinds) result.add(kind);
      }
    }
    return result;
  }, [activeGroupIds]);

  const filtered = useMemo(
    () => entries.filter((entry) => allowedKinds.has(entry.kind)),
    [entries, allowedKinds]
  );

  const sorted = useMemo(
    () => sortedEntries(filtered, sortBy, sortDirection),
    [filtered, sortBy, sortDirection]
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

  const toggleGroup = (id: string) => {
    setActiveGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(sorted)], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'financial-journal.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (entries.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-100">Финансовый журнал</h2>
        <p className="text-sm text-zinc-400">Операций пока нет.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">Финансовый журнал</h2>
        <button
          type="button"
          onClick={exportCsv}
          className="shrink-0 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600"
        >
          Экспорт CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {FILTER_GROUPS.map((group) => {
          const active = activeGroupIds.has(group.id);
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => toggleGroup(group.id)}
              className={`rounded-full border px-2 py-0.5 transition ${
                active
                  ? 'border-sky-700 bg-sky-900/50 text-sky-200'
                  : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
              }`}
            >
              {group.label}
            </button>
          );
        })}
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
          const positive = entry.amountRub >= 0;
          return (
            <li key={entry.id} className="py-3 first:pt-0">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs leading-snug sm:text-sm">
                <div className="min-w-0 truncate font-medium text-zinc-200">
                  {KIND_LABELS[entry.kind] ?? entry.kind}
                  {entry.ticker ? (
                    <span className="ml-2 font-mono text-zinc-500">{entry.ticker}</span>
                  ) : null}
                </div>
                <div
                  className={`shrink-0 whitespace-nowrap text-right font-mono tabular-nums ${
                    positive ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatSignedRub(entry.amountRub)}
                </div>
              </div>
              <div className="mt-0.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-[11px] leading-snug text-zinc-500 sm:text-xs">
                <div className="min-w-0 truncate font-mono">
                  {formatDate(entry.simulationEpochMs)}
                </div>
                <div className="shrink-0 whitespace-nowrap text-right font-mono tabular-nums">
                  {entry.quantity !== undefined ? `${entry.quantity} ед.` : ''}
                  {entry.priceRub !== undefined
                    ? ` · ${formatRub(entry.priceRub)} ₽`
                    : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          Показано: {visible.length} из {sorted.length} (отфильтровано из{' '}
          {entries.length})
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
