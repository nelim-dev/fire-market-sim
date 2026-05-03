import { formatSimulationDateTime } from '@/logic/utils/formatSimulationClock';

/**
 * Строка даты/времени симуляции для header (МСК, ru-RU).
 */
export function formatSimulationTime(
  epochMs: number,
  _locale: 'ru-RU' = 'ru-RU'
): string {
  return formatSimulationDateTime(epochMs);
}
