import { toDate } from 'date-fns-tz';
import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';
import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_FEAT_DIM,
  ANALYTICS_FEATS_PER_TICKER,
  ANALYTICS_FEATURE_NAMES,
  ANALYTICS_FIVE_MIN_MS,
  ANALYTICS_MODEL_TICKERS,
  ANALYTICS_VOL_SCALE,
  type AnalyticsFeatureName,
} from './modelConstants';
import { normalizeAnalyticsMinuteBars } from './ohlcFormatNormalize';

export type ModelDayTensor = number[][];

export type DayMinuteBundle = Record<string, readonly MarketPriceBar[]>;

type OhlcvRow = [number, number, number, number, number];

/** 107×5 unscaled session (before VOL/10000), as in prepare_raw last_known. */
export type OhlcvSession = OhlcvRow[];

export type LastKnownSessionBySymbol = Record<string, OhlcvSession | null>;

/** MSK YYYYMMDD of first minute bar per symbol (prepare_raw first_listing). */
export type FirstListingMskBySymbol = Record<string, string | null | undefined>;

const FEAT_IDX: Record<AnalyticsFeatureName, number> = {
  OPEN: 0,
  HIGH: 1,
  LOW: 2,
  CLOSE: 3,
  VOL: 4,
};

const DAY_MS = 86_400_000;

