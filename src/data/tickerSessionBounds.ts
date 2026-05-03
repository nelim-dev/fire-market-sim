import { formatInTimeZone, toDate } from 'date-fns-tz';

/**
 * Finam CSV: TICKER,PER,DATE,TIME,OPEN,HIGH,LOW,CLOSE,VOL
 * DATE = YYYYMMDD, TIME = HHMMSS (минутные свечи)
 * Дата/время в файлах — как на бирже (используем Europe/Moscow).
 */

const DATA_LINE =
  /^([A-Za-z0-9._-]+),(\d+),(\d{8}),(\d{1,6}),(.+)$/;

export function parseFinamDataLine(
  line: string
): { ticker: string; date: string; time: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const head = trimmed.split(',')[0]?.trim() ?? '';
  if (head === '<TICKER>' || head.toUpperCase() === 'TICKER') return null;
  const m = trimmed.match(DATA_LINE);
  if (!m) return null;
  const date = m[3];
  const time = m[4];
  if (!date || !time) return null;
  return {
    ticker: m[1],
    date,
    time: time.padStart(6, '0').slice(0, 6),
  };
}

export function finamDateTimeToEpochMs(dateYyyymmdd: string, timeHhmmss: string): number {
  const d = dateYyyymmdd;
  const t = timeHhmmss.padStart(6, '0');
  const isoLocal = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  return toDate(isoLocal, { timeZone: 'Europe/Moscow' }).getTime();
}

/** Ключ календарного дня по Москве (YYYYMMDD) для группировки минуток */
export function mskDateKeyYyyymmdd(epochMs: number): string {
  return formatInTimeZone(epochMs, 'Europe/Moscow', 'yyyyMMdd');
}

/** 10:00 МСК в тот же календарный день (МСК), что и указанный момент */
export function mskSessionOpenOnSameDayEpochMs(anyInstantMs: number): number {
  const ymd = formatInTimeZone(anyInstantMs, 'Europe/Moscow', 'yyyy-MM-dd');
  return toDate(`${ymd}T10:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

/** Верхняя граница основной сессии: не позже 18:50 МСК в этот день */
export function mskSessionMainCloseCapEpochMs(anyInstantMs: number): number {
  const ymd = formatInTimeZone(anyInstantMs, 'Europe/Moscow', 'yyyy-MM-dd');
  return toDate(`${ymd}T18:50:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

/**
 * Старт симуляции: наименьшее первое время среди тикеров, но не раньше 10:00 МСК в этот день.
 */
export function clampSimulationStartMs(minFirstBarAmongTickers: number): number {
  const open = mskSessionOpenOnSameDayEpochMs(minFirstBarAmongTickers);
  return Math.max(minFirstBarAmongTickers, open);
}

/** Последняя свеча файла, обрезанная по потолку 18:50 МСК этого дня */
export function capLastBarToSessionMs(lastBarMs: number): number {
  const cap = mskSessionMainCloseCapEpochMs(lastBarMs);
  return Math.min(lastBarMs, cap);
}

