/**
 * Сабсервис corporateActions / правило биржевого settlement-цикла.
 *
 * Биржа определяет «попал ли держатель в реестр» по дате закрытия реестра
 * (`registryclosedate`) и settlement-режиму на момент сделки:
 *
 *   recordClose < 02.09.2013 MSK      → T+0  (последняя купля прямо в день
 *                                              отсечки засчитывается → N=0)
 *   02.09.2013 ≤ recordClose < 31.07.2023 MSK → T+2 (last day to buy = T-2 раб. дня)
 *   recordClose ≥ 31.07.2023 MSK      → T+1  (last day to buy = T-1 раб. день)
 *
 * Соответственно «cut-off для участия в реестре» — это `sessionEndEpochMs`
 * торговой сессии, отстоящей на N сессий назад от той сессии, к которой
 * биржа относит `recordClose`. До этого момента позиция должна возникнуть,
 * чтобы держатель получил дивиденд. Ровно эта эпоха используется как
 * момент эмиссии события `MARKET_DIVIDEND_DECLARED` (см. план §2.3): на
 * этот момент `TradingModule.tax` смотрит позиции игрока — кто купил
 * позже, дивиденд не получает, что воспроизводит реальное правило.
 *
 * Источники:
 *  - T+2 launch (02.09.2013): https://www.moex.com/n2852
 *  - T+1 launch (31.07.2023): https://www.moex.com/files/45xjcwe1afy87588kafe1drpc9
 *
 * Купоны и погашения сюда не относятся: у них в данных уже честные даты
 * фактической выплаты (`payDateEpochMs`, `maturityEpochMs`) — их менять
 * не нужно.
 */
import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import { findSessionIndexAtOrAfterEpoch } from '@/logic/time/tradingTimeSlots';

/** 02.09.2013 00:00 MSK — первый торговый день эры T+2. */
export const SETTLEMENT_T_PLUS_2_START_EPOCH_MS = 1_378_065_600_000;
/** 31.07.2023 00:00 MSK — первый торговый день эры T+1. */
export const SETTLEMENT_T_PLUS_1_START_EPOCH_MS = 1_690_750_800_000;

/**
 * Сколько торговых дней до даты закрытия реестра — last day to buy with dividend.
 * 0 для T+0, 2 для T+2, 1 для T+1.
 */
export function getDividendSettlementOffsetDays(
  recordCloseEpochMs: number
): 0 | 1 | 2 {
  if (recordCloseEpochMs < SETTLEMENT_T_PLUS_2_START_EPOCH_MS) return 0;
  if (recordCloseEpochMs < SETTLEMENT_T_PLUS_1_START_EPOCH_MS) return 2;
  return 1;
}

/**
 * Возвращает «cut-off для участия в реестре» — момент в `simulationEpochMs`,
 * до которого должна возникнуть позиция, чтобы получить дивиденд по этой
 * декларации. Совпадает с `sessionEndEpochMs` сессии, отстоящей на
 * `getDividendSettlementOffsetDays(recordClose)` назад.
 *
 * Гарантии безопасного fallback:
 *  - N=0 (эра T+0) → возвращает `recordCloseEpochMs` (поведение до правки).
 *  - calendar=null или пустой → возвращает `recordCloseEpochMs`.
 *  - в calendar нет сессий, относящихся к `recordClose` (или их меньше N
 *    до начала истории) → возвращает `recordCloseEpochMs`.
 */
export function computeDividendEligibilityCutoffEpochMs(
  calendar: TradingCalendar | null,
  recordCloseEpochMs: number
): number {
  const n = getDividendSettlementOffsetDays(recordCloseEpochMs);
  if (n === 0 || !calendar || calendar.dayCount === 0) {
    return recordCloseEpochMs;
  }
  // Сессия, к которой биржа относит recordClose: первая, у которой
  // sessionEnd >= recordClose. Это корректно обрабатывает recordClose,
  // выпавший на выходной (берём ближайший рабочий день вперёд).
  const recordSessionIdx = findSessionIndexAtOrAfterEpoch(
    calendar,
    recordCloseEpochMs
  );
  if (recordSessionIdx < 0) return recordCloseEpochMs;
  const cutoffIdx = recordSessionIdx - n;
  if (cutoffIdx < 0) return recordCloseEpochMs;
  const cutoffSession = calendar.getDay(cutoffIdx);
  if (!cutoffSession) return recordCloseEpochMs;
  return cutoffSession.sessionEndEpochMs;
}
