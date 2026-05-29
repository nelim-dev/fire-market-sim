import type { OrderBookLevel, OrderBookSnapshot } from './contracts';

/** Быстрое сравнение стаканов без JSON.stringify. */
export function orderBookSignature(book: OrderBookSnapshot): string {
  const bidLots = book.bids.reduce((s, l) => s + l.qty, 0);
  const askLots = book.asks.reduce((s, l) => s + l.qty, 0);
  const bestBid = book.bids[0]?.priceRub ?? 0;
  const bestAsk = book.asks[0]?.priceRub ?? 0;
  return `${book.bids.length}:${book.asks.length}:${bidLots}:${askLots}:${bestBid}:${bestAsk}`;
}

const LEVELS_PER_SIDE = 5;
const BASE_WEIGHTS = [5, 10, 15, 20, 20];
const MIN_TOTAL_LOTS = 200;
const MIN_LOTS_PER_LEVEL = 15;
const MAX_TOTAL_LOTS = 500_000;
/** Нижняя граница «минутного» объёма (~200–600 лотов в стакане при lot=1). */
const MINUTE_VOLUME_FLOOR = 480;
const MINUTE_MS = 60_000;
const GAP_MS_FOR_INSTANT_SMOOTH = 4 * 60 * 60 * 1000;
/** Поминутное изменение суммарной ликвидности стакана (доля от prev). */
const MIN_LOTS_STEP_PCT = 0.001;
const MAX_LOTS_STEP_PCT = 0.15;
/** Максимальный отступ крайнего уровня от mid (1%). */
const MAX_SPREAD_PCT = 0.01;

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unitNoise(seed: string, levelIndex: number): number {
  const h = hashSeed(`${seed}:${levelIndex}`);
  return 0.95 + (h % 1000) / 10_000;
}

/** 0.88–1.12 — вариация нижней границы минутного объёма. */
function volumeNoise(seed: string): number {
  const h = hashSeed(seed);
  return 0.88 + (h % 240) / 1_000;
}

function sumSideLots(levels: readonly OrderBookLevel[]): number {
  return levels.reduce((sum, level) => sum + Math.max(0, level.qty), 0);
}

/** Целевой суммарный объём лотов из минутного volume (без скачков от prev). */
function computeVolumeTargetLots(
  symbol: string,
  minuteVolume: number,
  lotSize: number,
  minuteBucket: number
): number {
  const safeLot = Math.max(1, lotSize);
  const effectiveVolume = Math.max(
    minuteVolume,
    MINUTE_VOLUME_FLOOR * volumeNoise(`${symbol.toUpperCase()}:${minuteBucket}:vf`)
  );
  const rawLots = Math.round(effectiveVolume / safeLot);
  return Math.min(
    MAX_TOTAL_LOTS,
    Math.max(MIN_TOTAL_LOTS, rawLots > 0 ? rawLots : MIN_TOTAL_LOTS)
  );
}

/**
 * Плавный шаг суммарной ликвидности к целевому объёму: 0.1%…15% от prev за минуту.
 * Пример: prev=1000, target=11000 → +15% → 1150 (не скачок до 11000).
 */
export function evolveTotalLotsByMinuteStep(
  prevTotal: number,
  targetTotal: number,
  symbol: string,
  minuteBucket: number
): number {
  if (prevTotal <= 0 || !Number.isFinite(prevTotal)) {
    return targetTotal;
  }
  const ratio = targetTotal / prevTotal;
  let stepPct: number;
  if (Math.abs(ratio - 1) < 1e-9) {
    stepPct = 0;
  } else if (Math.abs(ratio - 1) < MIN_LOTS_STEP_PCT) {
    const h = hashSeed(`${symbol.toUpperCase()}:${minuteBucket}:step`);
    stepPct = (h % 2 === 0 ? 1 : -1) * MIN_LOTS_STEP_PCT;
  } else {
    stepPct =
      Math.sign(ratio - 1) *
      Math.min(MAX_LOTS_STEP_PCT, Math.max(MIN_LOTS_STEP_PCT, Math.abs(ratio - 1)));
  }
  const next = Math.round(prevTotal * (1 + stepPct));
  return Math.min(MAX_TOTAL_LOTS, Math.max(MIN_TOTAL_LOTS, next));
}

export function tickSizeRub(priceRub: number): number {
  if (!Number.isFinite(priceRub) || priceRub <= 0) {
    return 0.01;
  }
  if (priceRub < 10) {
    return 0.01;
  }
  if (priceRub < 1_000) {
    return 0.05;
  }
  return 1;
}

