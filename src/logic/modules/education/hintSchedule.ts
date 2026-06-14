/** Видимость toast на графике. */
export const HINT_VISIBLE_MS = 10_000;

/** Задержка показа после возвращения на вкладку «График», если подсказка созрела в фоне. */
export const HINT_CHART_RETURN_DELAY_MS = 10_000;

export const HINT_MIN_INTERVAL_MS = 180_000;
export const HINT_MAX_INTERVAL_MS = 360_000;

export function randomHintIntervalMs(): number {
  return (
    HINT_MIN_INTERVAL_MS +
    Math.random() * (HINT_MAX_INTERVAL_MS - HINT_MIN_INTERVAL_MS)
  );
}
