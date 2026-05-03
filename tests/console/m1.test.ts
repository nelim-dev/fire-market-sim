/**
 * Консольные тесты M1 (без браузера). Запуск: npm run test:m1
 */
import { toDate } from 'date-fns-tz';
import type { TradingDayRecord } from '../../src/data/domain/TradingDaySession';
import { LogicManager } from '../../src/logic/managers/LogicManager';
import { SessionTimelineController } from '../../src/logic/time/SessionTimelineController';
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
import { SIMULATION_MS_PER_LOGIC_SECOND_AT_1X } from '../../src/logic/simulation/simulationConfig';
import { exitCode, printResult } from './runner';

const M = 'M1';
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

const d0s = toDate('2020-01-02T10:05:00', { timeZone: 'Europe/Moscow' }).getTime();
const d0e = toDate('2020-01-02T18:49:00', { timeZone: 'Europe/Moscow' }).getTime();
const d1s = toDate('2020-01-03T10:01:00', { timeZone: 'Europe/Moscow' }).getTime();
const d1e = toDate('2020-01-03T18:50:00', { timeZone: 'Europe/Moscow' }).getTime();

const twoDays: TradingDayRecord[] = [
  {
    mskDateYyyymmdd: '20200102',
    sessionStartEpochMs: d0s,
    sessionEndEpochMs: d0e,
    tickersWithData: ['T'],
  },
  {
    mskDateYyyymmdd: '20200103',
    sessionStartEpochMs: d1s,
    sessionEndEpochMs: d1e,
    tickersWithData: ['T'],
  },
];

run('SessionTimeline: перерасход после конца дня переносится на следующий день', () => {
  const cal = TradingCalendar.fromRecords(twoDays);
  const c = new SessionTimelineController(cal);
  const start = c.getGlobalStartEpochMs();
  const spill = 120_000;
  const delta = d0e - start + spill;
  const { epochMs, dayChanged } = c.advance(start, delta);
  if (!dayChanged) throw new Error('ожидалась смена дня');
  const expected = d1s + spill;
  if (epochMs !== expected) {
    throw new Error(`ожидали ${expected}, получили ${epochMs}`);
  }
});

run('SessionTimeline: глобальный cap на последнем дне', () => {
  const oneDay: TradingDayRecord[] = [twoDays[0]];
  const cal = TradingCalendar.fromRecords(oneDay);
  const c = new SessionTimelineController(cal);
  const { epochMs } = c.advance(d0s, 999_999_999_999);
  if (epochMs !== d0e) {
    throw new Error(`ожидали конец сессии ${d0e}, получили ${epochMs}`);
  }
});

run('LogicManager: симуляционное время растёт без паузы', () => {
  const lm = new LogicManager();
  const t0 = lm.getState().simulationEpochMs;
  lm.update(0.05);
  const t1 = lm.getState().simulationEpochMs;
  if (!(t1 > t0)) {
    throw new Error(`время не выросло: ${t0} -> ${t1}`);
  }
});

run('LogicManager: пауза останавливает время', () => {
  const lm = new LogicManager();
  lm.pause();
  const t0 = lm.getState().simulationEpochMs;
  lm.update(0.05);
  lm.update(0.05);
  const t1 = lm.getState().simulationEpochMs;
  if (t1 !== t0) {
    throw new Error(`на паузе время изменилось: ${t0} -> ${t1}`);
  }
  lm.resume();
});

run('LogicManager: пресет timeScale ×100 ускоряет рост относительно 1x', () => {
  const lm1 = new LogicManager();
  const a0 = lm1.getState().simulationEpochMs;
  lm1.update(0.05);
  const inc1 = lm1.getState().simulationEpochMs - a0;

  const lm2 = new LogicManager();
  lm2.setTimeScalePreset(100);
  const b0 = lm2.getState().simulationEpochMs;
  lm2.update(0.05);
  const inc100 = lm2.getState().simulationEpochMs - b0;

  if (inc1 === 0) throw new Error('при 1x прирост не ожидается 0');
  if (inc100 !== inc1 * 100) {
    throw new Error(`ожидали inc100=${inc1 * 100}, получили ${inc100}`);
  }
});

exitCode(failures);
