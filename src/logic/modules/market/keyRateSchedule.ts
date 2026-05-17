import { toDate } from 'date-fns-tz';
import keyRateScheduleJson from '@/data/generated/keyRateSchedule.json';

export type KeyRateEvent = {
  readonly effectiveEpochMs: number;
  readonly ratePct: number;
};

export type KeyRateSchedule = {
  readonly events: readonly KeyRateEvent[];
};

/** Первая дата в `indexes/KS.txt` (ставка ЦБ с этой даты). */
export const KEY_RATE_FIRST_EFFECTIVE_MSK = '2013-09-16';

function parseMskDateToEpochMs(ddMmYyyy: string): number | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddMmYyyy.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const local = `${yyyy}-${mm}-${dd}T00:00:00`;
  return toDate(local, { timeZone: 'Europe/Moscow' }).getTime();
}

function parseRatePct(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeSchedule(raw: {
  events?: Array<{ effectiveEpochMs?: number; ratePct?: number }>;
}): KeyRateSchedule {
  const events = (raw.events ?? [])
    .map((e) => ({
      effectiveEpochMs: Number(e.effectiveEpochMs),
      ratePct: Number(e.ratePct),
    }))
    .filter(
      (e) => Number.isFinite(e.effectiveEpochMs) && Number.isFinite(e.ratePct)
    )
    .sort((a, b) => a.effectiveEpochMs - b.effectiveEpochMs);
  return { events };
}

/** Парсит содержимое `indexes/KS.txt` (таб: дата, ставка). Используется в build-скриптах и тестах. */
export function parseKeyRateScheduleText(text: string): KeyRateSchedule {
  const events: KeyRateEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf('\t');
    if (tab < 0) continue;
    const dateStr = trimmed.slice(0, tab);
    const rateStr = trimmed.slice(tab + 1);
    const effectiveEpochMs = parseMskDateToEpochMs(dateStr);
    const ratePct = parseRatePct(rateStr);
    if (effectiveEpochMs === null || ratePct === null) continue;
    events.push({ effectiveEpochMs, ratePct });
  }
  events.sort((a, b) => a.effectiveEpochMs - b.effectiveEpochMs);
  return { events };
}

/** Последняя ставка, действующая на `epochMs` (step-function), или `null` до первого события. */
export function resolveKeyRatePct(
  epochMs: number,
  schedule: KeyRateSchedule
): number | null {
  const events = schedule.events;
  if (events.length === 0 || epochMs < events[0].effectiveEpochMs) {
    return null;
  }
  let lo = 0;
  let hi = events.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].effectiveEpochMs <= epochMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? events[ans].ratePct : null;
}

let cachedSchedule: KeyRateSchedule | null = null;

/** Расписание из `src/data/generated/keyRateSchedule.json` (пишется `build:market-db`). */
export function loadKeyRateSchedule(): KeyRateSchedule {
  if (cachedSchedule) return cachedSchedule;
  cachedSchedule = normalizeSchedule(
    keyRateScheduleJson as {
      events?: Array<{ effectiveEpochMs?: number; ratePct?: number }>;
    }
  );
  return cachedSchedule;
}

/** Сброс кэша (тесты). */
export function resetKeyRateScheduleCacheForTests(): void {
  cachedSchedule = null;
}
