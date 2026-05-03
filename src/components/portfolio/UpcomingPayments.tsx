import type { UpcomingPayment } from '@/logic/domain/portfolio';
import { formatRub } from './formatRub';

function formatPayDate(ms: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ms));
}

function kindLabel(k: UpcomingPayment['kind']): string {
  return k === 'dividend' ? 'Дивиденды' : 'Купон';
}

export function UpcomingPayments({ items }: { items: UpcomingPayment[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Ближайшие выплаты
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((p) => (
          <div
            key={p.id}
            className="min-w-[200px] shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/90 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold text-zinc-300">
                {p.assetName.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-zinc-500">{kindLabel(p.kind)}</div>
                <div className="truncate font-medium text-zinc-100">
                  {p.assetName}
                </div>
                <div className="mt-2 text-lg font-semibold text-zinc-100">
                  {formatRub(p.amountRub)}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Выплата до: {formatPayDate(p.dueSimulationEpochMs)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
