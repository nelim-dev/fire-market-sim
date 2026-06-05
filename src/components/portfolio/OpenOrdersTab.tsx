'use client';

import { formatInTimeZone } from 'date-fns-tz';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { selectInstrumentPublicCode } from '@/logic/modules/market/selectors';
import { selectOpenOrders } from '@/logic/modules/trading/selectors';

function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

export function OpenOrdersTab() {
  const orders = useGameState(selectOpenOrders);
  const resolvePublicCode = useGameState(
    (s) => (symbol: string) => selectInstrumentPublicCode(symbol)(s)
  );
  const lm = gameLoop.getLogicManager();

  if (orders.length === 0) {
    return (
      <p className="text-sm text-zinc-500">Нет активных заявок.</p>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => {
        const remaining = order.quantity - order.filledQuantity;
        const dateLabel = formatInTimeZone(
          order.placedAtSimulationEpochMs,
          'Europe/Moscow',
          'dd.MM.yyyy HH:mm'
        );
        const sideLabel = order.side === 'buy' ? 'Покупка' : 'Продажа';
        const kindLabel =
          order.orderKind === 'limit' ? 'Лимитная' : 'По рынку';
        const statusLabel =
          order.status === 'partially_filled' ? 'Частично' : 'Активна';

        return (
          <li
            key={order.id}
            className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-zinc-100">
                  {resolvePublicCode(order.symbol)}{' '}
                  <span className="text-zinc-500">
                    {sideLabel} · {kindLabel}
                  </span>
                </p>
                <p className="mt-1 text-xs text-zinc-500">{dateLabel}</p>
                {order.limitPriceRub != null ? (
                  <p className="mt-1 text-zinc-400">
                    Цена:{' '}
                    <span className="font-mono text-zinc-200">
                      {formatRub(order.limitPriceRub)} ₽
                    </span>
                  </p>
                ) : null}
                <p className="mt-2 font-mono text-sky-300">
                  {order.filledQuantity} / {order.quantity}{' '}
                  <span className="text-zinc-500">шт</span>
                </p>
                <p className="text-xs text-zinc-500">
                  {statusLabel} · осталось {remaining} шт
                </p>
              </div>
              <button
                type="button"
                aria-label="Отменить заявку"
                onClick={() => {
                  lm.dispatchCommand({
                    type: 'trading/cancel-order',
                    orderId: order.id,
                  });
                }}
                className="rounded-md px-2 py-1 text-lg leading-none text-zinc-400 transition hover:bg-zinc-800 hover:text-red-400"
              >
                ×
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
