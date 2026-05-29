import { getISOWeek, getISOWeekYear } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import type { MarketPriceBar } from './priceSeries';

export const INTRADAY_FIVE_MIN_MS = 5 * 60 * 1000;
export const INTRADAY_THIRTY_MIN_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FIVE_MS = INTRADAY_FIVE_MIN_MS;
const THIRTY_MS = INTRADAY_THIRTY_MIN_MS;

function bucketStartMs(tBar: number, stepMs: number): number {
  return Math.floor(tBar / stepMs) * stepMs;
}

function foldMinuteRowsIntoBucket(
  rows: readonly MarketPriceBar[],
  bucketT: number
): MarketPriceBar {
  let bar: MarketPriceBar | null = null;
  for (const row of rows) {
    bar = bar
      ? {
          t: bucketT,
          o: bar.o,
          h: Math.max(bar.h, row.h),
          l: Math.min(bar.l, row.l),
          c: row.c,
          v: bar.v + row.v,
        }
      : { t: bucketT, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v };
  }
  return bar!;
}

/**
 * Обновляет один 5m/30m/1h бар по минуткам в том же bucket, сохраняя остальную историю.
 * Нужен для инкрементального FIREIDX: нельзя пересобирать агрегаты только из trimmed minute.
 */
export function mergeMinuteBucketIntoAggregatedBars(
  aggregated: readonly MarketPriceBar[],
  minuteBars: readonly MarketPriceBar[],
  stepMs: number,
  triggerMinute: MarketPriceBar
): MarketPriceBar[] {
  const bucketT = bucketStartMs(triggerMinute.t, stepMs);
  const inBucket = minuteBars.filter(
    (b) => bucketStartMs(b.t, stepMs) === bucketT
  );
  if (inBucket.length === 0) {
    return [...aggregated];
  }
  const merged = foldMinuteRowsIntoBucket(inBucket, bucketT);
  const next = [...aggregated];
  const idx = next.findIndex((b) => b.t === bucketT);
  if (idx >= 0) {
    next[idx] = merged;
  } else {
    next.push(merged);
    next.sort((a, b) => a.t - b.t);
  }
  return next;
}

/** Ключ даты МСК YYYYMMDD для строки баров. */
export function mskYyyymmddFromEpochMs(epochMs: number): string {
  return formatInTimeZone(epochMs, 'Europe/Moscow', 'yyyyMMdd');
}

export function sessionEndEpochForDate(
  sessionEndByDate: Map<string, number>,
  mskYyyymmdd: string
): number {
  const fromCal = sessionEndByDate.get(mskYyyymmdd);
  if (fromCal !== undefined) {
    return fromCal;
  }
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  const local = `${y}-${m}-${d} 18:45:00`;
  return toDate(local, { timeZone: 'Europe/Moscow' }).getTime();
}

function buildWeeklyFromDaily(dailies: readonly MarketPriceBar[]): MarketPriceBar[] {
  if (dailies.length === 0) {
    return [];
  }
  const byWeek = new Map<string, MarketPriceBar>();
  for (const b of dailies) {
    const dt = new Date(b.t);
    const key = `${getISOWeekYear(dt)}-W${String(getISOWeek(dt)).padStart(2, '0')}`;
    const prev = byWeek.get(key);
    if (!prev || b.t >= prev.t) {
      byWeek.set(key, { ...b });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.t - b.t);
}

/**
 * Из отсортированных минутных точек (t, c) строит дневные закрытия и агрегаты 5m / 30m / 1h
 * по той же логике, что и потоковый импорт из .txt.
 */
export function aggregateMinuteRowsToBundles(
  sortedMinutes: readonly MarketPriceBar[],
  sessionEndByDate: Map<string, number>
): {
  minute: MarketPriceBar[];
  dailyClose: MarketPriceBar[];
  fiveMinute: MarketPriceBar[];
  thirtyMinute: MarketPriceBar[];
  oneHour: MarketPriceBar[];
  weekly: MarketPriceBar[];
} {
  const dayTo = new Map<
    string,
    {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      maxTime: string;
      startTime: string;
    }
  >();
  const b5 = new Map<number, MarketPriceBar>();
  const b30 = new Map<number, MarketPriceBar>();
  const b1h = new Map<number, MarketPriceBar>();

  for (const row of sortedMinutes) {
    const tBar = row.t;
    const close = row.c;
    const date = mskYyyymmddFromEpochMs(tBar);
    const time = formatInTimeZone(tBar, 'Europe/Moscow', 'HHmmss');

    const prevD = dayTo.get(date);
    if (!prevD) {
      dayTo.set(date, {
        open: row.o,
        high: row.h,
        low: row.l,
        close: row.c,
        volume: row.v,
        maxTime: time,
        startTime: time,
      });
    } else {
      dayTo.set(date, {
        open: time < prevD.startTime ? row.o : prevD.open,
        high: Math.max(prevD.high, row.h),
        low: Math.min(prevD.low, row.l),
        close: time >= prevD.maxTime ? row.c : prevD.close,
        volume: prevD.volume + row.v,
        maxTime: time >= prevD.maxTime ? time : prevD.maxTime,
        startTime: time < prevD.startTime ? time : prevD.startTime,
      });
    }

    const k5 = Math.floor(tBar / FIVE_MS) * FIVE_MS;
    const prev5 = b5.get(k5);
    b5.set(
      k5,
      prev5
        ? {
            t: k5,
            o: prev5.o,
            h: Math.max(prev5.h, row.h),
            l: Math.min(prev5.l, row.l),
            c: row.c,
            v: prev5.v + row.v,
          }
        : { t: k5, o: row.o, h: row.h, l: row.l, c: close, v: row.v }
    );

    const k30 = Math.floor(tBar / THIRTY_MS) * THIRTY_MS;
    const prev30 = b30.get(k30);
    b30.set(
      k30,
      prev30
        ? {
            t: k30,
            o: prev30.o,
            h: Math.max(prev30.h, row.h),
            l: Math.min(prev30.l, row.l),
            c: row.c,
            v: prev30.v + row.v,
          }
        : { t: k30, o: row.o, h: row.h, l: row.l, c: close, v: row.v }
    );

    const k1h = Math.floor(tBar / HOUR_MS) * HOUR_MS;
    const prev1h = b1h.get(k1h);
    b1h.set(
      k1h,
      prev1h
        ? {
            t: k1h,
            o: prev1h.o,
            h: Math.max(prev1h.h, row.h),
            l: Math.min(prev1h.l, row.l),
            c: row.c,
            v: prev1h.v + row.v,
          }
        : { t: k1h, o: row.o, h: row.h, l: row.l, c: close, v: row.v }
    );
  }

  const dates = [...dayTo.keys()].sort();
  const dailyClose: MarketPriceBar[] = [];
  for (const date of dates) {
    const row = dayTo.get(date);
    if (!row) {
      continue;
    }
    dailyClose.push({
      t: sessionEndEpochForDate(sessionEndByDate, date),
      o: row.open,
      h: row.high,
      l: row.low,
      c: row.close,
      v: row.volume,
    });
  }

  const mapToSorted = (m: Map<number, MarketPriceBar>) =>
    [...m.values()].sort((a, b) => a.t - b.t);

  const fiveMinute = mapToSorted(b5);
  const thirtyMinute = mapToSorted(b30);
  const oneHour = mapToSorted(b1h);
  const weekly = buildWeeklyFromDaily(dailyClose);

  return {
    minute: sortedMinutes.map((row) => ({ ...row })),
    dailyClose,
    fiveMinute,
    thirtyMinute,
    oneHour,
    weekly,
  };
}