function normalizeWeights(symbol: string, minuteBucket: number): number[] {
  const seed = `${symbol}:${minuteBucket}`;
  const raw = BASE_WEIGHTS.map((w, i) => w * unitNoise(seed, i));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function smoothAlpha(prevEpochMs: number | undefined, nextEpochMs: number): number {
  if (prevEpochMs == null) {
    return 1;
  }
  const delta = nextEpochMs - prevEpochMs;
  if (delta >= GAP_MS_FOR_INSTANT_SMOOTH) {
    return 1;
  }
  if (delta <= 0) {
    return 0;
  }
  return Math.min(1, delta / MINUTE_MS) * 0.35;
}

function distributeLots(totalLots: number, weights: number[]): number[] {
  const floors = weights.map((w) => Math.floor(totalLots * w));
  let assigned = floors.reduce((a, b) => a + b, 0);
  let remainder = Math.max(0, totalLots - assigned);
  const out = [...floors];
  let idx = 0;
  while (remainder > 0) {
    out[idx % out.length] += 1;
    remainder -= 1;
    idx += 1;
  }
  return out;
}

function roundOrderBookPrice(priceRub: number, midPriceRub: number): number {
  const decimals =
    midPriceRub >= 10_000 ? 0 : midPriceRub >= 1_000 ? 1 : midPriceRub >= 100 ? 2 : 4;
  const k = 10 ** decimals;
  return Math.round(priceRub * k) / k;
}

function buildSideLevels(
  midPriceRub: number,
  side: 'bid' | 'ask',
  lotDistribution: number[],
  symbol: string,
  minuteBucket: number
): OrderBookLevel[] {
  const levels: OrderBookLevel[] = [];
  for (let i = 0; i < LEVELS_PER_SIDE; i += 1) {
    const baseFrac = ((i + 1) / LEVELS_PER_SIDE) * MAX_SPREAD_PCT;
    const micro =
      (unitNoise(`${symbol}:${minuteBucket}:${side}:${i}`, 0) - 1) * 0.00015;
    const frac = Math.min(MAX_SPREAD_PCT, Math.max(0.0001, baseFrac + micro));
    const raw =
      side === 'bid' ? midPriceRub * (1 - frac) : midPriceRub * (1 + frac);
    const priceRub = roundOrderBookPrice(raw, midPriceRub);
    const qty = lotDistribution[i] ?? 0;
    if (qty > 0 && Number.isFinite(priceRub) && priceRub > 0) {
      levels.push({ priceRub, qty });
    }
  }
  return side === 'bid'
    ? levels.sort((a, b) => b.priceRub - a.priceRub)
    : levels.sort((a, b) => a.priceRub - b.priceRub);
}

function smoothLevels(
  target: OrderBookLevel[],
  prev: OrderBookLevel[] | undefined,
  alpha: number
): OrderBookLevel[] {
  if (!prev || prev.length === 0 || alpha >= 1) {
    return target;
  }
  return target.map((level, i) => {
    const prevQty = prev[i]?.qty ?? level.qty;
    const blended = Math.round(lerp(prevQty, level.qty, alpha <= 0 ? 1 : alpha));
    return {
      priceRub: level.priceRub,
      qty: Math.max(MIN_LOTS_PER_LEVEL, blended),
    };
  });
}

export function resolveBaseVolume(
  minuteBars: readonly { t: number; v: number }[],
  simulationEpochMs: number
): number {
  let lastV = 0;
  for (let i = minuteBars.length - 1; i >= 0; i -= 1) {
    const bar = minuteBars[i];
    if (bar.t > simulationEpochMs) {
      continue;
    }
    if (bar.v > 0) {
      lastV = bar.v;
      break;
    }
    lastV = bar.v;
  }
  if (lastV > 0) {
    return lastV;
  }
  let sum = 0;
  let count = 0;
  for (let i = minuteBars.length - 1; i >= 0 && count < 10; i -= 1) {
    const bar = minuteBars[i];
    if (bar.t > simulationEpochMs) {
      continue;
    }
    sum += bar.v;
    count += 1;
  }
  if (count > 0 && sum > 0) {
    return sum / count;
  }
  return 1_000;
}

export function buildPseudoOrderBook(params: {
  symbol: string;
  midPriceRub: number;
  lotSize: number;
  minuteVolume: number;
  simulationEpochMs: number;
  prevBook?: OrderBookSnapshot;
  prevEpochMs?: number;
}): OrderBookSnapshot {
  const {
    symbol,
    midPriceRub,
    lotSize,
    minuteVolume,
    simulationEpochMs,
    prevBook,
    prevEpochMs,
  } = params;
  if (!Number.isFinite(midPriceRub) || midPriceRub <= 0) {
    return { bids: [], asks: [] };
  }
  const safeLot = Math.max(1, lotSize);
  const minuteBucket = Math.floor(simulationEpochMs / MINUTE_MS);
  const symUpper = symbol.toUpperCase();
  const volumeTargetLots = computeVolumeTargetLots(
    symUpper,
    minuteVolume,
    safeLot,
    minuteBucket
  );
  const alpha = smoothAlpha(prevEpochMs, simulationEpochMs);
  const prevTotal =
    prevBook && (prevBook.asks.length > 0 || prevBook.bids.length > 0)
      ? Math.max(sumSideLots(prevBook.asks), sumSideLots(prevBook.bids))
      : 0;
  const prevMinuteBucket =
    prevEpochMs != null ? Math.floor(prevEpochMs / MINUTE_MS) : -1;
  /** Второй rebuild в ту же минуту (двойной applyQuotes) не должен снова делать ±15%. */
  const sameMinuteBucket = prevMinuteBucket === minuteBucket && prevTotal > 0;
  const instantJump = alpha >= 1 || prevTotal <= 0;
  const totalLots = instantJump
    ? volumeTargetLots
    : sameMinuteBucket
      ? prevTotal
      : evolveTotalLotsByMinuteStep(prevTotal, volumeTargetLots, symUpper, minuteBucket);
  const weights = normalizeWeights(symUpper, minuteBucket);
  const bidLots = distributeLots(totalLots, weights);
  const askLots = distributeLots(totalLots, weights);
  const targetBids = buildSideLevels(
    midPriceRub,
    'bid',
    bidLots,
    symUpper,
    minuteBucket
  );
  const targetAsks = buildSideLevels(
    midPriceRub,
    'ask',
    askLots,
    symUpper,
    minuteBucket
  );
  return {
    bids: smoothLevels(targetBids, prevBook?.bids, alpha),
    asks: smoothLevels(targetAsks, prevBook?.asks, alpha),
  };
}
