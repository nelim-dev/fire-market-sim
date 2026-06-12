import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_MODEL_TICKERS,
  type AnalyticsModelTicker,
  analyticsFeatureIndex,
  ANALYTICS_FEATURE_NAMES,
} from './modelConstants';
import {
  assertModelDayTensorShape,
  buildModelDayTensorFromDayBundle,
  type DayMinuteBundle,
  type ModelDayTensor,
} from './modelDayTensor';

export type SymbolParityStats = {
  symbol: string;
  prevClose: { min: number; max: number; mean: number };
  predClose: { min: number; max: number; mean: number };
  realClose: { min: number; max: number; mean: number };
  predVolScaled: { min: number; max: number; mean: number };
  maeClose: number;
  rmseClose: number;
  corrPredCloseVol: number;
  maxAbsCloseDelta: number;
};

export type AnalyticsParityReport = {
  sourceDayMsk: string;
  targetDayMsk: string;
  symbols: string[];
  stats: SymbolParityStats[];
};

function seriesStats(values: number[]): { min: number; max: number; mean: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    return { min: 0, max: 0, mean: 0 };
  }
  values = finite;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  return { min, max, mean: sum / values.length };
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) {
    return NaN;
  }
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : NaN;
}

function extractCloseVolSeries(
  tensor: ModelDayTensor,
  symbol: string
): { close: number[]; volScaled: number[] } {
  const tickerIdx = ANALYTICS_MODEL_TICKERS.indexOf(
    symbol.toUpperCase() as AnalyticsModelTicker
  );
  if (tickerIdx < 0) {
    return { close: [], volScaled: [] };
  }
  const closeIdx = analyticsFeatureIndex(tickerIdx, 'CLOSE');
  const volIdx = analyticsFeatureIndex(tickerIdx, 'VOL');
  const close: number[] = [];
  const volScaled: number[] = [];
  for (let t = 0; t < ANALYTICS_BARS_PER_SESSION && t < tensor.length; t++) {
    close.push(tensor[t][closeIdx]);
    volScaled.push(tensor[t][volIdx]);
  }
  return { close, volScaled };
}

/** Debug: min/max per OHLCV channel for one ticker in a tensor. */
export function formatTickerChannelStats(
  tensor: ModelDayTensor,
  symbol: string,
  label: string
): string {
  const tickerIdx = ANALYTICS_MODEL_TICKERS.indexOf(
    symbol.toUpperCase() as AnalyticsModelTicker
  );
  if (tickerIdx < 0) {
    return `${label} ${symbol}: unknown ticker`;
  }
  const parts: string[] = [];
  for (const feat of ANALYTICS_FEATURE_NAMES) {
    const idx = analyticsFeatureIndex(tickerIdx, feat);
    const vals = tensor.map((row) => row[idx]).filter((v) => Number.isFinite(v));
    if (vals.length === 0) {
      parts.push(`${feat}=empty`);
      continue;
    }
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    parts.push(`${feat}=[${min.toFixed(3)},${max.toFixed(3)}]`);
  }
  return `${label} ${symbol}: ${parts.join(' ')}`;
}

function maeRmse(pred: number[], real: number[]): { mae: number; rmse: number; maxAbs: number } {
  const n = Math.min(pred.length, real.length);
  if (n === 0) {
    return { mae: NaN, rmse: NaN, maxAbs: NaN };
  }
  let sumAbs = 0;
  let sumSq = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const d = pred[i] - real[i];
    const abs = Math.abs(d);
    sumAbs += abs;
    sumSq += d * d;
    maxAbs = Math.max(maxAbs, abs);
  }
  return {
    mae: sumAbs / n,
    rmse: Math.sqrt(sumSq / n),
    maxAbs,
  };
}

export function buildParityStatsForSymbol(
  symbol: string,
  prevTensor: ModelDayTensor,
  predTensor: ModelDayTensor,
  realTensor: ModelDayTensor
): SymbolParityStats {
  const prev = extractCloseVolSeries(prevTensor, symbol);
  const pred = extractCloseVolSeries(predTensor, symbol);
  const real = extractCloseVolSeries(realTensor, symbol);
  const { mae, rmse, maxAbs } = maeRmse(pred.close, real.close);

  return {
    symbol: symbol.toUpperCase(),
    prevClose: seriesStats(prev.close),
    predClose: seriesStats(pred.close),
    realClose: seriesStats(real.close),
    predVolScaled: seriesStats(pred.volScaled),
    maeClose: mae,
    rmseClose: rmse,
    corrPredCloseVol: pearson(pred.close, pred.volScaled),
    maxAbsCloseDelta: maxAbs,
  };
}