/** 10:00 MSK on calendar day YYYYMMDD. */
export function sessionGridStartMs(mskYyyymmdd: string): number {
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  return toDate(`${y}-${m}-${d}T10:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

/** 18:50 MSK on calendar day YYYYMMDD. */
export function sessionGridEndMs(mskYyyymmdd: string): number {
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  return toDate(`${y}-${m}-${d}T18:50:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

/** Calendar day [00:00, 24:00) MSK — same filter as pandas normalize() day slice. */
export function calendarDayBoundsMs(mskYyyymmdd: string): { startMs: number; endExclusiveMs: number } {
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  const startMs = toDate(`${y}-${m}-${d}T00:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
  return { startMs, endExclusiveMs: startMs + DAY_MS };
}

/** Keep only minutes belonging to the calendar day (matches prepare_raw df_day filter). */
export function filterMinutesToCalendarDay(
  minutes: readonly MarketPriceBar[],
  mskYyyymmdd: string
): MarketPriceBar[] {
  const { startMs, endExclusiveMs } = calendarDayBoundsMs(mskYyyymmdd);
  return minutes.filter((row) => row.t >= startMs && row.t < endExclusiveMs);
}

/** 107 slot end timestamps (10:00 .. 18:50 MSK, 5 min). */
export function buildSessionGridEndMs(mskYyyymmdd: string): number[] {
  const start = sessionGridStartMs(mskYyyymmdd);
  const end = sessionGridEndMs(mskYyyymmdd);
  const grid: number[] = [];
  for (let t = start; t <= end; t += ANALYTICS_FIVE_MIN_MS) {
    grid.push(t);
  }
  return grid;
}

/**
 * Pandas resample(5min, label=right, closed=right): minute t maps to bucket end (left, end].
 */
export function bucketEndMsRightClosed(
  minuteEpochMs: number,
  mskYyyymmdd: string
): number | null {
  const gridStart = sessionGridStartMs(mskYyyymmdd);
  const gridEnd = sessionGridEndMs(mskYyyymmdd);
  const origin = gridStart - ANALYTICS_FIVE_MIN_MS;
  if (minuteEpochMs <= origin || minuteEpochMs > gridEnd) {
    return null;
  }
  const offset = minuteEpochMs - origin;
  const slotEnd = Math.ceil(offset / ANALYTICS_FIVE_MIN_MS) * ANALYTICS_FIVE_MIN_MS + origin;
  if (slotEnd < gridStart || slotEnd > gridEnd) {
    return null;
  }
  return slotEnd;
}

function emptyOhlcv(): OhlcvRow {
  return [0, 0, 0, 0, 0];
}

function isBeforeFirstListing(
  mskYyyymmdd: string,
  symbol: string,
  firstListing?: FirstListingMskBySymbol | null
): boolean {
  if (!firstListing) {
    return false;
  }
  const sym = symbol.toUpperCase();
  const first = firstListing[sym] ?? firstListing[symbol];
  if (typeof first !== 'string' || first.length !== 8) {
    return false;
  }
  return mskYyyymmdd < first;
}

function zerosSessionMatrix(): OhlcvRow[] {
  return Array.from({ length: ANALYTICS_BARS_PER_SESSION }, () => emptyOhlcv());
}

function rowHasBucketData(row: OhlcvRow): boolean {
  return (
    Number.isFinite(row[FEAT_IDX.OPEN]) &&
    Number.isFinite(row[FEAT_IDX.HIGH]) &&
    Number.isFinite(row[FEAT_IDX.LOW]) &&
    Number.isFinite(row[FEAT_IDX.CLOSE]) &&
    (row[FEAT_IDX.CLOSE] !== 0 ||
      row[FEAT_IDX.OPEN] !== 0 ||
      row[FEAT_IDX.HIGH] !== 0 ||
      row[FEAT_IDX.LOW] !== 0 ||
      row[FEAT_IDX.VOL] !== 0)
  );
}

function foldMinuteIntoBucket(
  prev: OhlcvRow | null,
  row: MarketPriceBar
): OhlcvRow {
  if (!prev) {
    return [row.o, row.h, row.l, row.c, row.v];
  }
  return [
    prev[FEAT_IDX.OPEN],
    Math.max(prev[FEAT_IDX.HIGH], row.h),
    Math.min(prev[FEAT_IDX.LOW], row.l),
    row.c,
    prev[FEAT_IDX.VOL] + row.v,
  ];
}

function aggregateTickerFiveMin(
  minutes: readonly MarketPriceBar[],
  mskYyyymmdd: string
): Map<number, OhlcvRow> {
  const buckets = new Map<number, OhlcvRow>();
  for (const row of minutes) {
    const end = bucketEndMsRightClosed(row.t, mskYyyymmdd);
    if (end === null) {
      continue;
    }
    const prev = buckets.get(end) ?? null;
    buckets.set(end, foldMinuteIntoBucket(prev, row));
  }
  return buckets;
}

/** pandas DataFrame.ffill().bfill() on OHLCV columns (copy full row, including VOL). */
function pandasForwardBackwardFill(grid: OhlcvRow[]): OhlcvRow[] {
  const missing = (row: OhlcvRow) => !rowHasBucketData(row);
  const out = grid.map((r) => [...r] as OhlcvRow);

  let last: OhlcvRow | null = null;
  for (let i = 0; i < out.length; i++) {
    if (!missing(out[i])) {
      last = out[i];
      continue;
    }
    if (last) {
      out[i] = [...last];
    }
  }

  let next: OhlcvRow | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (!missing(out[i])) {
      next = out[i];
      continue;
    }
    if (next) {
      out[i] = [...next];
    }
  }

  return out.map(
    (row) =>
      [
        Number.isFinite(row[0]) ? row[0] : 0,
        Number.isFinite(row[1]) ? row[1] : 0,
        Number.isFinite(row[2]) ? row[2] : 0,
        Number.isFinite(row[3]) ? row[3] : 0,
        Number.isFinite(row[4]) ? row[4] : 0,
      ] as OhlcvRow
  );
}

/** Single close → flat 107×5 session (prepare_raw empty day / SQLite seed). */
export function lastKnownSessionFromClosePrice(close: number): OhlcvSession {
  const c = Number.isFinite(close) && close > 0 ? close : 0;
  return Array.from({ length: ANALYTICS_BARS_PER_SESSION }, () => [c, c, c, c, 0]);
}

/** Flat day from last known close (prepare_raw empty trading day). */
function fillMissingDayFromLastKnown(lastKnownSession: OhlcvSession | null): OhlcvRow[] {
  if (!lastKnownSession || lastKnownSession.length === 0) {
    return Array.from({ length: ANALYTICS_BARS_PER_SESSION }, () => emptyOhlcv());
  }
  const lastRow = lastKnownSession[lastKnownSession.length - 1];
  const prevClose = lastRow[FEAT_IDX.CLOSE];
  if (!Number.isFinite(prevClose) || prevClose <= 0) {
    return Array.from({ length: ANALYTICS_BARS_PER_SESSION }, () => emptyOhlcv());
  }
  return Array.from({ length: ANALYTICS_BARS_PER_SESSION }, () => [
    prevClose,
    prevClose,
    prevClose,
    prevClose,
    0,
  ]);
}

function scaleSessionVol(matrix: OhlcvRow[]): OhlcvRow[] {
  return matrix.map((row) => {
    const clean: OhlcvRow = [
      Number.isFinite(row[0]) ? row[0] : 0,
      Number.isFinite(row[1]) ? row[1] : 0,
      Number.isFinite(row[2]) ? row[2] : 0,
      Number.isFinite(row[3]) ? row[3] : 0,
      Number.isFinite(row[4]) ? row[4] : 0,
    ];
    clean[FEAT_IDX.VOL] /= ANALYTICS_VOL_SCALE;
    return clean;
  });
}

function tickerSessionMatrix(
  minutes: readonly MarketPriceBar[],
  mskYyyymmdd: string,
  lastKnownSession: OhlcvSession | null,
  symbol: string,
  firstListing?: FirstListingMskBySymbol | null
): { matrix: OhlcvRow[]; lastKnownSession: OhlcvSession | null; hadCalendarDayData: boolean } {
  const gridEnds = buildSessionGridEndMs(mskYyyymmdd);
  if (gridEnds.length !== ANALYTICS_BARS_PER_SESSION) {
    throw new Error(
      `session grid expected ${ANALYTICS_BARS_PER_SESSION} slots, got ${gridEnds.length}`
    );
  }

  if (isBeforeFirstListing(mskYyyymmdd, symbol, firstListing)) {
    return {
      matrix: zerosSessionMatrix(),
      lastKnownSession: null,
      hadCalendarDayData: false,
    };
  }

  const dayMinutes = filterMinutesToCalendarDay(minutes, mskYyyymmdd);
  const scaledMinutes = normalizeAnalyticsMinuteBars(symbol, dayMinutes);

  if (scaledMinutes.length === 0) {
    return {
      matrix: fillMissingDayFromLastKnown(lastKnownSession),
      lastKnownSession,
      hadCalendarDayData: false,
    };
  }

  const buckets = aggregateTickerFiveMin(scaledMinutes, mskYyyymmdd);
  const raw: OhlcvRow[] = gridEnds.map((end) => buckets.get(end) ?? emptyOhlcv());
  const filled = pandasForwardBackwardFill(raw);
  const nextLastKnown = filled.map((row) => [...row] as OhlcvRow);

  return {
    matrix: scaleSessionVol(filled),
    lastKnownSession: nextLastKnown,
    hadCalendarDayData: true,
  };
}

/**
 * Update cross-day last_known state for one trading day (prepare_raw loop body).
 */
export function foldTradingDayIntoLastKnown(
  minuteBySymbol: DayMinuteBundle,
  mskYyyymmdd: string,
  state: LastKnownSessionBySymbol,
  firstListing?: FirstListingMskBySymbol | null
): LastKnownSessionBySymbol {
  const next: LastKnownSessionBySymbol = { ...state };
  for (const ticker of ANALYTICS_MODEL_TICKERS) {
    const sym = ticker.toUpperCase();
    const minutes = minuteBySymbol[sym] ?? minuteBySymbol[ticker] ?? [];
    const { lastKnownSession, hadCalendarDayData } = tickerSessionMatrix(
      minutes,
      mskYyyymmdd,
      next[sym] ?? null,
      sym,
      firstListing
    );
    if (hadCalendarDayData && lastKnownSession) {
      next[sym] = lastKnownSession;
    }
  }
  return next;
}

/**
 * Build (107, 105) tensor for one trading day from minute bundles (SQLite day slice).
 */
export function buildModelDayTensorFromDayBundle(
  minuteBySymbol: DayMinuteBundle,
  mskYyyymmdd: string,
  crossDayLastKnown?: LastKnownSessionBySymbol,
  firstListing?: FirstListingMskBySymbol | null
): ModelDayTensor {
  const lastKnownState: LastKnownSessionBySymbol = {
    ...(crossDayLastKnown ?? {}),
  };
  const tensor: ModelDayTensor = Array.from(
    { length: ANALYTICS_BARS_PER_SESSION },
    () => Array.from({ length: ANALYTICS_FEAT_DIM }, () => 0)
  );

  ANALYTICS_MODEL_TICKERS.forEach((ticker, tickerIdx) => {
    const sym = ticker.toUpperCase();
    const minutes = minuteBySymbol[sym] ?? minuteBySymbol[ticker] ?? [];
    const { matrix } = tickerSessionMatrix(
      minutes,
      mskYyyymmdd,
      lastKnownState[sym] ?? null,
      sym,
      firstListing
    );

    for (let t = 0; t < ANALYTICS_BARS_PER_SESSION; t++) {
      for (const feat of ANALYTICS_FEATURE_NAMES) {
        const fIdx = FEAT_IDX[feat];
        const globalIdx = tickerIdx * ANALYTICS_FEATS_PER_TICKER + fIdx;
        tensor[t][globalIdx] = matrix[t][fIdx];
      }
    }
  });

  return sanitizeModelDayTensorFinite(tensor);
}

/** Missing/non-finite OHLCV → 0 (prepare_raw NaN→0; unlisted tickers stay zero). */
export function sanitizeModelDayTensorFinite(tensor: ModelDayTensor): ModelDayTensor {
  assertModelDayTensorShape(tensor);
  for (let t = 0; t < tensor.length; t++) {
    for (let f = 0; f < tensor[t].length; f++) {
      const v = tensor[t][f];
      tensor[t][f] = Number.isFinite(v) ? v : 0;
    }
  }
  return tensor;
}

export function assertModelDayTensorShape(tensor: ModelDayTensor): void {
  if (tensor.length !== ANALYTICS_BARS_PER_SESSION) {
    throw new Error(`tensor rows expected ${ANALYTICS_BARS_PER_SESSION}, got ${tensor.length}`);
  }
  for (const row of tensor) {
    if (row.length !== ANALYTICS_FEAT_DIM) {
      throw new Error(`tensor cols expected ${ANALYTICS_FEAT_DIM}, got ${row.length}`);
    }
  }
}

/** Reject NaN/Inf before IPC to the model. */
export function assertModelDayTensorFinite(tensor: ModelDayTensor): void {
  assertModelDayTensorShape(tensor);
  for (let t = 0; t < tensor.length; t++) {
    for (let f = 0; f < tensor[t].length; f++) {
      if (!Number.isFinite(tensor[t][f])) {
        throw new Error(`non-finite tensor at slot ${t}, feature ${f}`);
      }
    }
  }
}

/** Model contract: always (107, 105) = 21 tickers × 5 OHLCV before IPC. */
export function assertFullModelInputTensor(tensor: ModelDayTensor): void {
  assertModelDayTensorFinite(tensor);
  if (tensor.length !== ANALYTICS_BARS_PER_SESSION) {
    throw new Error(`expected ${ANALYTICS_BARS_PER_SESSION} rows, got ${tensor.length}`);
  }
  if (tensor[0]?.length !== ANALYTICS_FEAT_DIM) {
    throw new Error(`expected ${ANALYTICS_FEAT_DIM} features, got ${tensor[0]?.length}`);
  }
}
