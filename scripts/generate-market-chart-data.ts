/**
 * Агрегаты для карточки инструмента: дневные, 5м, 30м, 1ч, недельные (см. план M3 §6.2).
 * Запуск: npm run gen:market-chart-data  (алиас: gen:market-daily-bars)
 */
import { createReadStream } from 'node:fs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getISOWeek, getISOWeekYear } from 'date-fns';
import { toDate } from 'date-fns-tz';
import type { MarketInstrumentCatalogItem } from '../src/logic/modules/market/contracts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');

const FIVE_MS = 5 * 60 * 1000;
const THIRTY_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 86_400_000;

type CatalogShape = { items: MarketInstrumentCatalogItem[] };
type CalendarShape = {
  days: Array<{
    mskDateYyyymmdd: string;
    sessionStartEpochMs?: number;
    sessionEndEpochMs: number;
  }>;
};

type Bar = { t: number; c: number };

function loadCalendarContext(): {
  sessionEndByDate: Map<string, number>;
  /** Бары внутри симуляции + запас слева (годовой lookback) и справа по суткам. */
  barEpochFilter: { minMs: number; maxMs: number } | null;
} {
  const calPath = join(projectRoot, 'src', 'data', 'generated', 'tradingCalendar.json');
  const raw = JSON.parse(readFileSync(calPath, 'utf-8')) as CalendarShape;
  const days = raw.days ?? [];
  const sessionEndByDate = new Map<string, number>();
  for (const d of days) {
    if (d.mskDateYyyymmdd) {
      sessionEndByDate.set(d.mskDateYyyymmdd, d.sessionEndEpochMs);
    }
  }
  if (days.length === 0) {
    return { sessionEndByDate, barEpochFilter: null };
  }
  const first = days[0];
  const last = days[days.length - 1];
  /** −370 суток: дневной график «Год» в начале симуляции смотрит ~365 кал. дней назад. */
  const minMs =
    (first.sessionStartEpochMs ?? first.sessionEndEpochMs) - 370 * DAY_MS;
  const maxMs = last.sessionEndEpochMs + DAY_MS;
  return { sessionEndByDate, barEpochFilter: { minMs, maxMs } };
}

function sessionEndEpochForDate(
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

function barEpochMskMinute(mskYyyymmdd: string, hhmmss: string): number {
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  const hh = hhmmss.slice(0, 2);
  const mi = hhmmss.slice(2, 4);
  const ss = hhmmss.slice(4, 6);
  const local = `${y}-${m}-${d}T${hh}:${mi}:${ss}`;
  return toDate(local, { timeZone: 'Europe/Moscow' }).getTime();
}

function mapToSortedBars(map: Map<number, Bar>): Bar[] {
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function buildWeeklyFromDaily(dailies: Bar[]): Bar[] {
  if (dailies.length === 0) {
    return [];
  }
  const byWeek = new Map<string, Bar>();
  for (const b of dailies) {
    const dt = new Date(b.t);
    const key = `${getISOWeekYear(dt)}-W${String(getISOWeek(dt)).padStart(2, '0')}`;
    const prev = byWeek.get(key);
    if (!prev || b.t >= prev.t) {
      byWeek.set(key, b);
    }
  }
  return [...byWeek.values()].sort((a, b) => a.t - b.t);
}

async function processSymbolFile(
  absolutePath: string,
  sessionEndByDate: Map<string, number>,
  barEpochFilter: { minMs: number; maxMs: number } | null
): Promise<{
  daily: Bar[];
  five: Bar[];
  thirty: Bar[];
  oneH: Bar[];
}> {
  const dayTo = new Map<string, { close: number; maxTime: string }>();
  const b5 = new Map<number, Bar>();
  const b30 = new Map<number, Bar>();
  const b1h = new Map<number, Bar>();

  let lineNo = 0;
  const stream = createReadStream(absolutePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineNo += 1;
    if (lineNo === 1) {
      continue;
    }
    const parts = line.split(',');
    if (parts.length < 8) {
      continue;
    }
    const date = parts[2]?.trim();
    const timeRaw = parts[3]?.trim() ?? '';
    const time = timeRaw.padStart(6, '0');
    const close = Number(parts[7]);
    if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time) || !Number.isFinite(close)) {
      continue;
    }

    const tBar = barEpochMskMinute(date, time);
    if (
      barEpochFilter !== null &&
      (tBar < barEpochFilter.minMs || tBar > barEpochFilter.maxMs)
    ) {
      continue;
    }

    const prevD = dayTo.get(date);
    if (!prevD || time >= prevD.maxTime) {
      dayTo.set(date, { close, maxTime: time });
    }

    const k5 = Math.floor(tBar / FIVE_MS) * FIVE_MS;
    b5.set(k5, { t: tBar, c: close });

    const k30 = Math.floor(tBar / THIRTY_MS) * THIRTY_MS;
    b30.set(k30, { t: tBar, c: close });

    const k1h = Math.floor(tBar / HOUR_MS) * HOUR_MS;
    b1h.set(k1h, { t: tBar, c: close });
  }

  const dates = [...dayTo.keys()].sort();
  const daily: Bar[] = [];
  for (const date of dates) {
    const row = dayTo.get(date);
    if (!row) {
      continue;
    }
    daily.push({
      t: sessionEndEpochForDate(sessionEndByDate, date),
      c: row.close,
    });
  }

  return {
    daily,
    five: mapToSortedBars(b5),
    thirty: mapToSortedBars(b30),
    oneH: mapToSortedBars(b1h),
  };
}

async function main(): Promise<void> {
  const catalogPath = join(projectRoot, 'src', 'data', 'generated', 'marketInstrumentCatalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as CatalogShape;
  const items = Array.isArray(catalog.items) ? catalog.items : [];
  const { sessionEndByDate, barEpochFilter } = loadCalendarContext();

  const dailyCloseBySymbol: Record<string, Bar[]> = {};
  const fiveMinuteBySymbol: Record<string, Bar[]> = {};
  const thirtyMinuteBySymbol: Record<string, Bar[]> = {};
  const oneHourBySymbol: Record<string, Bar[]> = {};
  const weeklyBySymbol: Record<string, Bar[]> = {};

  for (const item of items) {
    const abs = normalize(join(projectRoot, ...item.sourceFilePath.split('/')));
    const sym = item.symbol.toUpperCase();
    const { daily, five, thirty, oneH } = await processSymbolFile(
      abs,
      sessionEndByDate,
      barEpochFilter
    );
    dailyCloseBySymbol[sym] = daily;
    fiveMinuteBySymbol[sym] = five;
    thirtyMinuteBySymbol[sym] = thirty;
    oneHourBySymbol[sym] = oneH;
    weeklyBySymbol[sym] = buildWeeklyFromDaily(daily);
    console.log(
      `[gen:market-chart-data] ${sym}: daily=${daily.length} 5m=${five.length} 30m=${thirty.length} 1h=${oneH.length} weekly=${weeklyBySymbol[sym].length}`
    );
  }

  const outDir = join(projectRoot, 'src', 'data', 'generated');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'marketChartSlices.json');
  const payload = {
    dailyCloseBySymbol,
    fiveMinuteBySymbol,
    thirtyMinuteBySymbol,
    oneHourBySymbol,
    weeklyBySymbol,
  };
  writeFileSync(outPath, `${JSON.stringify(payload)}\n`, 'utf-8');
  console.log(`[gen:market-chart-data] записано → ${outPath} (компактный JSON)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