export function buildAnalyticsParityReport(
  sourceDayMsk: string,
  targetDayMsk: string,
  prevTensor: ModelDayTensor,
  predTensor: ModelDayTensor,
  realTensor: ModelDayTensor,
  symbols: readonly string[] = ANALYTICS_MODEL_TICKERS
): AnalyticsParityReport {
  assertModelDayTensorShape(prevTensor);
  assertModelDayTensorShape(predTensor);
  assertModelDayTensorShape(realTensor);

  const stats = symbols.map((sym) =>
    buildParityStatsForSymbol(sym, prevTensor, predTensor, realTensor)
  );

  return {
    sourceDayMsk,
    targetDayMsk,
    symbols: symbols.map((s) => s.toUpperCase()),
    stats,
  };
}

export function minuteBundleFromSlicePayload(
  minuteBySymbol: Record<string, unknown>
): DayMinuteBundle {
  const out: DayMinuteBundle = {};
  for (const [k, v] of Object.entries(minuteBySymbol)) {
    out[k.toUpperCase()] = (v ?? []) as DayMinuteBundle[string];
  }
  return out;
}

export function formatParityReportTable(report: AnalyticsParityReport): string {
  const lines: string[] = [
    `Parity: ${report.sourceDayMsk} → predict ${report.targetDayMsk} (integrated pipeline)`,
    '',
    'symbol | prev close      | pred close      | real close      | MAE   | RMSE  | max|Δ| | corr(pred C,VOL)',
  ];

  for (const s of report.stats) {
    const fmt = (x: { min: number; max: number; mean: number }) =>
      `[${x.min.toFixed(2)}, ${x.max.toFixed(2)}] μ=${x.mean.toFixed(2)}`;
    lines.push(
      `${s.symbol.padEnd(6)} | ${fmt(s.prevClose).padEnd(15)} | ${fmt(s.predClose).padEnd(15)} | ${fmt(s.realClose).padEnd(15)} | ${s.maeClose.toFixed(3).padStart(5)} | ${s.rmseClose.toFixed(3).padStart(5)} | ${s.maxAbsCloseDelta.toFixed(3).padStart(6)} | ${s.corrPredCloseVol.toFixed(4)}`
    );
  }

  return lines.join('\n');
}

export type ParityPlotPayload = {
  sourceDayMsk: string;
  targetDayMsk: string;
  tickers: string[];
  /** Per ticker: 107 close values */
  prevCloseByTicker: Record<string, number[]>;
  predCloseByTicker: Record<string, number[]>;
  realCloseByTicker: Record<string, number[]>;
  predVolByTicker: Record<string, number[]>;
};

export function buildParityPlotPayload(
  report: AnalyticsParityReport,
  prevTensor: ModelDayTensor,
  predTensor: ModelDayTensor,
  realTensor: ModelDayTensor,
  plotSymbols: readonly string[]
): ParityPlotPayload {
  const prevCloseByTicker: Record<string, number[]> = {};
  const predCloseByTicker: Record<string, number[]> = {};
  const realCloseByTicker: Record<string, number[]> = {};
  const predVolByTicker: Record<string, number[]> = {};

  for (const sym of plotSymbols) {
    const prev = extractCloseVolSeries(prevTensor, sym);
    const pred = extractCloseVolSeries(predTensor, sym);
    const real = extractCloseVolSeries(realTensor, sym);
    prevCloseByTicker[sym.toUpperCase()] = prev.close;
    predCloseByTicker[sym.toUpperCase()] = pred.close;
    realCloseByTicker[sym.toUpperCase()] = real.close;
    predVolByTicker[sym.toUpperCase()] = pred.volScaled;
  }

  return {
    sourceDayMsk: report.sourceDayMsk,
    targetDayMsk: report.targetDayMsk,
    tickers: plotSymbols.map((s) => s.toUpperCase()),
    prevCloseByTicker,
    predCloseByTicker,
    realCloseByTicker,
    predVolByTicker,
  };
}
