'use client';

import { formatInTimeZone } from 'date-fns-tz';
import { useMemo, useState, useEffect } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import type { AssetKind, OrderBookLevel } from '@/logic/modules/market/contracts';
import type { ChartTimeframeId } from '@/logic/modules/market/chartTimeframes';
import {
  chartTimeframesForSymbol,
  chartUsesEvenIndexSpacing,
  isInflationIndexSymbol,
} from '@/logic/modules/market/inflationIndexSeries';
import { displayPriceRubForSymbol } from '@/logic/domain/eurRubSeriesDisplay';
import { analyticsChartBarsForDisplay } from '@/logic/modules/analytics/displayPrice';
import { FIREIDX_SYMBOL } from '@/logic/modules/market/compositeIndex';
import {
  selectInstrumentPayoutHistory,
  selectInstrumentPublicCode,
  selectIsTradableMarketInstrument,
  selectMarketAsset,
  selectMarketInstrumentCatalog,
} from '@/logic/modules/market/selectors';
import type { PortfolioPosition } from '@/logic/domain/portfolio';
import {
  positionAvgPriceRub,
  positionTotalQuantity,
} from '@/logic/modules/portfolio/selectors';
import { MarketCloseLineChart } from '@/components/market/MarketCloseLineChart';

export type { ChartTimeframeId };

type PanelTab = 'chart' | 'about' | 'payouts';
type OrderKind = 'market' | 'limit';

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

function shallowEqSelected(
  a: { asset: unknown; position: unknown },
  b: { asset: unknown; position: unknown }
): boolean {
  return a.asset === b.asset && a.position === b.position;
}

function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

