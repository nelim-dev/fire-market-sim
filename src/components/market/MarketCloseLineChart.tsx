'use client';

import { memo, useMemo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { getISOWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { ChartTimeframeId } from '@/logic/modules/market/chartTimeframes';
import {
  CHART_6M_1H_BAR_COUNT,
  CHART_DAY_1M_BAR_COUNT,
  CHART_MONTH_30M_BAR_COUNT,
  CHART_WEEK_5M_BAR_COUNT,
  CHART_YEAR_DAILY_BAR_COUNT,
} from '@/logic/modules/market/chartTimeframes';
import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';

type PriceGuideTone = 'min' | 'max';

type Props = {
  points: readonly MarketPriceBar[];
  /** Вторая линия (например предсказание в аналитике). */
  overlayPoints?: readonly MarketPriceBar[];
  timeframe: ChartTimeframeId;
  /** Равномерный шаг по индексу (месячные макро-ряды INFL на 6m/1y). */
  evenIndexSpacing?: boolean;
  /** Скрыть подпись под графиком (аналитика — своя легенда). */
  hideFooterHint?: boolean;
  /** Горизонтальные маркеры min/max (аналитика). */
  priceGuides?: readonly { price: number; tone: PriceGuideTone }[];
};

const W = 420;
const H = 280;
const M_LEFT = 54;
const M_RIGHT = 10;
const M_TOP = 10;
const M_BOTTOM = 42;

/** Фиксированная ширина окна графика (число торговых слотов), как в chartWindows. */
const CHART_WINDOW_SLOT_COUNT: Record<ChartTimeframeId, number | null> = {
  '1d': CHART_DAY_1M_BAR_COUNT,
  '1w': CHART_WEEK_5M_BAR_COUNT,
  '1m': CHART_MONTH_30M_BAR_COUNT,
  '6m': CHART_6M_1H_BAR_COUNT,
  '1y': CHART_YEAR_DAILY_BAR_COUNT,
  all: null,
};

function formatXTickLabel(t: number, tf: ChartTimeframeId): string {
  const tz = 'Europe/Moscow';
  switch (tf) {
    case '1d':
      return formatInTimeZone(t, tz, 'dd.MM HH:mm');
    case '1w':
      return formatInTimeZone(t, tz, 'd.MM');
    case '1m':
      return `н${getISOWeek(new Date(t))}`;
    case '6m':
    case '1y':
      return formatInTimeZone(t, tz, 'LLL', { locale: ru });
    case 'all':
      return formatInTimeZone(t, tz, 'yyyy');
    default:
      return '';
  }
}

/** Подписи по равномерно выбранным индексам свечей (ось X — порядок, без пустот вне сессий). */
function buildIndexTicks(
  points: readonly MarketPriceBar[],
  tf: ChartTimeframeId,
  count: number
): { idx: number; label: string }[] {
  const n = points.length;
  if (n < 1) {
    return [];
  }
  if (n === 1) {
    return [{ idx: 0, label: formatXTickLabel(points[0].t, tf) }];
  }
  const out: { idx: number; label: string }[] = [];
  const seenYears = new Set<string>();
  const seenIdx = new Set<number>();
  const maxK = count - 1;
  for (let k = 0; k < count; k++) {
    const idx = maxK === 0 ? 0 : Math.round((k * (n - 1)) / maxK);
    if (seenIdx.has(idx)) {
      continue;
    }
    seenIdx.add(idx);
    const t = points[idx].t;
    const label = formatXTickLabel(t, tf);
    if (tf === 'all') {
      if (seenYears.has(label)) {
        continue;
      }
      seenYears.add(label);
    }
    out.push({ idx, label });
  }
  return out.length > 0 ? out : [{ idx: 0, label: formatXTickLabel(points[0].t, tf) }];
}

function buildPriceTicks(minP: number, maxP: number, n: number): number[] {
  if (minP === maxP) {
    return [minP, minP + 1e-6];
  }
  const step = (maxP - minP) / (n - 1);
  return Array.from({ length: n }, (_, i) => minP + step * i);
}

/**
 * Линия по цене; по горизонтали — равномерный шаг между свечами (без разрывов выходных/ночи),
 * подписи снизу — реальное время соответствующей свечи.
 */
function formatGuidePrice(price: number): string {
  return price >= 100 ? price.toFixed(0) : price.toFixed(2);
}

function MarketCloseLineChartImpl({
  points,
  overlayPoints,
  timeframe,
  evenIndexSpacing = false,
  hideFooterHint = false,
  priceGuides,
}: Props) {
  if (points.length === 0 && (overlayPoints?.length ?? 0) === 0) {
    return (
      <div className="flex h-full min-h-[200px] w-full max-w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-2 text-center text-xs text-zinc-500">
        Нет данных для графика: нет минутных рядов в SQLite для этого инструмента. Соберите БД
        командой <code className="text-zinc-400">npm run build:market-db</code> и запустите
        приложение через <code className="text-zinc-400">npm run electron:dev</code> (или
        сдвиньте время симуляции в допустимый диапазон).
      </div>
    );
  }

  const innerW = W - M_LEFT - M_RIGHT;
  const innerH = H - M_TOP - M_BOTTOM;
  const axisPoints = points.length > 0 ? points : (overlayPoints ?? []);
  const n = axisPoints.length;
  const windowSlots = evenIndexSpacing ? n : (CHART_WINDOW_SLOT_COUNT[timeframe] ?? n);
  const xDenom = Math.max(1, (evenIndexSpacing ? n : windowSlots) - 1);
  // Неполное окно (до carry-init или после потери хвоста) — прижимаем к правому краю,
  // чтобы новые точки не пересчитывали масштаб всей линии.
  const xOffset = evenIndexSpacing ? 0 : Math.max(0, windowSlots - n);

  const xAtIndex = (i: number) =>
    M_LEFT + ((xOffset + i) / xDenom) * innerW;

  const [pMin, pMax] = useMemo(() => {
    const closes = [
      ...points.map((p) => p.c),
      ...(overlayPoints ?? []).map((p) => p.c),
      ...(priceGuides ?? []).map((g) => g.price),
    ];
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    if (max <= min) {
      min -= 0.01;
      max += 0.01;
    }
    const pad = (max - min) * 0.06;
    min -= pad;
    max += pad;
    return [min, max] as const;
  }, [points, overlayPoints, priceGuides]);

  const yAt = (c: number) =>
    M_TOP + (1 - (c - pMin) / (pMax - pMin)) * innerH;

  const pathD = useMemo(
    () =>
      points
        .map(
          (p, i) =>
            `${i === 0 ? 'M' : 'L'} ${xAtIndex(i).toFixed(2)} ${yAt(p.c).toFixed(2)}`
        )
        .join(' '),
    [points, pMin, pMax, timeframe, evenIndexSpacing]
  );

  const overlayPathD = useMemo(() => {
    if (!overlayPoints || overlayPoints.length === 0) {
      return '';
    }
    const len = Math.min(overlayPoints.length, axisPoints.length || overlayPoints.length);
    return overlayPoints
      .slice(0, len)
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${xAtIndex(i).toFixed(2)} ${yAt(p.c).toFixed(2)}`
      )
      .join(' ');
  }, [overlayPoints, axisPoints.length, pMin, pMax, timeframe, evenIndexSpacing]);

  const xTicks = useMemo(
    () => buildIndexTicks(axisPoints, timeframe, 7),
    [axisPoints, timeframe]
  );
  const yTicks = useMemo(() => buildPriceTicks(pMin, pMax, 5), [pMin, pMax]);
  const shouldRenderDots = points.length <= 240 && points.length > 0;

  return (
    <div className="flex h-full min-h-[220px] w-full max-w-full flex-col overflow-hidden">
      <svg
        className="block min-h-0 w-full flex-1 text-zinc-500"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="График цены"
      >
        <rect
          x={M_LEFT}
          y={M_TOP}
          width={innerW}
          height={innerH}
          className="fill-none stroke-zinc-800"
          strokeWidth={1}
        />
        {yTicks.map((price, yi) => (
          <g key={`y-${yi}-${price}`}>
            <line
              x1={M_LEFT}
              y1={yAt(price)}
              x2={M_LEFT + innerW}
              y2={yAt(price)}
              className="stroke-zinc-800/80"
              strokeDasharray="3 4"
              strokeWidth={1}
            />
            <text
              x={M_LEFT - 6}
              y={yAt(price)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-zinc-400 text-[9px]"
            >
              {price >= 100 ? price.toFixed(0) : price.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map(({ idx, label }, xi) => (
          <text
            key={`x-${xi}-${idx}`}
            x={xAtIndex(idx)}
            y={H - 10}
            textAnchor="middle"
            className="fill-zinc-400 text-[9px]"
          >
            {label}
          </text>
        ))}
        {pathD ? (
          <path
            d={pathD}
            fill="none"
            className="stroke-sky-400"
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {overlayPathD ? (
          <path
            d={overlayPathD}
            fill="none"
            className="stroke-emerald-400"
            strokeWidth={1.75}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {(priceGuides ?? []).map((guide) => (
          <g key={`guide-${guide.tone}-${guide.price}`}>
            <line
              x1={M_LEFT}
              y1={yAt(guide.price)}
              x2={M_LEFT + innerW}
              y2={yAt(guide.price)}
              className={guide.tone === 'max' ? 'stroke-amber-400/90' : 'stroke-violet-400/90'}
              strokeDasharray="5 3"
              strokeWidth={1.25}
            />
            <text
              x={M_LEFT + innerW - 4}
              y={yAt(guide.price) - 5}
              textAnchor="end"
              dominantBaseline="auto"
              className={
                guide.tone === 'max'
                  ? 'fill-amber-300 text-[8px]'
                  : 'fill-violet-300 text-[8px]'
              }
            >
              {guide.tone === 'max' ? 'макс.' : 'мин.'} {formatGuidePrice(guide.price)}
            </text>
          </g>
        ))}
        {shouldRenderDots
          ? points.map((p, i) => (
              <circle
                key={`pt-${i}-${p.t}`}
                cx={xAtIndex(i)}
                cy={yAt(p.c)}
                r={points.length <= 3 ? 3.5 : 2.2}
                className="fill-sky-300"
              />
            ))
          : null}
      </svg>
      {hideFooterHint ? null : (
        <p className="mt-0.5 text-center text-[10px] text-zinc-600">
          По горизонтали — порядок свечей без пустот вне торгов; слева — цена; подписи — время
          (МСК) у выбранных свечей
        </p>
      )}
    </div>
  );
}

export const MarketCloseLineChart = memo(MarketCloseLineChartImpl);
