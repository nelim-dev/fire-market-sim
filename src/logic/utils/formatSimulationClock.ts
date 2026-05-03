/**
 * Игровое время для UI — календарь биржи (Europe/Moscow), как в ТЗ: ДД.ММ.ГГГГ, ЧЧ:ММ.
 */
export function formatSimulationDateTime(epochMs: number): string {
  if (!epochMs) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

/** Только дата (для компактного блока в header). */
export function formatSimulationDateOnly(epochMs: number): string {
  if (!epochMs) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(epochMs));
}

/** Только время (для компактного блока в header). */
export function formatSimulationTimeOnly(epochMs: number): string {
  if (!epochMs) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}
