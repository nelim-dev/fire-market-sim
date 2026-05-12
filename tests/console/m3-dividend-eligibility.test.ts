/**
 * M3: тесты cut-off для участия в реестре по дивиденду.
 * Правило settlement-цикла Мосбиржи: T+0 до 02.09.2013, T+2 до 31.07.2023, T+1 после.
 * Запуск: npx tsx tests/console/m3-dividend-eligibility.test.ts
 */
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
import type { TradingDayRecord } from '../../src/data/domain/TradingDaySession';
import {
  SETTLEMENT_T_PLUS_1_START_EPOCH_MS,
  SETTLEMENT_T_PLUS_2_START_EPOCH_MS,
  computeDividendEligibilityCutoffEpochMs,
  getDividendSettlementOffsetDays,
} from '../../src/logic/modules/market/corporateActions/dividendEligibility';
import { scanScheduleWindow } from '../../src/logic/modules/market/corporateActions/scheduleScanner';
import type { InstrumentDetailsCatalog } from '../../src/logic/modules/market/instrumentDetails';
import { exitCode, printResult } from './runner';

const M = 'M3-div-eligibility';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

const DAY_MS = 86_400_000;
const SESSION_LEN_MS = 8 * 60 * 60_000 + 50 * 60_000; // 530 минут

/**
 * Синтетический календарь: `dayCount` сессий подряд (без выходных),
 * первая стартует в `firstStart`. Используется только в тестах cutoff —
 * различение выходных проверяется отдельно через «дыру» в днях.
 */
function makeBasicCalendar(dayCount: number, firstStart: number): TradingCalendar {
  const records: TradingDayRecord[] = Array.from({ length: dayCount }, (_, i) => ({
    mskDateYyyymmdd: `200000${String(i).padStart(2, '0')}`,
    sessionStartEpochMs: firstStart + i * DAY_MS,
    sessionEndEpochMs: firstStart + i * DAY_MS + SESSION_LEN_MS,
    tickersWithData: ['X'],
  }));
  return TradingCalendar.fromRecords(records);
}

// ============ getDividendSettlementOffsetDays ============

run('getDividendSettlementOffsetDays: T+0 эра (до 02.09.2013) → 0', () => {
  const t = SETTLEMENT_T_PLUS_2_START_EPOCH_MS - 1;
  if (getDividendSettlementOffsetDays(t) !== 0) {
    throw new Error(`ожидали 0, получили ${getDividendSettlementOffsetDays(t)}`);
  }
});

run('getDividendSettlementOffsetDays: граница T+2 (02.09.2013 00:00 MSK) → 2', () => {
  if (getDividendSettlementOffsetDays(SETTLEMENT_T_PLUS_2_START_EPOCH_MS) !== 2) {
    throw new Error('ожидали 2 на самой границе T+2');
  }
});

run('getDividendSettlementOffsetDays: середина T+2 эры → 2', () => {
  const t = SETTLEMENT_T_PLUS_2_START_EPOCH_MS + DAY_MS * 365 * 5; // ~5 лет внутрь
  if (getDividendSettlementOffsetDays(t) !== 2) {
    throw new Error(`ожидали 2 в середине T+2 эры, получили ${getDividendSettlementOffsetDays(t)}`);
  }
});

run('getDividendSettlementOffsetDays: за миллисекунду до T+1 → 2', () => {
  if (getDividendSettlementOffsetDays(SETTLEMENT_T_PLUS_1_START_EPOCH_MS - 1) !== 2) {
    throw new Error('ожидали 2 за миллисекунду до начала T+1');
  }
});

run('getDividendSettlementOffsetDays: граница T+1 (31.07.2023 00:00 MSK) → 1', () => {
  if (getDividendSettlementOffsetDays(SETTLEMENT_T_PLUS_1_START_EPOCH_MS) !== 1) {
    throw new Error('ожидали 1 на самой границе T+1');
  }
});

run('getDividendSettlementOffsetDays: середина T+1 эры → 1', () => {
  const t = SETTLEMENT_T_PLUS_1_START_EPOCH_MS + DAY_MS * 365; // через год
  if (getDividendSettlementOffsetDays(t) !== 1) {
    throw new Error(`ожидали 1, получили ${getDividendSettlementOffsetDays(t)}`);
  }
});

// ============ computeDividendEligibilityCutoffEpochMs ============

run('cutoff: T+0 эра → возвращает recordClose как есть', () => {
  const cal = makeBasicCalendar(10, SETTLEMENT_T_PLUS_2_START_EPOCH_MS - 10 * DAY_MS);
  const recordClose = SETTLEMENT_T_PLUS_2_START_EPOCH_MS - 5 * DAY_MS;
  const cutoff = computeDividendEligibilityCutoffEpochMs(cal, recordClose);
  if (cutoff !== recordClose) {
    throw new Error(`ожидали recordClose=${recordClose}, получили cutoff=${cutoff}`);
  }
});

