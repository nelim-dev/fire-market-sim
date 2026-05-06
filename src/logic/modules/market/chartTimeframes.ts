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
 * Скользящие окна по числу свечей на графике (новая свеча вытесняет самую старую в окне).
 */
/** ~1 торговая сессия минутных точек */
export const CHART_DAY_SLIDING_1M_BAR_COUNT = 540;
/** ~9 торговых сессий × ~60 пятиминуток */
export const CHART_WEEK_SLIDING_5M_BAR_COUNT = 540;
/** ~30 кал. дней × несколько 30m на день */
export const CHART_MONTH_SLIDING_30M_BAR_COUNT = 200;
/**
 * ~180 кал. дней торгов: ~130 сессий × до ~9 часовых «ячеек» в сессию — иначе
 * хвост 360 баров даёт лишь ~3 месяца видимой истории.
 */
export const CHART_6M_SLIDING_1H_BAR_COUNT = 1200;
export const CHART_YEAR_SLIDING_DAILY_BAR_COUNT = 252;
export const CHART_ALL_SLIDING_WEEKLY_BAR_COUNT = 400;
