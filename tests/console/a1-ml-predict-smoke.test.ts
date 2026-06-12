/**
 * A1: smoke ML predict — D-1 из SQLite → worker → (107, 105) без NaN.
 * Запуск: npx tsx tests/console/a1-ml-predict-smoke.test.ts
 * Требует: python + pip install -r resources/ml/python/requirements.txt
 */
import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_FEAT_DIM,
  ANALYTICS_MODEL_TICKERS,
  ANALYTICS_VOL_SCALE,
  analyticsFeatureIndex,
} from '../../src/logic/modules/analytics/modelConstants';
import { loadAnalyticsDayTensor } from './analyticsDayLoader';
import { exitCode, printResult } from './runner';

const { predictDay, shutdownWorker } = require('../../electron/ml-bridge.cjs');

const M = 'A1-smoke';
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

async function main(): Promise<void> {
  try {
    await run('end-to-end predict one day', async () => {
      const prevDay = await loadAnalyticsDayTensor(TEST_DAY);
      if (prevDay.length !== ANALYTICS_BARS_PER_SESSION) {
        throw new Error('bad input shape');
      }

      const out = await predictDay(prevDay);
      if (!out.ok || !out.next_day) {
        throw new Error('predict failed');
      }
      const next = out.next_day as number[][];
      if (next.length !== ANALYTICS_BARS_PER_SESSION) {
        throw new Error(`bad output rows ${next.length}`);
      }
      if (next[0].length !== ANALYTICS_FEAT_DIM) {
        throw new Error(`bad output cols ${next[0].length}`);
      }

      const gazpIdx = ANALYTICS_MODEL_TICKERS.indexOf('GAZP');
      const closeIdx = analyticsFeatureIndex(gazpIdx, 'CLOSE');
      const volIdx = analyticsFeatureIndex(gazpIdx, 'VOL');
      const gazpClose = next.map((r) => r[closeIdx]);
      const gazpVol = next.map((r) => r[volIdx]);

      if (gazpClose.some((c) => !Number.isFinite(c))) {
        throw new Error('NaN/Inf in GAZP close');
      }
      if (!gazpClose.some((c) => c !== 0)) {
        throw new Error('GAZP close all zero — подозрительный выход');
      }
      if (gazpVol.some((v) => v < 0)) {
        throw new Error('negative VOL after clip');
      }
    });
  } finally {
    shutdownWorker();
    exitCode(failures);
  }
}

void main();
