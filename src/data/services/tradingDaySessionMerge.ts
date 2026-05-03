import {
  capLastBarToSessionMs,
  clampSimulationStartMs,
} from '../tickerSessionBounds';

/**
 * Слой данных — правило объединения минутных рядов по тикерам в одну «сессию дня».
 * Старт: max(10:00 МСК, min первых баров по тикерам в этот день).
 * Конец: min(18:50 МСК, max последних баров по тикерам в этот день).
 */
export function computeSessionWindowForDay(
  perTickerMinMax: ReadonlyMap<string, { minMs: number; maxMs: number }>
): {
  sessionStartEpochMs: number;
  sessionEndEpochMs: number;
  tickersWithData: string[];
} | null {
  if (perTickerMinMax.size === 0) return null;
  let minFirst = Infinity;
  let maxLast = -Infinity;
  for (const { minMs, maxMs } of perTickerMinMax.values()) {
    minFirst = Math.min(minFirst, minMs);
    maxLast = Math.max(maxLast, maxMs);
  }
  const sessionStartEpochMs = clampSimulationStartMs(minFirst);
  const sessionEndEpochMs = capLastBarToSessionMs(maxLast);
  if (sessionEndEpochMs < sessionStartEpochMs) return null;
  const tickersWithData = [...perTickerMinMax.keys()].sort();
  return { sessionStartEpochMs, sessionEndEpochMs, tickersWithData };
}