/** Цены в стакане — с дробной частью, иначе уровни около 250₽ сливаются в «253». */
function formatOrderBookPrice(n: number): string {
  const digits = n >= 10_000 ? 0 : n >= 1_000 ? 1 : 2;
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function formatDateMsk(epochMs: number): string {
  return formatInTimeZone(epochMs, 'Europe/Moscow', 'dd.MM.yyyy');
}

function formatInstrumentPrice(symbol: string, priceRub: number): string {
  if (isInflationIndexSymbol(symbol)) {
    return `${formatRub(priceRub)}%`;
  }
  return `${formatRub(displayPriceRubForSymbol(symbol, priceRub))} ₽`;
}

function assetKindLabel(kind: AssetKind): string {
  switch (kind) {
    case 'stock':
      return 'Акция';
    case 'bond':
      return 'Облигация';
    case 'fund':
      return 'Фонд (ETF/БПИФ)';
    case 'index':
      return 'Индекс';
    default:
      return kind;
  }
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

export function MarketAssetRightPanel({ symbol }: { symbol: string }) {
  const catalog = useGameState(selectMarketInstrumentCatalog);
  const simulationEpochMs = useGameState((s) => s.simulationEpochMs);
  const cashRub = useGameState((s) => s.portfolio.cashRub);
  const cashReservedRub = useGameState((s) => s.portfolio.cashReservedRub);
  const tradingState = useGameState((s) => s.trading);
  const details = useGameState((s) => s.market.details);
  const [timeframe, setTimeframe] = useState<ChartTimeframeId>('1d');
  const [panelTab, setPanelTab] = useState<PanelTab>('chart');
  const [tradeModal, setTradeModal] = useState<{
    side: 'buy' | 'sell';
    quantity: number;
    orderKind: OrderKind;
    limitPriceRub: number;
  } | null>(null);
  const lm = gameLoop.getLogicManager();

  useEffect(() => {
    const active = panelTab === 'chart';
    lm.dispatchCommand({ type: 'uiState/set-chart-hints-active', active });
    return () => {
      lm.dispatchCommand({ type: 'uiState/set-chart-hints-active', active: false });
    };
  }, [panelTab, lm]);

  const symUpper = symbol.toUpperCase();
  const isFireIdx = symUpper === FIREIDX_SYMBOL;
  const isInflIdx = isInflationIndexSymbol(symUpper);

  const chartTimeframeOptions = useMemo(() => {
    const allowed = new Set(chartTimeframesForSymbol(symUpper));
    return TIMEFRAMES.filter((tf) => allowed.has(tf.id));
  }, [symUpper]);

  useEffect(() => {
    const allowed = chartTimeframesForSymbol(symUpper);
    setTimeframe((current) =>
      allowed.includes(current) ? current : (allowed[0] ?? '1d')
    );
  }, [symUpper]);

  const selectedSlice = useGameState(
    (s) => {
      if (!symbol) {
        return { asset: undefined, position: undefined };
      }
      return {
        asset: selectMarketAsset(symbol)(s),
        position: s.portfolio.positions.find(
          (p) => p.ticker.toUpperCase() === symUpper
        ),
      };
    },
    shallowEqSelected
  );
  const asset = selectedSlice.asset;
  const position = selectedSlice.position;

  const payoutRows = useGameState((s) =>
    selectInstrumentPayoutHistory(symbol, simulationEpochMs, s)
  );

  const chartPoints = useMemo(() => {
    const raw = asset?.chartLineByTimeframe[timeframe] ?? [];
    return analyticsChartBarsForDisplay(symUpper, raw);
  }, [asset?.chartLineByTimeframe, timeframe, symUpper]);

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
  const publicCode = useGameState((s) => selectInstrumentPublicCode(symbol)(s));
  const priceRub = asset?.currentPriceRub;
  const changePct = asset?.periodChangePctByTimeframe[timeframe];
  const orderBook = asset?.orderBook;
  const isTradable = useGameState(selectIsTradableMarketInstrument(symbol));
  const lotSize = details.lotSizeBySymbol[symUpper] ?? 1;
  const availableCash = Math.max(0, cashRub - cashReservedRub);
  const maxBuyQty =
    priceRub && priceRub > 0
      ? Math.max(0, Math.floor(availableCash / priceRub))
      : 0;
  const maxSellQty = position ? positionTotalQuantity(position) : 0;
  const showPayoutsTab =
    asset != null && (asset.assetKind === 'stock' || asset.isBond);
  const meta = details.instrumentMetaBySymbol[symUpper];
  const showOrderBook =
    isTradable &&
    orderBook != null &&
    (orderBook.bids.length > 0 || orderBook.asks.length > 0);
  const panelTabs: { id: PanelTab; label: string }[] = isFireIdx || isInflIdx
    ? [
        { id: 'chart', label: 'График' },
        { id: 'about', label: 'О бумаге' },
      ]
    : [
        { id: 'chart', label: 'График' },
        { id: 'about', label: 'О бумаге' },
        ...(showPayoutsTab ? [{ id: 'payouts' as const, label: 'Выплаты' }] : []),
      ];
  const lastRejection =
    tradingState.lastRejection &&
    tradingState.lastRejection.symbol.toUpperCase() === symUpper
      ? tradingState.lastRejection
      : null;
  const rejectionText = useMemo(() => {
    if (!lastRejection) {
      return null;
    }
    switch (lastRejection.reason) {
      case 'INSUFFICIENT_FUNDS':
        return 'Недостаточно средств для покупки по текущей цене.';
      case 'INSUFFICIENT_POSITION_QTY':
        return 'Недостаточно актива в портфеле для продажи.';
      case 'INSUFFICIENT_ORDERBOOK_LIQUIDITY':
        return 'Недостаточная ликвидность (заявка ожидает исполнения).';
      case 'PRICE_UNAVAILABLE':
        return 'Текущая цена недоступна.';
      case 'ASSET_NOT_FOUND':
        return 'Инструмент не найден.';
      case 'INVALID_LOT_QUANTITY':
        return `Количество должно быть кратно лоту (${lastRejection.lotSize ?? lotSize}).`;
      case 'NON_TRADABLE_INSTRUMENT':
        return 'Инструмент недоступен для торговли (только просмотр).';
      case 'INVALID_QUANTITY':
      default:
        return 'Некорректное количество для сделки.';
    }
  }, [lastRejection, lotSize]);

  return (
    <div className="flex w-full flex-col gap-6 text-zinc-100">
      <div>
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          {displayName}
        </h2>
        <p className="mt-0.5 font-mono text-xs text-zinc-500">
          {publicCode} · ISIN {isin}
        </p>
      </div>

      <div>
        <p className="font-mono text-2xl font-semibold text-zinc-50">
          {priceRub == null ? '—' : formatInstrumentPrice(symbol, priceRub)}
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

      <div className="flex flex-wrap gap-1.5">
        {panelTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPanelTab(tab.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              panelTab === tab.id
                ? 'bg-sky-700 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {panelTab === 'chart' ? (
      <section className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {chartTimeframeOptions.map((tf) => (
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
        <div className="@container/chart rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="h-[clamp(12.5rem,43cqw,25rem)] w-full max-w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
            <MarketCloseLineChart
              points={chartPoints}
              timeframe={timeframe}
              evenIndexSpacing={chartUsesEvenIndexSpacing(symUpper, timeframe)}
            />
          </div>
        </div>
        {showOrderBook ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-300">Биржевой стакан</h3>
            <OrderBookDepth bids={orderBook!.bids} asks={orderBook!.asks} />
          </div>
        ) : null}
      </section>
      ) : null}

      {panelTab === 'about' && asset ? (
        <AboutTab
          assetKind={asset.assetKind}
          displayName={asset.displayName}
          description={asset.description}
          isin={isin}
          lotSize={lotSize}
          groupRaw={meta?.groupRaw ?? null}
          isBond={asset.isBond}
          faceValueRub={meta?.initialFaceValueRub ?? null}
          maturityEpochMs={meta?.maturityEpochMs ?? null}
        />
      ) : null}

      {panelTab === 'payouts' ? (
        <PayoutsTab rows={payoutRows} assetKind={asset?.assetKind} />
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-300">Ваша позиция</h3>
        <PositionStatsBlock
          assetKind={asset?.assetKind}
          position={position}
        />
      </section>

      <section className="space-y-3">
        {isTradable ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() =>
                setTradeModal({
                  side: 'buy',
                  quantity: lotSize,
                  orderKind: 'market',
                  limitPriceRub: priceRub ?? 0,
                })
              }
              disabled={!asset || maxBuyQty < lotSize}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              Купить
            </button>
            <button
              type="button"
              onClick={() =>
                setTradeModal({
                  side: 'sell',
                  quantity: Math.min(lotSize, maxSellQty) || lotSize,
                  orderKind: 'market',
                  limitPriceRub: priceRub ?? 0,
                })
              }
              disabled={!asset || maxSellQty < lotSize}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              Продать
            </button>
          </div>
        ) : (
          <p className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
            Инструмент доступен только для просмотра.
          </p>
        )}
        {rejectionText ? (
          <p className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {rejectionText}
          </p>
        ) : null}
      </section>

      {tradeModal && asset && isTradable ? (
        <TradeModal
          side={tradeModal.side}
          publicCode={publicCode}
          symbol={symbol}
          displayName={displayName}
          priceRub={priceRub ?? null}
          cashRub={availableCash}
          averagePriceRub={position ? positionAvgPriceRub(position) : undefined}
          maxQty={tradeModal.side === 'buy' ? maxBuyQty : maxSellQty}
          lotSize={lotSize}
          quantity={tradeModal.quantity}
          orderKind={tradeModal.orderKind}
          limitPriceRub={tradeModal.limitPriceRub}
          onOrderKindChange={(kind) =>
            setTradeModal((prev) => (prev ? { ...prev, orderKind: kind } : prev))
          }
          onLimitPriceChange={(p) =>
            setTradeModal((prev) => (prev ? { ...prev, limitPriceRub: p } : prev))
          }
          onQuantityChange={(next) =>
            setTradeModal((prev) => (prev ? { ...prev, quantity: next } : prev))
          }
          onClose={() => setTradeModal(null)}
          onSubmit={() => {
            if (tradeModal.orderKind === 'limit') {
              lm.dispatchCommand({
                type: 'trading/submit-limit-order',
                side: tradeModal.side,
                symbol,
                quantity: tradeModal.quantity,
                limitPriceRub: tradeModal.limitPriceRub,
                source: 'modal',
              });
            } else {
              lm.dispatchCommand({
                type: 'trading/submit-market-order',
                side: tradeModal.side,
                symbol,
                quantity: tradeModal.quantity,
                source: 'modal',
              });
            }
            setTradeModal(null);
          }}
        />
      ) : null}
    </div>
  );
}

function OrderBookDepth({
  bids,
  asks,
}: {
  bids: readonly OrderBookLevel[];
  asks: readonly OrderBookLevel[];
}) {
  const maxQty = Math.max(1, ...bids.map((l) => l.qty), ...asks.map((l) => l.qty));
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
      <OrderBookSide levels={bids} side="bid" maxQty={maxQty} />
      <OrderBookSide levels={asks} side="ask" maxQty={maxQty} />
    </div>
  );
}

function OrderBookSide({
  levels,
  side,
  maxQty,
}: {
  levels: readonly OrderBookLevel[];
  side: 'bid' | 'ask';
  maxQty: number;
}) {
  const label = side === 'bid' ? 'Покупка' : 'Продажа';
  const color = side === 'bid' ? 'text-emerald-500/90' : 'text-red-400/90';
  return (
    <div>
      <p className={`mb-2 font-medium ${color}`}>{label}</p>
      <ul className="space-y-1.5">
        {levels.map((row, i) => (
          <li key={i} className="relative font-mono">
            <DepthBar side={side} qty={row.qty} maxQty={maxQty} />
            <span className="relative flex justify-between px-1 text-zinc-300">
              <span>{formatOrderBookPrice(row.priceRub)}</span>
              <span className="text-zinc-500">{row.qty}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DepthBar({
  side,
  qty,
  maxQty,
}: {
  side: 'bid' | 'ask';
  qty: number;
  maxQty: number;
}) {
  const w = `${(qty / maxQty) * 100}%`;
  return (
    <div
      className={
        side === 'bid'
          ? 'absolute inset-y-0 right-0 rounded bg-emerald-900/30'
          : 'absolute inset-y-0 left-0 rounded bg-red-900/30'
      }
      style={{ width: w }}
    />
  );
}

function AboutTab(props: {
  assetKind: AssetKind;
  displayName: string;
  description?: string;
  isin: string;
  lotSize: number;
  groupRaw: string | null;
  isBond: boolean;
  faceValueRub: number | null;
  maturityEpochMs: number | null;
}) {
  const {
    assetKind,
    displayName,
    description,
    isin,
    lotSize,
    groupRaw,
    isBond,
    faceValueRub,
    maturityEpochMs,
  } = props;
  const intro =
    description?.trim() || assetDescription(assetKind, displayName);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-300">
      <p className="mb-4 leading-relaxed text-zinc-300">{intro}</p>
      <dl className="space-y-2">
        <AboutRow label="Тип" value={assetKindLabel(assetKind)} />
        <AboutRow label="Название" value={displayName} />
        <AboutRow label="ISIN" value={isin} mono />
        {groupRaw ? <AboutRow label="Группа MOEX" value={groupRaw} /> : null}
        <AboutRow label="Лот" value={`${lotSize} шт`} mono />
        {isBond && faceValueRub != null ? (
          <AboutRow label="Номинал" value={`${formatRub(faceValueRub)} ₽`} mono />
        ) : null}
        {isBond && maturityEpochMs != null ? (
          <AboutRow label="Погашение" value={formatDateMsk(maturityEpochMs)} />
        ) : null}
      </dl>
    </section>
  );
}

function AboutRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-right ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function PayoutsTab({
  rows,
  assetKind,
}: {
  rows: ReturnType<typeof selectInstrumentPayoutHistory>;
  assetKind: AssetKind | undefined;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-500">
        {assetKind === 'bond' ? 'Купоны не загружены.' : 'Дивиденды не загружены.'}
      </section>
    );
  }
  const isBond = assetKind === 'bond';
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-500">
          <tr>
            <th className="px-3 py-2">Дата</th>
            <th className="px-3 py-2 text-right">
              {isBond ? 'Купон ₽/обл' : 'Дивиденд ₽/акц'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-zinc-800/60 text-zinc-300">
              <td className="px-3 py-2 font-mono">{formatDateMsk(row.dateEpochMs)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatRub(row.amountRub)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TradeModal({
  side,
  publicCode,
  symbol,
  displayName,
  priceRub,
  cashRub,
  averagePriceRub,
  maxQty,
  lotSize,
  quantity,
  orderKind,
  limitPriceRub,
  onOrderKindChange,
  onLimitPriceChange,
  onQuantityChange,
  onClose,
  onSubmit,
}: {
  side: 'buy' | 'sell';
  publicCode: string;
  symbol: string;
  displayName: string;
  priceRub: number | null;
  cashRub: number;
  averagePriceRub: number | undefined;
  maxQty: number;
  lotSize: number;
  quantity: number;
  orderKind: OrderKind;
  limitPriceRub: number;
  onOrderKindChange: (k: OrderKind) => void;
  onLimitPriceChange: (p: number) => void;
  onQuantityChange: (next: number) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const refPrice =
    orderKind === 'limit' && limitPriceRub > 0
      ? limitPriceRub
      : Number.isFinite(priceRub)
        ? (priceRub as number)
        : 0;
  const safeQty = Math.max(lotSize, Math.min(quantity, Math.max(lotSize, maxQty)));
  const amountRub = refPrice * safeQty;
  const balanceAfterBuy = cashRub - amountRub;
  const pnlRub =
    side === 'sell' && averagePriceRub != null
      ? (refPrice - averagePriceRub) * safeQty
      : null;
  const canSubmit = maxQty >= lotSize && safeQty <= maxQty && refPrice > 0;
  const title = side === 'buy' ? 'Купить' : 'Продать';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-zinc-100 shadow-2xl">
        <h3 className="text-lg font-semibold">
          {title} {publicCode} - {displayName}
        </h3>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onOrderKindChange('market')}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
              orderKind === 'market' ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            По рынку
          </button>
          <button
            type="button"
            onClick={() => onOrderKindChange('limit')}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
              orderKind === 'limit' ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Лимитная
          </button>
        </div>
        {orderKind === 'limit' ? (
          <label className="mt-3 block text-sm text-zinc-300">
            Лимит-цена, ₽
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={limitPriceRub}
              onChange={(e) => onLimitPriceChange(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
            />
          </label>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">
            Ориентир: <span className="font-mono text-zinc-200">{formatRub(refPrice)} ₽</span>
          </p>
        )}
        <div className="mt-4 space-y-2">
          <label className="block text-sm text-zinc-300">
            Количество (лот {lotSize})
            <input
              type="number"
              min={lotSize}
              max={Math.max(lotSize, maxQty)}
              step={lotSize}
              value={safeQty}
              onChange={(e) => onQuantityChange(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
            />
          </label>
          <p className="text-xs text-zinc-500">До {maxQty} шт · по ликвидности стакана</p>
        </div>
        <div className="mt-4 space-y-1 text-sm text-zinc-300">
          <p>
            Сумма сделки:{' '}
            <span className="font-mono text-zinc-100">{formatRub(amountRub)} ₽</span>
          </p>
          {side === 'buy' ? (
            <p>
              Баланс после покупки:{' '}
              <span className="font-mono text-zinc-100">{formatRub(balanceAfterBuy)} ₽</span>
            </p>
          ) : (
            <p>
              PnL сделки:{' '}
              <span
                className={`font-mono ${
                  pnlRub == null ? 'text-zinc-400' : pnlRub >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {pnlRub == null ? '—' : `${pnlRub >= 0 ? '+' : ''}${formatRub(pnlRub)} ₽`}
              </span>
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-600"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white ${
              side === 'buy'
                ? 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700'
                : 'bg-red-600 hover:bg-red-500 disabled:bg-zinc-700'
            }`}
          >
            Отправить заявку
          </button>
        </div>
      </div>
    </div>
  );
}

function PositionStatsBlock({
  assetKind,
  position,
}: {
  assetKind: AssetKind | undefined;
  position: PortfolioPosition | undefined;
}) {
  const qty = position ? positionTotalQuantity(position) : 0;
  const avg = position ? positionAvgPriceRub(position) : undefined;
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
            </>
          )}
        </li>
      </ol>
    </div>
  );
}
