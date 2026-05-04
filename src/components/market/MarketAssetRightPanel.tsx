'use client';

import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import { useGameState } from '@/hooks/useGameState';
import type { AssetKind } from '@/logic/modules/market/contracts';
import type { ChartTimeframeId } from '@/logic/modules/market/chartTimeframes';
import {
  selectMarketAsset,
  selectMarketInstrumentCatalog,
} from '@/logic/modules/market/selectors';
import type { PortfolioPosition } from '@/logic/domain/portfolio';
import { MarketCloseLineChart } from '@/components/market/MarketCloseLineChart';

export type { ChartTimeframeId };

const TIMEFRAMES: { id: ChartTimeframeId; label: string }[] = [
  { id: '1d', label: 'День' },
  { id: '1w', label: 'Неделя' },
  { id: '1m', label: 'Месяц' },
  { id: '6m', label: '6 мес' },
  { id: '1y', label: 'Год' },
  { id: 'all', label: 'Всё время' },
];

const CHANGE_LABEL_BY_TF: Record<ChartTimeframeId, string> = {
  '1d': 'за день',
  '1w': 'за неделю',
  '1m': 'за месяц',
  '6m': 'за 6 мес.',
  '1y': 'за год',
  all: 'за всё время',
};

function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

function formatPct(n: number | null): string {
  if (n === null || Number.isNaN(n)) {
    return '—';
  }
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function assetDescription(assetKind: AssetKind, displayName: string): string {
  switch (assetKind) {
    case 'stock':
      return `${displayName} — акция. Котировки и график в историческом режиме ограничены текущей датой и временем симуляции (будущие свечи не показываются).`;
    case 'bond':
      return `${displayName} — облигация. Доходность по купону и НКД появятся в карточке после подключения справочника выпусков.`;
    case 'fund':
      return `${displayName} — биржевой фонд (ETF/БПИФ). Состав и базовый актив — в справочнике фонда (позже).`;
    case 'index':
      return `${displayName} — биржевой индекс: отражает динамику корзины базовых активов по методике расчёта индекса. Дивидендов по индексу нет; доходность — через изменение значения индекса.`;
    default:
      return displayName;
  }
}

function payoutNote(assetKind: AssetKind): string | null {
  switch (assetKind) {
    case 'stock':
      return 'Дивиденды и прочие выплаты учитываются в портфеле (демо: блок «Ближайшие выплаты» слева).';
    case 'bond':
      return 'Купоны учитываются в портфеле при начислении (M4+); здесь только справочный текст.';
    case 'fund':
      return 'Выплаты по фонду (дистрибуция и т.п.) — по правилам фонда; детализация в портфеле.';
    case 'index':
      return null;
    default:
      return null;
  }
}

export function MarketAssetRightPanel() {
  const catalog = useGameState(selectMarketInstrumentCatalog);
  const simulationEpochMs = useGameState((s) => s.simulationEpochMs);
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState<ChartTimeframeId>('1d');

  useEffect(() => {
    if (symbol === '' && catalog.length > 0) {
      setSymbol(catalog[0].symbol);
    }
  }, [catalog, symbol]);

  const asset = useGameState(
    (s) => (symbol ? selectMarketAsset(symbol)(s) : undefined)
  );

  const position = useGameState((s) =>
    symbol
      ? s.portfolio.positions.find(
          (p) => p.ticker.toUpperCase() === symbol.toUpperCase()
        )
      : undefined
  );

  const gameDateLabel = useMemo(
    () =>
      formatInTimeZone(simulationEpochMs, 'Europe/Moscow', 'dd.MM.yyyy HH:mm'),
    [simulationEpochMs]
  );

  if (catalog.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-6 text-sm text-zinc-500">
        Каталог инструментов пуст. Выполните{' '}
        <code className="rounded bg-zinc-900 px-1 text-zinc-300">
          npm run gen:market-catalog
        </code>{' '}
        и пересоберите приложение.
      </div>
    );
  }

  const displayName = asset?.displayName ?? symbol;
  const isin = asset?.isin ?? '—';
  const priceRub = asset?.currentPriceRub;
  const changePct = asset?.periodChangePctByTimeframe[timeframe];
  const orderBook = asset?.orderBook;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 text-zinc-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            {displayName}
          </h2>
          <p className="mt-0.5 font-mono text-xs text-zinc-500">ISIN {isin}</p>
        </div>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Инструмент
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
          >
            {catalog.map((row) => (
              <option key={row.symbol} value={row.symbol}>
                {row.symbol} · {row.assetKind}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="font-mono text-2xl font-semibold text-zinc-50">
          {priceRub == null ? '—' : `${formatRub(priceRub)} ₽`}
        </p>
        <p
          className={`mt-1 font-mono text-sm ${
            changePct == null
              ? 'text-zinc-500'
              : changePct >= 0
                ? 'text-emerald-400'
                : 'text-red-400'
          }`}
        >
          {CHANGE_LABEL_BY_TF[timeframe]}: {formatPct(changePct ?? null)}
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                timeframe === tf.id
                  ? 'bg-sky-700 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-xs text-zinc-500">
            Игровое время (ограничение графика):{' '}
            <span className="font-mono text-zinc-300">{gameDateLabel}</span> МСК
          </p>
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            Горизонт и шаг ряда зависят от выбранного периода (см. план M3 §6.2); точки
            строго не позже текущего шага симуляции. Свечной режим и полный минутный
            replay — отдельно.
          </p>
          <div className="mt-3 min-h-[248px] h-64 w-full max-w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
            <MarketCloseLineChart
              points={asset?.chartLineByTimeframe[timeframe] ?? []}
              timeframe={timeframe}
            />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-300">Биржевой стакан</h3>
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
          <div>
            <p className="mb-2 font-medium text-emerald-500/90">Покупка</p>
            {orderBook && orderBook.bids.length > 0 ? (
              <ul className="space-y-1 font-mono text-zinc-400">
                {orderBook.bids.map((row, i) => (
                  <li key={i}>
                    {formatRub(row.priceRub)} × {row.qty}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600">Нет заявок (заглушка)</p>
            )}
          </div>
          <div>
            <p className="mb-2 font-medium text-red-400/90">Продажа</p>
            {orderBook && orderBook.asks.length > 0 ? (
              <ul className="space-y-1 font-mono text-zinc-400">
                {orderBook.asks.map((row, i) => (
                  <li key={i}>
                    {formatRub(row.priceRub)} × {row.qty}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600">Нет заявок (заглушка)</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-300">Описание</h3>
        <p className="text-sm leading-relaxed text-zinc-400">
          {asset
            ? assetDescription(asset.assetKind, asset.displayName)
            : 'Выберите инструмент.'}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-300">Ваша позиция</h3>
        <PositionStatsBlock
          assetKind={asset?.assetKind}
          position={position}
          payoutNote={asset ? payoutNote(asset.assetKind) : null}
        />
      </section>
    </div>
  );
}

function PositionStatsBlock({
  assetKind,
  position,
  payoutNote,
}: {
  assetKind: AssetKind | undefined;
  position: PortfolioPosition | undefined;
  payoutNote: string | null;
}) {
  const qty = position?.quantity ?? 0;
  const avg = position?.avgPriceRub;
  const last = position?.lastPriceRub;

  const pnlRub =
    position !== undefined &&
    last !== undefined &&
    avg !== undefined
      ? (last - avg) * qty
      : null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Число в портфеле:{' '}
          <span className="font-mono text-zinc-200">{qty}</span>
        </li>
        <li>
          Средняя цена покупки:{' '}
          <span className="font-mono text-zinc-200">
            {avg !== undefined ? `${formatRub(avg)} ₽` : '—'}
          </span>
        </li>
        <li>
          {assetKind === 'index' ? (
            <span>
              Индекс не выплачивает дивиденды; оценка — по динамике значения
              индекса и вашей позиции (кол-во условных «пунктов»).
            </span>
          ) : (
            <>
              Прибыль/убыток по цене (без отдельного учёта выплат в этой строке):{' '}
              <span
                className={`font-mono ${
                  pnlRub === null
                    ? 'text-zinc-500'
                    : pnlRub >= 0
                      ? 'text-emerald-400'
                      : 'text-red-400'
                }`}
              >
                {pnlRub === null ? '—' : `${pnlRub >= 0 ? '+' : ''}${formatRub(pnlRub)} ₽`}
              </span>
              {payoutNote ? (
                <span className="mt-2 block text-xs text-zinc-500">{payoutNote}</span>
              ) : null}
            </>
          )}
        </li>
      </ol>
    </div>
  );
}