run('cutoff: calendar=null → fallback на recordClose', () => {
  const recordClose = SETTLEMENT_T_PLUS_2_START_EPOCH_MS + DAY_MS * 30;
  if (computeDividendEligibilityCutoffEpochMs(null, recordClose) !== recordClose) {
    throw new Error('null календарь должен дать recordClose');
  }
});

run('cutoff: пустой календарь → fallback на recordClose', () => {
  const empty = TradingCalendar.fromRecords([]);
  const recordClose = SETTLEMENT_T_PLUS_2_START_EPOCH_MS + DAY_MS * 30;
  if (computeDividendEligibilityCutoffEpochMs(empty, recordClose) !== recordClose) {
    throw new Error('пустой календарь должен дать recordClose');
  }
});

run('cutoff: T+2 эра, recordClose внутри сессии → sessionEnd(recordIdx-2)', () => {
  const first = SETTLEMENT_T_PLUS_2_START_EPOCH_MS;
  const cal = makeBasicCalendar(20, first);
  const recordIdx = 10;
  const recordSession = cal.getDay(recordIdx)!;
  // recordClose попадает в середину дня recordIdx.
  const recordClose = recordSession.sessionStartEpochMs + 2 * 60_000;
  const cutoff = computeDividendEligibilityCutoffEpochMs(cal, recordClose);
  const expectedSession = cal.getDay(recordIdx - 2)!;
  if (cutoff !== expectedSession.sessionEndEpochMs) {
    throw new Error(
      `T+2: ожидали sessionEnd дня ${recordIdx - 2}=${expectedSession.sessionEndEpochMs}, получили ${cutoff}`
    );
  }
});

run('cutoff: T+1 эра, recordClose внутри сессии → sessionEnd(recordIdx-1)', () => {
  const first = SETTLEMENT_T_PLUS_1_START_EPOCH_MS;
  const cal = makeBasicCalendar(20, first);
  const recordIdx = 5;
  const recordSession = cal.getDay(recordIdx)!;
  const recordClose = recordSession.sessionStartEpochMs + 10 * 60_000;
  const cutoff = computeDividendEligibilityCutoffEpochMs(cal, recordClose);
  const expectedSession = cal.getDay(recordIdx - 1)!;
  if (cutoff !== expectedSession.sessionEndEpochMs) {
    throw new Error(
      `T+1: ожидали sessionEnd дня ${recordIdx - 1}=${expectedSession.sessionEndEpochMs}, получили ${cutoff}`
    );
  }
});

run('cutoff: recordClose выпал на выходной → берём следующий торговый день', () => {
  // Календарь с «дырой» в 2 дня (имитируем выходные) между сессиями 2 и 3.
  const first = SETTLEMENT_T_PLUS_1_START_EPOCH_MS;
  const records: TradingDayRecord[] = [];
  const offsets = [0, 1, 2, 5, 6, 7, 8]; // пропуск дней 3 и 4 (как пт–вс)
  offsets.forEach((d, i) => {
    records.push({
      mskDateYyyymmdd: `200001${String(i).padStart(2, '0')}`,
      sessionStartEpochMs: first + d * DAY_MS,
      sessionEndEpochMs: first + d * DAY_MS + SESSION_LEN_MS,
      tickersWithData: ['X'],
    });
  });
  const cal = TradingCalendar.fromRecords(records);
  // recordClose попадает на «выходной» (d=3 или 4) — должен быть отнесён к сессии d=5 (индекс 3).
  const recordClose = first + 3 * DAY_MS + 100; // глубокая ночь после сессии d=2
  const cutoff = computeDividendEligibilityCutoffEpochMs(cal, recordClose);
  // T+1 эра → recordIdx=3 (день d=5), cutoffIdx=2 (день d=2).
  const expectedSession = cal.getDay(2)!;
  if (cutoff !== expectedSession.sessionEndEpochMs) {
    throw new Error(
      `выходные: ожидали sessionEnd индекса 2=${expectedSession.sessionEndEpochMs}, получили ${cutoff}`
    );
  }
});

run('cutoff: истории < N сессий до recordClose → fallback на recordClose', () => {
  // Календарь начинается прямо с recordClose-сессии, истории до неё нет.
  const first = SETTLEMENT_T_PLUS_1_START_EPOCH_MS;
  const cal = makeBasicCalendar(5, first);
  const recordSession = cal.getDay(0)!; // recordIdx=0, T+1 эра требует cutoffIdx=-1
  const recordClose = recordSession.sessionStartEpochMs + 1_000;
  const cutoff = computeDividendEligibilityCutoffEpochMs(cal, recordClose);
  if (cutoff !== recordClose) {
    throw new Error(
      `fallback: ожидали recordClose=${recordClose}, получили cutoff=${cutoff}`
    );
  }
});

