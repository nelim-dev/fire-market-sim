/** Fixed ticker order for ConditionalTimeVAE (must match training). */
export const ANALYTICS_STOCK_TICKERS = [
  'GAZP',
  'LKOH',
  'ROSN',
  'NVTK',
  'TATN',
  'SBER',
  'VTBR',
  'MOEX',
  'CHMF',
  'NLMK',
  'GMKN',
  'MGNT',
  'MTSS',
  'YDEX',
  'RUAL',
  'PLZL',
  'AFLT',
  'HYDR',
  'IRAO',
] as const;

export const ANALYTICS_MACRO_TICKERS = ['BR', 'EU'] as const;

export const ANALYTICS_MODEL_TICKERS = [
  ...ANALYTICS_STOCK_TICKERS,
  ...ANALYTICS_MACRO_TICKERS,
] as const;

export type AnalyticsModelTicker = (typeof ANALYTICS_MODEL_TICKERS)[number];

export const ANALYTICS_FEATURE_NAMES = [
  'OPEN',
  'HIGH',
  'LOW',
  'CLOSE',
  'VOL',
] as const;

export type AnalyticsFeatureName = (typeof ANALYTICS_FEATURE_NAMES)[number];

export const ANALYTICS_BARS_PER_SESSION = 107;
export const ANALYTICS_FEATS_PER_TICKER = 5;
export const ANALYTICS_FEAT_DIM =
  ANALYTICS_MODEL_TICKERS.length * ANALYTICS_FEATS_PER_TICKER;
export const ANALYTICS_VOL_SCALE = 10_000;
export const ANALYTICS_FIVE_MIN_MS = 5 * 60 * 1000;

/**
 * ÷100 when .txt stores rub+kopecks as integer without decimal point.
 * EU: npz already uses 70455-style integers — never scale.
 * VTBR: integer-only session OHLC → always ÷100 (e.g. 8704 → 87.04, 4673 → 46.73).
 */
export const ANALYTICS_OHLC_KOPECK_SCALE_SYMBOLS = ['VTBR'] as const;
/** Max trading days to walk when building cross-day last_known (runtime). */
export const ANALYTICS_LAST_KNOWN_LOOKBACK_DAYS = 50;

export const ANALYTICS_MODEL_ID = 'mosbirzha_5min_v2_V10000_cond_v2';

/** Списание за один запрос ML-прогноза во вкладке «Аналитика». */
export const ANALYTICS_PREDICT_FEE_RUB = 100;

export function analyticsFeatureIndex(
  tickerIdx: number,
  feat: AnalyticsFeatureName
): number {
  return tickerIdx * ANALYTICS_FEATS_PER_TICKER + ANALYTICS_FEATURE_NAMES.indexOf(feat);
}

export function analyticsTickerIndex(symbol: string): number {
  const upper = symbol.toUpperCase();
  const idx = ANALYTICS_MODEL_TICKERS.indexOf(upper as AnalyticsModelTicker);
  return idx;
}
