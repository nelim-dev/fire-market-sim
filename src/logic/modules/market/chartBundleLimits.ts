const DAY_MS = 86_400_000;

/**
 * Сколько миллисекунд ДО `sessionStart` первого дня календаря симуляции включаем в
 * `marketChartSlices.json`, чтобы хватило дневного ряда для таймфрейма «Год» (~365 дн.)
 * и прочих lookback без чтения всего сырого файла.
 */
export const CHART_BUNDLE_PRE_SESSION_MS = 370 * DAY_MS;

/** Запас после последней сессии (полуночь/хвост сессии). */
export const CHART_BUNDLE_POST_LAST_SESSION_MS = 1 * DAY_MS;