// ============ scanScheduleWindow ============

function makeDetails(
  recordCloseEpochMs: number,
  perShareRub = 10
): InstrumentDetailsCatalog {
  return {
    lotSizeBySymbol: {},
    instrumentMetaBySymbol: {},
    dividendsBySymbol: {
      TDIV: [
        {
          recordCloseDateEpochMs: recordCloseEpochMs,
          perShareRub,
          currency: 'RUB',
        },
      ],
    },
    couponsBySymbol: {},
    amortizationsBySymbol: {},
    redemptionBySymbol: {},
  };
}

run('scanScheduleWindow: без calendar в T+2 эре эмитит на recordClose (legacy fallback)', () => {
  const first = SETTLEMENT_T_PLUS_2_START_EPOCH_MS;
  // Берём расписание с recordClose внутри T+2 эры; calendar=null.
  const recordClose = first + 5 * DAY_MS + SESSION_LEN_MS / 2;
  const details = makeDetails(recordClose);
  const out = scanScheduleWindow(details, recordClose - 1_000, recordClose + 1_000, null);
  if (out.length !== 1 || out[0].kind !== 'dividend' || out[0].epochMs !== recordClose) {
    throw new Error(
      `ожидали 1 dividend на epochMs=${recordClose}, получили ${JSON.stringify(out)}`
    );
  }
});

run('scanScheduleWindow: c calendar в T+2 эре эмитит на T-2 sessionEnd', () => {
  const first = SETTLEMENT_T_PLUS_2_START_EPOCH_MS;
  const cal = makeBasicCalendar(20, first);
  const recordIdx = 8;
  const recordSession = cal.getDay(recordIdx)!;
  const recordClose = recordSession.sessionStartEpochMs + 60_000;
  const details = makeDetails(recordClose);

  const cutoffSession = cal.getDay(recordIdx - 2)!;
  const cutoff = cutoffSession.sessionEndEpochMs;

  // Окно перекрывает только cutoff: убеждаемся, что эмиссия идёт по нему, не по recordClose.
  const out = scanScheduleWindow(details, cutoff - 1_000, cutoff + 1_000, cal);
  if (out.length !== 1 || out[0].kind !== 'dividend' || out[0].epochMs !== cutoff) {
    throw new Error(
      `ожидали 1 dividend на cutoff=${cutoff}, получили ${JSON.stringify(out)}`
    );
  }

  // Симметрично: окно вокруг самого recordClose не должно ловить дивиденд (он уже был на cutoff).
  const out2 = scanScheduleWindow(
    details,
    recordClose - 1_000,
    recordClose + 1_000,
    cal
  );
  if (out2.length !== 0) {
    throw new Error(`на recordClose дивиденд не должен срабатывать в T+2 эре, получили ${JSON.stringify(out2)}`);
  }
});

run('scanScheduleWindow: купоны и maturity не зависят от calendar', () => {
  const couponEpoch = SETTLEMENT_T_PLUS_1_START_EPOCH_MS + 100 * DAY_MS;
  const maturityEpoch = couponEpoch + 30 * DAY_MS;
  const details: InstrumentDetailsCatalog = {
    lotSizeBySymbol: {},
    instrumentMetaBySymbol: {},
    dividendsBySymbol: {},
    couponsBySymbol: {
      TBND: [
        {
          startDateEpochMs: couponEpoch - 90 * DAY_MS,
          payDateEpochMs: couponEpoch,
          recordDateEpochMs: null,
          perBondRub: 30,
          faceValueAtTime: 1_000,
        },
      ],
    },
    amortizationsBySymbol: {},
    redemptionBySymbol: {
      TBND: {
        maturityEpochMs: maturityEpoch,
        faceValueRub: 1_000,
      },
    },
  };
  const cal = makeBasicCalendar(200, SETTLEMENT_T_PLUS_1_START_EPOCH_MS);

  const couponOut = scanScheduleWindow(
    details,
    couponEpoch - 1_000,
    couponEpoch + 1_000,
    cal
  );
  if (
    couponOut.length !== 1 ||
    couponOut[0].kind !== 'coupon' ||
    couponOut[0].epochMs !== couponEpoch
  ) {
    throw new Error(`coupon с calendar должен эмититься на payDateEpochMs без сдвига`);
  }

  const maturityOut = scanScheduleWindow(
    details,
    maturityEpoch - 1_000,
    maturityEpoch + 1_000,
    cal
  );
  if (
    maturityOut.length !== 1 ||
    maturityOut[0].kind !== 'maturity' ||
    maturityOut[0].epochMs !== maturityEpoch
  ) {
    throw new Error(`maturity с calendar должен эмититься на maturityEpochMs без сдвига`);
  }
});

exitCode(failures);
