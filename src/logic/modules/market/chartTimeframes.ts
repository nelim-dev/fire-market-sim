/** Горизонты графика карточки инструмента (план M3, шаг 6). */
export type ChartTimeframeId =
  | '1d'
  | '1w'
  | '1m'
  | '6m'
  | '1y'
  | 'all';

export const CHART_TIMEFRAME_IDS: readonly ChartTimeframeId[] = [
  '1d',
  '1w',
  '1m',
  '6m',
  '1y',
  'all',
] as const;

/**
 * Минимальный размер окна по числу свечей.
 * Используется как floor поверх time-range, чтобы график не «схлопывался»
 * на выходных/праздниках и при редких пропусках данных.
 */
export const CHART_DAY_MIN_1M_BAR_COUNT = 540;
export const CHART_WEEK_MIN_5M_BAR_COUNT = 360;
export const CHART_MONTH_MIN_30M_BAR_COUNT = 160;
export const CHART_6M_MIN_1H_BAR_COUNT = 900;
export const CHART_YEAR_MIN_DAILY_BAR_COUNT = 220;
export const CHART_ALL_MIN_DAILY_BAR_COUNT = 400;
