import { formatInTimeZone } from 'date-fns-tz';
import inflationScheduleJson from '@/data/generated/inflationSchedule.json';
import {
  parseInflationScheduleText,
  type InflationSchedule,
} from './inflationScheduleParse';

export type { InflationSchedule } from './inflationScheduleParse';
export { parseInflationScheduleText } from './inflationScheduleParse';

function normalizeSchedule(raw: {
  momByYyyymm?: Record<string, number>;
  lastAvailableYyyymm?: string;
}): InflationSchedule {
  const momByYyyymm: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.momByYyyymm ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      momByYyyymm[key] = n;
    }
  }
  const lastAvailableYyyymm =
    typeof raw.lastAvailableYyyymm === 'string' ? raw.lastAvailableYyyymm : '';
  return { momByYyyymm, lastAvailableYyyymm };
}

let cachedSchedule: InflationSchedule | null = null;

export function loadInflationSchedule(): InflationSchedule {
  if (cachedSchedule) return cachedSchedule;
  cachedSchedule = normalizeSchedule(
    inflationScheduleJson as {
      momByYyyymm?: Record<string, number>;
      lastAvailableYyyymm?: string;
    }
  );
  return cachedSchedule;
}

export function resetInflationScheduleCacheForTests(): void {
  cachedSchedule = null;
}

export function epochMsToYyyymm(epochMs: number): string {
  return formatInTimeZone(epochMs, 'Europe/Moscow', 'yyyyMM');
}

/** MoM-индекс для календарного месяца; после конца ряда — forward-fill последнего. */
export function resolveMomIndex(
  yyyymm: string,
  schedule: InflationSchedule = loadInflationSchedule()
): number | null {
  if (schedule.lastAvailableYyyymm && yyyymm > schedule.lastAvailableYyyymm) {
    return schedule.momByYyyymm[schedule.lastAvailableYyyymm] ?? null;
  }
  return schedule.momByYyyymm[yyyymm] ?? null;
}

function addMonthsYyyymm(yyyymm: string, delta: number): string {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}${String(nm).padStart(2, '0')}`;
}

function listYyyymmInclusive(fromYyyymm: string, toYyyymm: string): string[] {
  if (fromYyyymm > toYyyymm) return [];
  const out: string[] = [];
  let cursor = fromYyyymm;
  while (cursor <= toYyyymm) {
    out.push(cursor);
    if (cursor === toYyyymm) break;
    cursor = addMonthsYyyymm(cursor, 1);
  }
  return out;
}

/** Накопленный CPI-множитель (произведение MoM/100) от `from` до `to` включительно. */
export function resolveCumulativeCpiMultiplier(
  fromYyyymm: string,
  toYyyymm: string,
  schedule: InflationSchedule = loadInflationSchedule()
): number {
  let product = 1;
  for (const month of listYyyymmInclusive(fromYyyymm, toYyyymm)) {
    const mom = resolveMomIndex(month, schedule);
    if (mom !== null) {
      product *= mom / 100;
    }
  }
  return product;
}

/**
 * Rolling 12 месяцев MoM: ((∏ index/100) − 1) × 100.
 * Берёт до 12 месяцев, заканчивая текущим (или последним доступным).
 */
export function resolveRolling12mInflationPct(
  epochMs: number,
  schedule: InflationSchedule = loadInflationSchedule()
): number | null {
  let endYyyymm = epochMsToYyyymm(epochMs);
  if (
    schedule.lastAvailableYyyymm &&
    endYyyymm > schedule.lastAvailableYyyymm
  ) {
    endYyyymm = schedule.lastAvailableYyyymm;
  }

  const months: string[] = [];
  let cursor = endYyyymm;
  for (let i = 0; i < 12; i += 1) {
    if (resolveMomIndex(cursor, schedule) !== null) {
      months.unshift(cursor);
    }
    if (cursor <= '199101') break;
    cursor = addMonthsYyyymm(cursor, -1);
  }
  if (months.length === 0) return null;

  let product = 1;
  for (const month of months) {
    const mom = resolveMomIndex(month, schedule)!;
    product *= mom / 100;
  }
  return (product - 1) * 100;
}
