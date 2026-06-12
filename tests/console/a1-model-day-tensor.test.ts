/**
 * A1: сборка тензора (107, 105) для ML из SQLite day bundle.
 * Запуск: npx tsx tests/console/a1-model-day-tensor.test.ts
 */
import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_FEAT_DIM,
  ANALYTICS_MODEL_TICKERS,
  analyticsFeatureIndex,
} from '../../src/logic/modules/analytics/modelConstants';
import { buildSessionGridEndMs } from '../../src/logic/modules/analytics/modelDayTensor';
import { loadAnalyticsDayTensor } from './analyticsDayLoader';
import { exitCode, printResult } from './runner';

const M = 'A1-tensor';
const TEST_DAY = '20240603';
let failures = 0;
let testNum = 0;

async function run(description: string, fn: () => void | Promise<void>): Promise<void> {
  testNum++;
  try {
    await fn();
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

async function loadDayTensor(mskDate: string) {
  return loadAnalyticsDayTensor(mskDate);
}

async function main(): Promise<void> {
  await run('session grid: 107 слотов 10:00–18:50', () => {
    const grid = buildSessionGridEndMs(TEST_DAY);
    if (grid.length !== ANALYTICS_BARS_PER_SESSION) {
      throw new Error(`ожидали ${ANALYTICS_BARS_PER_SESSION} слотов, got ${grid.length}`);
    }
  });

  await run('SQLite day → tensor shape (107, 105)', async () => {
    const tensor = await loadDayTensor(TEST_DAY);
    if (tensor.length !== ANALYTICS_BARS_PER_SESSION || tensor[0].length !== ANALYTICS_FEAT_DIM) {
      throw new Error('bad tensor shape');
    }
  });

  await run('разреженный день: ffill, GAZP close > 0', async () => {
    const tensor = await loadDayTensor(TEST_DAY);
    const gazpCloseIdx = analyticsFeatureIndex(
      ANALYTICS_MODEL_TICKERS.indexOf('GAZP'),
      'CLOSE'
    );
    const closes = tensor.map((row) => row[gazpCloseIdx]);
    const positive = closes.filter((c) => c > 0);
    if (positive.length < ANALYTICS_BARS_PER_SESSION * 0.5) {
      throw new Error(`мало заполненных GAZP close: ${positive.length}`);
    }
    if (closes.some((c) => !Number.isFinite(c))) {
      throw new Error('NaN в GAZP close');
    }
  });

  await run('VOL scaled (деление на 10000)', async () => {
    const tensor = await loadDayTensor(TEST_DAY);
    const volIdx = analyticsFeatureIndex(
      ANALYTICS_MODEL_TICKERS.indexOf('GAZP'),
      'VOL'
    );
    const maxVol = Math.max(...tensor.map((r) => r[volIdx]));
    if (maxVol > 1_000_000) {
      throw new Error(`VOL похоже не scaled: max=${maxVol}`);
    }
  });

  exitCode(failures);
}

void main();
