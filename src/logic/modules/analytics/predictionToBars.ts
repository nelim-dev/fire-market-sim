import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';
import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_FEATS_PER_TICKER,
  ANALYTICS_FEATURE_NAMES,
  ANALYTICS_FIVE_MIN_MS,
  ANALYTICS_MODEL_TICKERS,
  ANALYTICS_VOL_SCALE,
  analyticsFeatureIndex,
} from './modelConstants';
import type { ModelDayTensor } from './modelDayTensor';
import { buildSessionGridEndMs } from './modelDayTensor';

const MINUTE_MS = 60_000;

/** Chart point: only session close price (never volume). */
export type CloseChartPoint = {
  readonly t: number;
  readonly close: number;
};

/** Extract CLOSE feature from model tensor for chart (no VOL, no scaling). */
export function tensorToCloseChartPointsForSymbol(
  tensor: ModelDayTensor,
  symbol: string,
  mskYyyymmdd: string
): CloseChartPoint[] {
  const gridEnds = buildSessionGridEndMs(mskYyyymmdd);
  const fiveMin = tensorToFiveMinuteBarsForSymbol(tensor, symbol, mskYyyymmdd);
  return fiveMin.map((bar, i) => ({
    t: gridEnds[i] ?? bar.t,
    close: bar.c,
  }));
}

export function tensorToCloseChartPointsBySymbol(
  tensor: ModelDayTensor,
  mskYyyymmdd: string
): Record<string, CloseChartPoint[]> {
  const out: Record<string, CloseChartPoint[]> = {};
  for (const sym of ANALYTICS_MODEL_TICKERS) {
    out[sym] = tensorToCloseChartPointsForSymbol(tensor, sym, mskYyyymmdd);
  }
  return out;
}

/** Forward-fill CLOSE slot per ticker so chart has 107 aligned timesteps. */
function ffillTickerCloseSeries(tensor: ModelDayTensor, tickerIdx: number): number[] {
  const closeIdx = analyticsFeatureIndex(tickerIdx, 'CLOSE');
  const out: number[] = [];
  let last = NaN;
  for (let t = 0; t < ANALYTICS_BARS_PER_SESSION && t < tensor.length; t++) {
    const raw = tensor[t][closeIdx];
    if (Number.isFinite(raw) && raw > 0) {
      last = raw;
      out.push(raw);
      continue;
    }
    out.push(Number.isFinite(last) ? last : NaN);
  }
  const first = out.find((v) => Number.isFinite(v) && v > 0);
  return out.map((v) => (Number.isFinite(v) && v > 0 ? v : (first ?? 0)));
}

/**
 * Denormalize model output tensor and extract 5m OHLCV bars for one ticker.
 */
export function tensorToFiveMinuteBarsForSymbol(
  tensor: ModelDayTensor,
  symbol: string,
  mskYyyymmdd: string
): MarketPriceBar[] {
  const tickerIdx = ANALYTICS_MODEL_TICKERS.indexOf(
    symbol.toUpperCase() as (typeof ANALYTICS_MODEL_TICKERS)[number]
  );
  if (tickerIdx < 0) {
    return [];
  }

  const gridEnds = buildSessionGridEndMs(mskYyyymmdd);
  const filledClose = ffillTickerCloseSeries(tensor, tickerIdx);
  const bars: MarketPriceBar[] = [];

  for (let t = 0; t < ANALYTICS_BARS_PER_SESSION && t < tensor.length; t++) {
    const row = tensor[t];
    const oIdx = analyticsFeatureIndex(tickerIdx, 'OPEN');
    const hIdx = analyticsFeatureIndex(tickerIdx, 'HIGH');
    const lIdx = analyticsFeatureIndex(tickerIdx, 'LOW');
    const vIdx = analyticsFeatureIndex(tickerIdx, 'VOL');

    const close = filledClose[t] ?? 0;
    const open = row[oIdx] > 0 ? row[oIdx] : close;
    const high = row[hIdx] > 0 ? Math.max(row[hIdx], close) : close;
    const low = row[lIdx] > 0 ? Math.min(row[lIdx], close) : close;
    const volRaw = Math.max(0, row[vIdx] * ANALYTICS_VOL_SCALE);
    bars.push({
      t: gridEnds[t] ?? gridEnds[gridEnds.length - 1],
      o: open,
      h: high,
      l: low,
      c: close,
      v: volRaw,
    });
  }

  return bars;
}

/** 1m close line for portfolio-style chart (from 5m tensor day). */
export function minuteCloseChartPointsFromTensor(
  tensor: ModelDayTensor,
  symbol: string,
  mskYyyymmdd: string
): MarketPriceBar[] {
  return fiveMinuteBarsToMinuteChartPoints(
    tensorToFiveMinuteBarsForSymbol(tensor, symbol, mskYyyymmdd)
  );
}

/**
 * Expand 5m bars to 1m chart points: hold previous close when no minute exists.
 */
export function fiveMinuteBarsToMinuteChartPoints(
  fiveMinBars: readonly MarketPriceBar[]
): MarketPriceBar[] {
  if (fiveMinBars.length === 0) {
    return [];
  }

  const out: MarketPriceBar[] = [];
  let prevClose = fiveMinBars[0].o;

  for (let i = 0; i < fiveMinBars.length; i++) {
    const bar = fiveMinBars[i];
    const nextEnd =
      i + 1 < fiveMinBars.length
        ? fiveMinBars[i + 1].t
        : bar.t + ANALYTICS_FIVE_MIN_MS;
    for (let t = bar.t - ANALYTICS_FIVE_MIN_MS + MINUTE_MS; t <= bar.t; t += MINUTE_MS) {
      if (t > nextEnd - MINUTE_MS && i + 1 < fiveMinBars.length) {
        break;
      }
      const c = bar.c;
      out.push({
        t,
        o: t === bar.t - ANALYTICS_FIVE_MIN_MS + MINUTE_MS ? bar.o : prevClose,
        h: Math.max(bar.h, prevClose),
        l: Math.min(bar.l, prevClose),
        c,
        v: bar.v / 5,
      });
      prevClose = c;
    }
  }

  return out;
}

/** All 21 tickers from prediction tensor. */
export function tensorToFiveMinuteBarsBySymbol(
  tensor: ModelDayTensor,
  mskYyyymmdd: string
): Record<string, MarketPriceBar[]> {
  const out: Record<string, MarketPriceBar[]> = {};
  for (const sym of ANALYTICS_MODEL_TICKERS) {
    out[sym] = tensorToFiveMinuteBarsForSymbol(tensor, sym, mskYyyymmdd);
  }
  return out;
}
