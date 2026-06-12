import { lastDayOfMonth } from 'date-fns';
import { toDate } from 'date-fns-tz';
import type { ChartTimeframeId } from './chartTimeframes';
import { CHART_TIMEFRAME_IDS } from './chartTimeframes';
import {
  epochMsToYyyymm,
  loadInflationSchedule,
  resolveRolling12mInflationPct,
  type InflationSchedule,
} from './inflationSchedule';
import { emptyChartLinesByTimeframe, type MarketPriceBar } from './priceSeries';

/** Символ справочного индекса инфляции (`indexes/INFL.txt`). */
export const INFLATION_INDEX_SYMBOL = 'INFL';

/** Начало отображаемой истории на графике (MoM, %). */
export const INFLATION_INDEX_HISTORY_START_YYYYMM = '201301';

const MONTHLY_MACRO_CHART_TIMEFRAMES: readonly ChartTimeframeId[] = [
  '6m',
  '1y',
  'all',
];

export function isInflationIndexSymbol(symbol: string): boolean {
  return symbol.toUpperCase() === INFLATION_INDEX_SYMBOL;
}

/** Горизонты графика для месячных макро-рядов (инфляция). */
export function chartTimeframesForSymbol(symbol: string): readonly ChartTimeframeId[] {
  if (isInflationIndexSymbol(symbol)) {
    return MONTHLY_MACRO_CHART_TIMEFRAMES;
  }
  return CHART_TIMEFRAME_IDS;
}

/** Месячные ряды (INFL): 6m/1y — мало точек, равномерный шаг по индексу, не торговое окно. */
export function chartUsesEvenIndexSpacing(
  symbol: string,
  timeframe: ChartTimeframeId
): boolean {
  return (
    isInflationIndexSymbol(symbol) &&
    (timeframe === '6m' || timeframe === '1y')
  );
}

export function momIndexToInflationPct(momIndex: number): number {
  return (momIndex / 100 - 1) * 100;
}

function listYyyymmSorted(schedule: InflationSchedule): string[] {
  return Object.keys(schedule.momByYyyymm).sort();
}

