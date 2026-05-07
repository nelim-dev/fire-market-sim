/**
 * Агрегация минут → 5m/30m/1h/дневка для SQLite-пайплайна.
 * Запуск: npx tsx tests/console/m3-minute-bar-aggregation.test.ts
 */
import { aggregateMinuteRowsToBundles } from '../../src/logic/modules/market/minuteBarAggregation';
import { exitCode, printResult } from './runner';

const M = 'M3-agg';
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

/** Два минутных бара в один календарный день МСК → одна дневная точка, ≥1 пятиминутка. */
run('aggregateMinuteRowsToBundles: два бара в один день', () => {
  const sessionEndByDate = new Map<string, number>([
    ['20240601', 1_717_243_200_000],
  ]);
  const rows = [
    { t: 1_717_198_800_000, o: 99, h: 101, l: 98, c: 100, v: 1_000 },
    { t: 1_717_199_460_000, o: 101, h: 103, l: 100, c: 102, v: 900 },
  ];
  const out = aggregateMinuteRowsToBundles(rows, sessionEndByDate);
  if (out.dailyClose.length !== 1) {
    throw new Error(`ожидали 1 дневной бар, получили ${out.dailyClose.length}`);
  }
  if (out.fiveMinute.length < 1) {
    throw new Error('ожидали хотя бы одну 5m свечу');
  }
  if (out.dailyClose[0].c !== 102) {
    throw new Error('дневное закрытие — последнее по времени в дне');
  }
});

exitCode(failures);
