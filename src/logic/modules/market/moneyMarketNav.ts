import {
  listCalendarDaysBetweenExclusive,
  resolveNetAnnualPctForAccrualDay,
  type AccrualRateEvent,
} from './moneyMarketRateSchedule';

export const DN_R_INITIAL_NAV_RUB = 10;
export const DN_R_NAV_DECIMALS = 6;

export function dailyAccrualFactor(netAnnualPct: number): number {
  return 1 + netAnnualPct / 100 / 365;
}

export function roundNavRub(nav: number): number {
  const factor = 10 ** DN_R_NAV_DECIMALS;
  return Math.round(nav * factor) / factor;
}

/**
 * NAV на открытие каждой торговой сессии.
 * Между сессиями — сложный процент за каждый календарный день (365-дневный год).
 */
export function computeNavSeries(
  tradingDays: readonly { mskDateYyyymmdd: string }[],
  accrualEvents: readonly AccrualRateEvent[],
  initialNavRub: number = DN_R_INITIAL_NAV_RUB
): Map<string, number> {
  const out = new Map<string, number>();
  if (tradingDays.length === 0) {
    return out;
  }

  let nav = initialNavRub;
  out.set(tradingDays[0]!.mskDateYyyymmdd, roundNavRub(nav));

  for (let i = 1; i < tradingDays.length; i += 1) {
    const prev = tradingDays[i - 1]!.mskDateYyyymmdd;
    const curr = tradingDays[i]!.mskDateYyyymmdd;
    const calendarDays = listCalendarDaysBetweenExclusive(prev, curr);
    for (const day of calendarDays) {
      const netRate = resolveNetAnnualPctForAccrualDay(day, accrualEvents);
      if (netRate === null) {
        continue;
      }
      nav *= dailyAccrualFactor(netRate);
    }
    out.set(curr, roundNavRub(nav));
  }

  return out;
}

/** Минутные бары одной сессии: константный OHLC, шаг 1 мин. */
export function buildFlatSessionMinuteBars(args: {
  priceRub: number;
  sessionStartEpochMs: number;
  sessionEndEpochMs: number;
}): Array<{
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}> {
  const { priceRub, sessionStartEpochMs, sessionEndEpochMs } = args;
  const price = roundNavRub(priceRub);
  const bars: Array<{
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }> = [];
  for (let t = sessionStartEpochMs; t <= sessionEndEpochMs; t += 60_000) {
    bars.push({ t, o: price, h: price, l: price, c: price, v: 0 });
  }
  return bars;
}
