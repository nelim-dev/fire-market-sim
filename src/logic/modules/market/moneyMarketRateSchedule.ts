import { addDays, format } from 'date-fns';
import { toDate } from 'date-fns-tz';
import {
  loadKeyRateSchedule,
  type KeyRateSchedule,
  type KeyRateEvent,
} from './keyRateSchedule';

/** Спред 0,1% + комиссия фонда 0,5% годовых. */
export const MONEY_MARKET_TOTAL_DEDUCTION_PCT = 0.6;

/** Первая ключевая ставка в KS.txt (YYYYMMDD MSK). */
export const KEY_RATE_FIRST_MSK_DATE = '20130916';

export type RefinancingRateEvent = {
  readonly effectiveMskDate: string;
  readonly ratePct: number;
};

/** 19 периодов ставки рефинансирования (начало каждого периода). */
export const REFINANCING_RATE_EVENTS: readonly RefinancingRateEvent[] = [
  { effectiveMskDate: '20081201', ratePct: 13.0 },
  { effectiveMskDate: '20090424', ratePct: 12.5 },
  { effectiveMskDate: '20090514', ratePct: 12.0 },
  { effectiveMskDate: '20090605', ratePct: 11.5 },
  { effectiveMskDate: '20090713', ratePct: 11.0 },
  { effectiveMskDate: '20090810', ratePct: 10.75 },
  { effectiveMskDate: '20090915', ratePct: 10.5 },
  { effectiveMskDate: '20090930', ratePct: 10.0 },
  { effectiveMskDate: '20091030', ratePct: 9.5 },
  { effectiveMskDate: '20091125', ratePct: 9.0 },
  { effectiveMskDate: '20091228', ratePct: 8.75 },
  { effectiveMskDate: '20100224', ratePct: 8.5 },
  { effectiveMskDate: '20100329', ratePct: 8.25 },
  { effectiveMskDate: '20100430', ratePct: 8.0 },
  { effectiveMskDate: '20100601', ratePct: 7.75 },
  { effectiveMskDate: '20110228', ratePct: 8.0 },
  { effectiveMskDate: '20110503', ratePct: 8.25 },
  { effectiveMskDate: '20111226', ratePct: 8.0 },
  { effectiveMskDate: '20120914', ratePct: 8.25 },
] as const;

export type AccrualRateEvent = {
  /** Календарный день MSK, с которого net-ставка применяется к начислению. */
  readonly accrualStartMskDate: string;
  readonly baseRatePct: number;
  readonly netAnnualPct: number;
};

export function netAnnualPctFromBase(baseRatePct: number): number {
  return baseRatePct - MONEY_MARKET_TOTAL_DEDUCTION_PCT;
}

export function mskYyyymmddToDate(mskYyyymmdd: string): Date {
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  return toDate(`${y}-${m}-${d}T00:00:00`, { timeZone: 'Europe/Moscow' });
}

export function formatMskYyyymmdd(date: Date): string {
  return format(date, 'yyyyMMdd');
}

export function keyRateEventToMskDate(event: KeyRateEvent): string {
  return formatInTimeZoneMsk(event.effectiveEpochMs);
}

function formatInTimeZoneMsk(epochMs: number): string {
  return format(toDate(new Date(epochMs), { timeZone: 'Europe/Moscow' }), 'yyyyMMdd');
}

/** Первый торговый день строго после `mskYyyymmdd` (календарная дата MSK). */
export function nextTradingMskDateStrictlyAfter(
  mskYyyymmdd: string,
  sortedTradingDays: readonly string[]
): string | null {
  let lo = 0;
  let hi = sortedTradingDays.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTradingDays[mid]! > mskYyyymmdd) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans >= 0 ? sortedTradingDays[ans]! : null;
}

