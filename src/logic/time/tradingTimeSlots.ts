import type { TradingCalendar } from './TradingCalendar';

/**
 * Утилиты «торгового времени»: построение сетки слотов, идущей назад
 * по торговому календарю с учётом ночей/выходных. Используются
 * chart-провайдером MarketModule, чтобы окно графика соответствовало
 * фактическому времени торгов (а не календарным 24h × N).
 *
 * Семантика:
 *  - Intraday-слоты: фиксированный шаг `stepMs`, шагаем назад внутри
 *    одной торговой сессии; при выходе за `sessionStart` «переток»
 *    переносится на предыдущую сессию (от её `sessionEnd`).
 *  - Daily-слоты: один слот = `sessionEndEpochMs` торговой сессии,
 *    идём `count` сессий назад.
 *
 * Возврат всегда отсортирован по возрастанию `t` (старые в начале).
 */

/**
 * Бинарным поиском найти индекс торговой сессии, в которой находится `anchor`.
 * Если `anchor` попадает в «ночь/выходной» между сессиями — вернёт индекс
 * последней сессии с `sessionStartEpochMs <= anchor`. Если `anchor` до первой
 * сессии — вернёт -1.
 */
export function findSessionIndexForEpoch(
  calendar: TradingCalendar,
  anchorEpochMs: number
): number {
  let lo = 0;
  let hi = calendar.dayCount - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = calendar.getDay(mid);
    if (!s) break;
    if (s.sessionStartEpochMs <= anchorEpochMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Бинарным поиском найти индекс первой торговой сессии, у которой
 * `sessionEndEpochMs >= epochMs`. Полезно для случаев, когда `epochMs`
 * указан как «дата без времени» (например, 00:00 MSK даты закрытия
 * реестра): тогда выходной → берём следующий торговый день, а
 * `epochMs` внутри/после сессии → берём её саму. Если кандидата нет
 * (все сессии раньше `epochMs`) — возвращает -1.
 */
export function findSessionIndexAtOrAfterEpoch(
  calendar: TradingCalendar,
  epochMs: number
): number {
  let lo = 0;
  let hi = calendar.dayCount - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = calendar.getDay(mid);
    if (!s) break;
    if (s.sessionEndEpochMs >= epochMs) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

/**
 * Построить `count` слотов с шагом `stepMs` в торговом времени, идя назад
 * от `anchorEpochMs`. Слоты возвращаются в порядке возрастания `t`.
 *
 * Поведение на стыках:
 *  - Если `anchor` за пределами сессии (после конца) — стартуем с `sessionEnd`.
 *  - Если `anchor` до начала сессии — отступаем к предыдущей.
 *  - При выходе за `sessionStart` остаток шага переносится в предыдущую сессию.
 *  - Если истории не хватает — возвращаем меньше чем `count` слотов.
 */
export function buildBackwardIntradaySlots(
  calendar: TradingCalendar,
  anchorEpochMs: number,
  stepMs: number,
  count: number
): number[] {
  if (count <= 0 || stepMs <= 0 || calendar.dayCount === 0) return [];
  let dayIdx = findSessionIndexForEpoch(calendar, anchorEpochMs);
  if (dayIdx < 0) return [];
  let session = calendar.getDay(dayIdx)!;
  let t = Math.min(anchorEpochMs, session.sessionEndEpochMs);
  if (t < session.sessionStartEpochMs) {
    dayIdx -= 1;
    if (dayIdx < 0) return [];
    session = calendar.getDay(dayIdx)!;
    t = session.sessionEndEpochMs;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(t);
    const nextT = t - stepMs;
    if (nextT >= session.sessionStartEpochMs) {
      t = nextT;
      continue;
    }
    const overshoot = session.sessionStartEpochMs - nextT;
    dayIdx -= 1;
    if (dayIdx < 0) break;
    session = calendar.getDay(dayIdx)!;
    t = session.sessionEndEpochMs - overshoot;
    if (t < session.sessionStartEpochMs) {
      t = session.sessionStartEpochMs;
    }
  }
  return out.reverse();
}

/**
 * Построить `count` дневных слотов: по одному на каждую торговую сессию.
 * `t` слота = `sessionEndEpochMs` сессии. Идём назад от сессии, содержащей
 * `anchorEpochMs` (если `anchor` внутри/после сессии — она включена;
 * если до её начала — берём предыдущую).
 */
export function buildBackwardDailySlots(
  calendar: TradingCalendar,
  anchorEpochMs: number,
  count: number
): number[] {
  if (count <= 0 || calendar.dayCount === 0) return [];
  let dayIdx = findSessionIndexForEpoch(calendar, anchorEpochMs);
  if (dayIdx < 0) return [];
  const out: number[] = [];
  for (let i = 0; i < count && dayIdx >= 0; i++) {
    const s = calendar.getDay(dayIdx);
    if (!s) break;
    out.push(s.sessionEndEpochMs);
    dayIdx -= 1;
  }
  return out.reverse();
}
