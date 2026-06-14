'use client';

import type { CompositionSlice } from '@/logic/domain/portfolio';

/** Яркая палитра в духе акцентов приложения (sky, emerald, amber на тёмном фоне). */
const SLICE_COLORS = [
  '#7dd3fc', // sky-300
  '#34d399', // emerald-400
  '#fcd34d', // amber-300
  '#22d3ee', // cyan-400
  '#c084fc', // violet-400
  '#f472b6', // pink-400
  '#a3e635', // lime-400
  '#fb923c', // orange-400
  '#818cf8', // indigo-400
  '#e879f9', // fuchsia-400
] as const;

const LABEL_MIN_PCT = 5;

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function sliceCaption(slice: CompositionSlice): string {
  return slice.label;
}

function formatSlicePct(pct: number): string {
  return pct >= LABEL_MIN_PCT
    ? `${pct.toFixed(1)}%`
    : `< ${LABEL_MIN_PCT}%`;
}

function LegendItem({
  slice,
  colorIndex,
  compact,
}: {
  slice: CompositionSlice;
  colorIndex: number;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <li className="border-b border-zinc-800/70 py-2 pl-1 pr-0.5 last:border-b-0">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{
              backgroundColor: SLICE_COLORS[colorIndex % SLICE_COLORS.length],
            }}
          />
          <span className="min-w-0 truncate text-xs font-medium text-zinc-200">
            {slice.label}
          </span>
        </div>
        <div className="mt-0.5 pl-3.5 text-[11px] tabular-nums text-zinc-400">
          {formatSlicePct(slice.pct)}
        </div>
        {slice.label !== slice.ticker ? (
          <div className="mt-0.5 pl-3.5 truncate text-[10px] leading-tight text-zinc-500">
            {slice.ticker}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2">
      <span
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{
          backgroundColor: SLICE_COLORS[colorIndex % SLICE_COLORS.length],
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-zinc-200">{slice.label}</div>
        {slice.label !== slice.ticker ? (
          <div className="truncate text-xs text-zinc-500">{slice.ticker}</div>
        ) : null}
      </div>
      <span className="shrink-0 tabular-nums text-zinc-400">
        {formatSlicePct(slice.pct)}
      </span>
    </li>
  );
}

function PieSvg({
  slices,
  className,
}: {
  slices: readonly CompositionSlice[];
  className?: string;
}) {
  const positive = slices.filter((s) => s.valueRub > 0);
  const cx = 100;
  const cy = 100;
  const r = 88;
  let angle = 0;

  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="Диаграмма состава портфеля"
    >
      {positive.map((slice, i) => {
        const sweep = (slice.pct / 100) * 360;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        const mid = (start + end) / 2;
        const labelPos = polarToCartesian(cx, cy, r * 0.58, mid);
        const showLabel = slice.pct >= LABEL_MIN_PCT;
        const caption = sliceCaption(slice);
        return (
          <g key={slice.id}>
            <path
              d={describeArc(cx, cy, r, start, end)}
              fill={SLICE_COLORS[i % SLICE_COLORS.length]}
              stroke="#18181b"
              strokeWidth={1}
            />
            {showLabel ? (
              <>
                <text
                  x={labelPos.x}
                  y={labelPos.y - 4}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-zinc-950 text-[7px] font-semibold sm:text-[8px]"
                >
                  {caption.length > 10 ? `${caption.slice(0, 9)}…` : caption}
                </text>
                <text
                  x={labelPos.x}
                  y={labelPos.y + 6}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-zinc-950 text-[8px] font-bold sm:text-[9px]"
                >
                  {slice.pct.toFixed(0)}%
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function PortfolioCompositionPieChart({
  slices,
  layout = 'inline',
}: {
  slices: readonly CompositionSlice[];
  layout?: 'inline' | 'panel';
}) {
  const positive = slices.filter((s) => s.valueRub > 0);
  if (positive.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
        Нет данных для диаграммы
      </div>
    );
  }

  const isPanel = layout === 'panel';

  if (isPanel) {
    return (
      <div className="grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_20%]">
        <div className="@container/chart box-border flex min-h-0 items-center justify-center overflow-hidden p-[8%]">
          <PieSvg
            slices={positive}
            className="aspect-square w-[min(100cqw,100cqh)] max-h-full max-w-full"
          />
        </div>
        <ul className="min-h-0 overflow-y-auto overscroll-contain border-l border-zinc-800/80 pl-2 pr-1">
          {positive.map((slice, i) => (
            <LegendItem
              key={slice.id}
              slice={slice}
              colorIndex={i}
              compact
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start">
      <PieSvg slices={positive} className="h-44 w-44 shrink-0" />
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {positive.map((slice, i) => (
          <LegendItem key={slice.id} slice={slice} colorIndex={i} />
        ))}
      </ul>
    </div>
  );
}
