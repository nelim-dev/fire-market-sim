import { getISOWeek, getISOWeekYear } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import type { MarketPriceBar } from './priceSeries';

const FIVE_MS = 5 * 60 * 1000;
const THIRTY_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

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
      byWeek.set(key, { t: b.t, c: b.c });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.t - b.t);
}

/**
 * Из отсортированных минутных точек (t, c) строит дневные закрытия и агрегаты 5m / 30m / 1h
 * по той же логике, что и потоковый импорт из .txt.
 */
export function aggregateMinuteRowsToBundles(
  sortedMinutes: readonly { t: number; c: number }[],
  sessionEndByDate: Map<string, number>
): {
  minute: MarketPriceBar[];
  dailyClose: MarketPriceBar[];
  fiveMinute: MarketPriceBar[];
  thirtyMinute: MarketPriceBar[];
  oneHour: MarketPriceBar[];
  weekly: MarketPriceBar[];
} {
  const dayTo = new Map<string, { close: number; maxTime: string }>();
  const b5 = new Map<number, MarketPriceBar>();
  const b30 = new Map<number, MarketPriceBar>();
  const b1h = new Map<number, MarketPriceBar>();

  for (const row of sortedMinutes) {
    const tBar = row.t;
    const close = row.c;
    const date = mskYyyymmddFromEpochMs(tBar);
    const time = formatInTimeZone(tBar, 'Europe/Moscow', 'HHmmss');

    const prevD = dayTo.get(date);
    if (!prevD || time >= prevD.maxTime) {
      dayTo.set(date, { close, maxTime: time });
    }

    const k5 = Math.floor(tBar / FIVE_MS) * FIVE_MS;
    b5.set(k5, { t: k5, c: close });

    const k30 = Math.floor(tBar / THIRTY_MS) * THIRTY_MS;
    b30.set(k30, { t: k30, c: close });

    const k1h = Math.floor(tBar / HOUR_MS) * HOUR_MS;
    b1h.set(k1h, { t: k1h, c: close });
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
      c: row.close,
    });
  }

  const mapToSorted = (m: Map<number, MarketPriceBar>) =>
    [...m.values()].sort((a, b) => a.t - b.t);

  const fiveMinute = mapToSorted(b5);
  const thirtyMinute = mapToSorted(b30);
  const oneHour = mapToSorted(b1h);
  const weekly = buildWeeklyFromDaily(dailyClose);

  return {
    minute: sortedMinutes.map((row) => ({ t: row.t, c: row.c })),
    dailyClose,
    fiveMinute,
    thirtyMinute,
    oneHour,
    weekly,
  };
}