/** Календарные дни MSK: (prevMsk, currMsk] — строго после prev, включая curr. */
export function listCalendarDaysBetweenExclusive(
  prevMskYyyymmdd: string,
  currMskYyyymmdd: string
): string[] {
  if (currMskYyyymmdd <= prevMskYyyymmdd) {
    return [];
  }
  const out: string[] = [];
  let cursor = addDays(mskYyyymmddToDate(prevMskYyyymmdd), 1);
  const end = mskYyyymmddToDate(currMskYyyymmdd);
  while (cursor <= end) {
    out.push(formatMskYyyymmdd(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

function mergePolicyEvents(schedule: KeyRateSchedule): Array<{
  policyMskDate: string;
  baseRatePct: number;
}> {
  const events: Array<{ policyMskDate: string; baseRatePct: number }> = [];
  for (const row of REFINANCING_RATE_EVENTS) {
    if (row.effectiveMskDate < KEY_RATE_FIRST_MSK_DATE) {
      events.push({
        policyMskDate: row.effectiveMskDate,
        baseRatePct: row.ratePct,
      });
    }
  }
  for (const row of schedule.events) {
    const msk = keyRateEventToMskDate(row);
    if (msk >= KEY_RATE_FIRST_MSK_DATE) {
      events.push({ policyMskDate: msk, baseRatePct: row.ratePct });
    }
  }
  events.sort((a, b) => a.policyMskDate.localeCompare(b.policyMskDate));
  return events;
}

/** События net-ставки с правилом «следующая торговая сессия после даты политики». */
export function buildAccrualRateEvents(
  sortedTradingDays: readonly string[],
  schedule: KeyRateSchedule = loadKeyRateSchedule()
): AccrualRateEvent[] {
  const policy = mergePolicyEvents(schedule);
  const out: AccrualRateEvent[] = [];
  for (const row of policy) {
    const accrualStart =
      nextTradingMskDateStrictlyAfter(row.policyMskDate, sortedTradingDays) ??
      row.policyMskDate;
    out.push({
      accrualStartMskDate: accrualStart,
      baseRatePct: row.baseRatePct,
      netAnnualPct: netAnnualPctFromBase(row.baseRatePct),
    });
  }
  out.sort((a, b) => a.accrualStartMskDate.localeCompare(b.accrualStartMskDate));
  return out;
}

function resolveNetRateForMskDate(
  mskYyyymmdd: string,
  accrualEvents: readonly AccrualRateEvent[]
): number | null {
  if (accrualEvents.length === 0) {
    return null;
  }
  let lo = 0;
  let hi = accrualEvents.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (accrualEvents[mid]!.accrualStartMskDate <= mskYyyymmdd) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? accrualEvents[ans]!.netAnnualPct : null;
}

/** Net-ставка (% годовых) для начисления на календарный день MSK. */
export function resolveNetAnnualPctForAccrualDay(
  mskYyyymmdd: string,
  accrualEvents: readonly AccrualRateEvent[]
): number | null {
  return resolveNetRateForMskDate(mskYyyymmdd, accrualEvents);
}

/** Карта net-ставок для диапазона календарных дней [fromMsk, toMsk] включительно. */
export function buildNetRateByMskDateMap(
  fromMskYyyymmdd: string,
  toMskYyyymmdd: string,
  sortedTradingDays: readonly string[],
  schedule?: KeyRateSchedule
): Map<string, number> {
  const accrualEvents = buildAccrualRateEvents(sortedTradingDays, schedule);
  const out = new Map<string, number>();
  let cursor = mskYyyymmddToDate(fromMskYyyymmdd);
  const end = mskYyyymmddToDate(toMskYyyymmdd);
  while (cursor <= end) {
    const key = formatMskYyyymmdd(cursor);
    const rate = resolveNetAnnualPctForAccrualDay(key, accrualEvents);
    if (rate !== null) {
      out.set(key, rate);
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Базовая ставка политики на epoch (refinancing до KS, затем KS + forward-fill). */
export function resolveBasePolicyRatePct(
  epochMs: number,
  schedule: KeyRateSchedule = loadKeyRateSchedule()
): number | null {
  const ksFirstMs = mskYyyymmddToDate(KEY_RATE_FIRST_MSK_DATE).getTime();
  if (epochMs >= ksFirstMs) {
    const events = schedule.events;
    if (events.length === 0) {
      return null;
    }
    let lo = 0;
    let hi = events.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid]!.effectiveEpochMs <= epochMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans >= 0 ? events[ans]!.ratePct : null;
  }
  const msk = formatInTimeZoneMsk(epochMs);
  let base: number | null = null;
  for (const row of REFINANCING_RATE_EVENTS) {
    if (row.effectiveMskDate <= msk) {
      base = row.ratePct;
    } else {
      break;
    }
  }
  return base;
}