/** Конец календарного месяца, 18:00 MSK — как типичная отметка Finam/MOEX. */
export function monthEndEpochMs(yyyymm: string): number {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  const last = lastDayOfMonth(new Date(y, m - 1, 1));
  const yyyy = last.getFullYear();
  const mm = String(last.getMonth() + 1).padStart(2, '0');
  const dd = String(last.getDate()).padStart(2, '0');
  return toDate(`${yyyy}-${mm}-${dd}T18:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

export type InflationIndexBar = {
  epochMs: number;
  /** MoM-инфляция за месяц, %. */
  momInflationPct: number;
  /** Rolling 12m, % — для справки / тестов. */
  rolling12mPct: number | null;
};

export function buildInflationIndexBars(
  schedule: InflationSchedule = loadInflationSchedule()
): InflationIndexBar[] {
  const out: InflationIndexBar[] = [];
  for (const yyyymm of listYyyymmSorted(schedule)) {
    if (yyyymm < INFLATION_INDEX_HISTORY_START_YYYYMM) {
      continue;
    }
    const mom = schedule.momByYyyymm[yyyymm];
    if (mom == null || !Number.isFinite(mom)) continue;
    const epochMs = monthEndEpochMs(yyyymm);
    const rolling12mPct = resolveRolling12mInflationPct(epochMs, schedule);
    out.push({
      epochMs,
      momInflationPct: momIndexToInflationPct(mom),
      rolling12mPct,
    });
  }
  return out;
}

function resolveChartEndYyyymm(
  simulationEpochMs: number,
  schedule: InflationSchedule
): string {
  const simYyyymm = epochMsToYyyymm(simulationEpochMs);
  const last = schedule.lastAvailableYyyymm;
  if (!last) {
    return simYyyymm;
  }
  // До 2013-01 показываем полный опубликованный ряд (история с 2013 не зависит от старта симуляции).
  if (simYyyymm < INFLATION_INDEX_HISTORY_START_YYYYMM) {
    return last;
  }
  return simYyyymm > last ? last : simYyyymm;
}

/** Месячные бары MoM (%), с 2013-01 по конец доступного / текущий месяц симуляции. */
export function buildInflationIndexMonthlyPriceBars(
  simulationEpochMs: number,
  schedule: InflationSchedule = loadInflationSchedule()
): readonly MarketPriceBar[] {
  const endYyyymm = resolveChartEndYyyymm(simulationEpochMs, schedule);
  const out: MarketPriceBar[] = [];
  for (const yyyymm of listYyyymmSorted(schedule)) {
    if (yyyymm < INFLATION_INDEX_HISTORY_START_YYYYMM) {
      continue;
    }
    if (yyyymm > endYyyymm) {
      break;
    }
    const mom = schedule.momByYyyymm[yyyymm];
    if (mom == null || !Number.isFinite(mom)) {
      continue;
    }
    const pct = momIndexToInflationPct(mom);
    const t = monthEndEpochMs(yyyymm);
    out.push({ t, o: pct, h: pct, l: pct, c: pct, v: 1 });
  }
  return out;
}

export function resolveInflationIndexPriceAtEpoch(
  simulationEpochMs: number,
  schedule: InflationSchedule = loadInflationSchedule()
): number | null {
  const bars = buildInflationIndexMonthlyPriceBars(simulationEpochMs, schedule);
  if (bars.length === 0) {
    return null;
  }
  const simYyyymm = epochMsToYyyymm(simulationEpochMs);
  if (simYyyymm < INFLATION_INDEX_HISTORY_START_YYYYMM) {
    return bars[bars.length - 1]!.c;
  }
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]!.t <= simulationEpochMs) {
      idx = i;
    } else {
      break;
    }
  }
  return idx >= 0 ? bars[idx]!.c : null;
}

/** Линии графика INFL: только 6m / 1y / all; история с 2013 независимо от старта симуляции. */
export function buildInflationIndexChartLines(
  simulationEpochMs: number,
  schedule: InflationSchedule = loadInflationSchedule()
): Record<ChartTimeframeId, readonly MarketPriceBar[]> {
  const monthly = buildInflationIndexMonthlyPriceBars(simulationEpochMs, schedule);
  const base = emptyChartLinesByTimeframe();
  return {
    ...base,
    '6m': monthly.slice(-6),
    '1y': monthly.slice(-12),
    all: monthly,
  };
}

export function inflationIndexFirstEpochMs(
  schedule: InflationSchedule = loadInflationSchedule()
): number | null {
  const bars = buildInflationIndexMonthlyPriceBars(
    monthEndEpochMs(
      schedule.lastAvailableYyyymm || INFLATION_INDEX_HISTORY_START_YYYYMM
    ),
    schedule
  );
  return bars[0]?.t ?? monthEndEpochMs(INFLATION_INDEX_HISTORY_START_YYYYMM);
}

function formatFinamDate(epochMs: number): { date: string; time: string } {
  const d = toDate(epochMs, { timeZone: 'Europe/Moscow' });
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return { date: `${yyyy}${mm}${dd}`, time: `${hh}${mi}${ss}` };
}

/**
 * Finam CSV для `indexes/INFL.txt`.
 * Close = MoM-инфляция за месяц, % (одна точка на календарный месяц).
 */
export function buildInflationIndexFinamText(
  schedule: InflationSchedule = loadInflationSchedule()
): string {
  const lines = [
    '<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>',
  ];
  for (const bar of buildInflationIndexBars(schedule)) {
    const { date, time } = formatFinamDate(bar.epochMs);
    const v = Math.round(bar.momInflationPct * 1000) / 1000;
    const cell = v.toFixed(3);
    lines.push(
      `${INFLATION_INDEX_SYMBOL},1,${date},${time},${cell},${cell},${cell},${cell},1`
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Первая доступная MoM-точка (для тестов / документации). */
export function firstInflationIndexYyyymm(
  schedule: InflationSchedule = loadInflationSchedule()
): string | null {
  const keys = listYyyymmSorted(schedule);
  return keys[0] ?? null;
}

export function lastInflationIndexYyyymm(
  schedule: InflationSchedule = loadInflationSchedule()
): string | null {
  const keys = listYyyymmSorted(schedule);
  return keys.length > 0 ? keys[keys.length - 1]! : null;
}
