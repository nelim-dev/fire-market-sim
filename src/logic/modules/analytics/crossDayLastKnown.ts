import type { TradingDayRecord } from '@/data/domain/TradingDaySession';
import tradingCalendarJson from '@/data/generated/tradingCalendar.json';
import { ANALYTICS_LAST_KNOWN_LOOKBACK_DAYS, ANALYTICS_MODEL_TICKERS } from './modelConstants';
import {
  foldTradingDayIntoLastKnown,
  lastKnownSessionFromClosePrice,
  type DayMinuteBundle,
  type LastKnownSessionBySymbol,
} from './modelDayTensor';
import { normalizeAnalyticsSeedClose } from './ohlcFormatNormalize';

const calendarDays: TradingDayRecord[] =
  (tradingCalendarJson as { days: TradingDayRecord[] }).days ?? [];

/** Sorted trading days strictly before mskDateYyyymmdd (optionally capped). */
export function tradingDaysBeforeMsk(
  mskDateYyyymmdd: string,
  maxLookbackDays: number = ANALYTICS_LAST_KNOWN_LOOKBACK_DAYS
): string[] {
  const all = calendarDays
    .filter((d) => d.mskDateYyyymmdd < mskDateYyyymmdd)
    .map((d) => d.mskDateYyyymmdd);
  if (maxLookbackDays <= 0 || all.length <= maxLookbackDays) {
    return all;
  }
  return all.slice(all.length - maxLookbackDays);
}

/** Previous trading day MSK date, or null. */
export function previousTradingDayMsk(mskDateYyyymmdd: string): string | null {
  const before = tradingDaysBeforeMsk(mskDateYyyymmdd, Number.MAX_SAFE_INTEGER);
  return before.length > 0 ? before[before.length - 1]! : null;
}

/** Trading days in (fromExclusive, throughInclusive] — for incremental fold. */
export function tradingDaysAfterThrough(
  fromExclusive: string | null,
  throughInclusive: string
): string[] {
  return calendarDays
    .map((d) => d.mskDateYyyymmdd)
    .filter((d) => d <= throughInclusive && (fromExclusive === null || d > fromExclusive));
}

export type LoadDayMinuteBundle = (
  mskDateYyyymmdd: string
) => DayMinuteBundle | Promise<DayMinuteBundle>;

export type LastKnownSeedBySymbol = Record<string, number | null | undefined>;

/** Apply SQLite one-bar seed for symbols still missing last_known after fold. */
export function applyLastKnownSeed(
  state: LastKnownSessionBySymbol,
  seedBySymbol: LastKnownSeedBySymbol | null | undefined,
  dayMinutesBySymbol?: DayMinuteBundle | null
): LastKnownSessionBySymbol {
  if (!seedBySymbol) {
    return state;
  }
  const next: LastKnownSessionBySymbol = { ...state };
  for (const ticker of ANALYTICS_MODEL_TICKERS) {
    const sym = ticker.toUpperCase();
    if (next[sym]) {
      continue;
    }
    const raw = seedBySymbol[sym] ?? seedBySymbol[ticker];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      continue;
    }
    const minutes = dayMinutesBySymbol?.[sym] ?? dayMinutesBySymbol?.[ticker] ?? [];
    const close = normalizeAnalyticsSeedClose(sym, raw, minutes);
    next[sym] = lastKnownSessionFromClosePrice(close);
  }
  return next;
}

/**
 * Build last_known map as of end of `beforeMskDate` (exclusive).
 * Walks at most ANALYTICS_LAST_KNOWN_LOOKBACK_DAYS trading days.
 */
export async function buildCrossDayLastKnownBefore(
  beforeMskDate: string,
  loadDayMinutes: LoadDayMinuteBundle,
  startAfterMsk?: string | null,
  initialState?: LastKnownSessionBySymbol | null,
  seedBySymbol?: LastKnownSeedBySymbol | null
): Promise<LastKnownSessionBySymbol> {
  let state: LastKnownSessionBySymbol = initialState ? { ...initialState } : {};
  const days = tradingDaysBeforeMsk(beforeMskDate).filter(
    (d) => !startAfterMsk || d > startAfterMsk
  );
  for (const msk of days) {
    const bundle = await loadDayMinutes(msk);
    state = foldTradingDayIntoLastKnown(bundle, msk, state);
  }
  return applyLastKnownSeed(state, seedBySymbol);
}

/**
 * Incrementally fold trading days into persisted analytics state.
 */
export async function ensureLastKnownThroughMsk(
  throughMsk: string,
  loadDayMinutes: LoadDayMinuteBundle,
  builtThroughMsk: string | null,
  currentState: LastKnownSessionBySymbol | null,
  seedBySymbol?: LastKnownSeedBySymbol | null
): Promise<{ state: LastKnownSessionBySymbol; builtThroughMsk: string }> {
  let state: LastKnownSessionBySymbol = currentState ? { ...currentState } : {};
  let days = tradingDaysAfterThrough(builtThroughMsk, throughMsk);
  if (days.length > ANALYTICS_LAST_KNOWN_LOOKBACK_DAYS) {
    days = days.slice(days.length - ANALYTICS_LAST_KNOWN_LOOKBACK_DAYS);
  }
  for (const msk of days) {
    const bundle = await loadDayMinutes(msk);
    state = foldTradingDayIntoLastKnown(bundle, msk, state);
  }
  state = applyLastKnownSeed(state, seedBySymbol);
  return { state, builtThroughMsk: throughMsk };
}
