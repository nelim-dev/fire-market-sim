/**
 * Compare INPUT / PRED(npz) / PRED(sqlite) / REAL for all 21 tickers.
 * Model: resources/ml/python/predict_worker.py (same as app).
 *
 * Run: npx tsx scripts/compare-predict-all-tickers.ts --source 20191230 --target 20200103
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ANALYTICS_MODEL_TICKERS } from '../src/logic/modules/analytics/modelConstants';
import { analyticsFeatureIndex } from '../src/logic/modules/analytics/modelConstants';
import {
  loadAnalyticsDayTensor,
  loadAnalyticsDayTensorPair,
} from '../tests/console/analyticsDayLoader';

const { predictDay, shutdownWorker } = require('../electron/ml-bridge.cjs');

type Args = { source: string; target: string; npzIdx: number | null };

function parseArgs(): Args {
  let source = '20191230';
  let target = '20200103';
  let npzIdx: number | null = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--source' && process.argv[i + 1]) {
      source = process.argv[++i];
    } else if (process.argv[i] === '--target' && process.argv[i + 1]) {
      target = process.argv[++i];
    } else if (process.argv[i] === '--npz-idx' && process.argv[i + 1]) {
      npzIdx = Number(process.argv[++i]);
    }
  }
  return { source, target, npzIdx };
}

function fmtRange(min: number, max: number, mean: number): string {
  return `[${min.toFixed(2)}, ${max.toFixed(2)}] μ=${mean.toFixed(2)}`;
}

function closeVolStats(tensor: number[][], sym: string) {
  const idx = ANALYTICS_MODEL_TICKERS.indexOf(
    sym as (typeof ANALYTICS_MODEL_TICKERS)[number]
  );
  if (idx < 0) {
    return null;
  }
  const ci = analyticsFeatureIndex(idx, 'CLOSE');
  const vi = analyticsFeatureIndex(idx, 'VOL');
  const close = tensor.map((r) => r[ci]).filter(Number.isFinite);
  const vol = tensor.map((r) => r[vi]).filter(Number.isFinite);
  const stats = (arr: number[]) => {
    if (arr.length === 0) {
      return { min: 0, max: 0, mean: 0 };
    }
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const v of arr) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
    }
    return { min, max, mean: sum / arr.length };
  };
  return { close: stats(close), vol: stats(vol) };
}

function findNpzIdxByGazp(sourceTensor: number[][], npzPath: string): number {
  const py = process.env.ML_PYTHON ?? 'python';
  const gazpCi = analyticsFeatureIndex(0, 'CLOSE');
  const dump = path.join(process.cwd(), 'tmp', 'compare-source-tensor.json');
  fs.mkdirSync(path.dirname(dump), { recursive: true });
  fs.writeFileSync(dump, JSON.stringify({ tensor: sourceTensor }));
  const script = `
import json, numpy as np
from pathlib import Path
dump = json.loads(Path(${JSON.stringify(dump)}).read_text())
t = np.array(dump['tensor'], dtype=np.float32)
npz = np.load(${JSON.stringify(npzPath)})['data'].astype(np.float32)
ci = ${gazpCi}
best_i, best_m = -1, 1e18
for j in range(npz.shape[0]):
    d = float(np.max(np.abs(npz[j, :, ci] - t[:, ci])))
    if d < best_m:
        best_m, best_i = d, j
print(best_i)
`;
  const r = spawnSync(py, ['-c', script], { encoding: 'utf-8', cwd: process.cwd() });
  const idx = Number(String(r.stdout ?? r.stderr).trim());
  if (!Number.isFinite(idx) || idx < 0) {
    throw new Error(`npz idx lookup failed: ${r.stdout}${r.stderr}`);
  }
  return idx;
}

function loadNpzRow(idx: number): number[][] {
  const py = process.env.ML_PYTHON ?? 'python';
  const npzPath = path.join(
    process.cwd(),
    'timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz'
  );
  const script = `
import numpy as np, json
row = np.load(${JSON.stringify(npzPath)})['data'][${idx}].astype(np.float32)
print(json.dumps(row.tolist()))
`;
  const r = spawnSync(py, ['-c', script], { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout);
  }
  return JSON.parse(r.stdout.trim()) as number[][];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const npzPath = path.join(
    process.cwd(),
    'timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz'
  );

  console.log(`Pipeline: SQLite ${args.source} -> predict ${args.target}`);
  console.log(`Model: predict_worker (app)\n`);

  const sqliteInput = await loadAnalyticsDayTensor(args.source);
  const { realTensor: sqliteReal } = await loadAnalyticsDayTensorPair(
    args.source,
    args.target
  );

  const npzIdx =
    args.npzIdx ??
    findNpzIdxByGazp(sqliteInput, npzPath);
  const npzInput = loadNpzRow(npzIdx);
  const npzReal = loadNpzRow(npzIdx + 1);

  console.log(`NPZ input row idx=${npzIdx}, real next idx=${npzIdx + 1}\n`);

  const predSqlite = await predictDay(sqliteInput);
  if (!predSqlite.ok || !predSqlite.next_day) {
    throw new Error('sqlite predict failed');
  }
  const predFromSqlite = predSqlite.next_day as number[][];

  const predNpzRes = await predictDay(npzInput);
  if (!predNpzRes.ok || !predNpzRes.next_day) {
    throw new Error('npz predict failed');
  }
  const predFromNpz = predNpzRes.next_day as number[][];

  shutdownWorker();

  const header =
    'symbol | INPUT close       | NPZ_IN close      | PRED(npz) close   | PRED(sqlite) close| REAL(sqlite) close| REAL(npz) close   | |Δ| pred_npz vs real_sq | |Δ| pred_sq vs real_sq';
  console.log(header);
  console.log('-'.repeat(header.length));

  const rows: string[] = [];
  for (const sym of ANALYTICS_MODEL_TICKERS) {
    const inp = closeVolStats(sqliteInput, sym);
    const npzIn = closeVolStats(npzInput, sym);
    const pN = closeVolStats(predFromNpz, sym);
    const pS = closeVolStats(predFromSqlite, sym);
    const rS = closeVolStats(sqliteReal, sym);
    const rN = closeVolStats(npzReal, sym);
    if (!inp || !npzIn || !pN || !pS || !rS || !rN) {
      continue;
    }

    const mae = (pred: number[][], real: number[][]) => {
      const idx = ANALYTICS_MODEL_TICKERS.indexOf(
        sym as (typeof ANALYTICS_MODEL_TICKERS)[number]
      );
      const ci = analyticsFeatureIndex(idx, 'CLOSE');
      let sum = 0;
      const n = Math.min(pred.length, real.length);
      for (let i = 0; i < n; i++) {
        sum += Math.abs(pred[i][ci] - real[i][ci]);
      }
      return n > 0 ? sum / n : 0;
    };

    rows.push(
      `${sym.padEnd(6)} | ${fmtRange(inp.close.min, inp.close.max, inp.close.mean).padEnd(17)} | ${fmtRange(npzIn.close.min, npzIn.close.max, npzIn.close.mean).padEnd(17)} | ${fmtRange(pN.close.min, pN.close.max, pN.close.mean).padEnd(17)} | ${fmtRange(pS.close.min, pS.close.max, pS.close.mean).padEnd(17)} | ${fmtRange(rS.close.min, rS.close.max, rS.close.mean).padEnd(17)} | ${fmtRange(rN.close.min, rN.close.max, rN.close.mean).padEnd(17)} | ${mae(predFromNpz, sqliteReal).toFixed(3).padStart(19)} | ${mae(predFromSqlite, sqliteReal).toFixed(3).padStart(20)}`
    );
  }

  console.log(rows.join('\n'));

  console.log('\n--- Summary (MAE close vs REAL from SQLite next day) ---');
  let sumNpz = 0;
  let sumSq = 0;
  let sumInDiff = 0;
  for (const sym of ANALYTICS_MODEL_TICKERS) {
    const idx = ANALYTICS_MODEL_TICKERS.indexOf(
      sym as (typeof ANALYTICS_MODEL_TICKERS)[number]
    );
    const ci = analyticsFeatureIndex(idx, 'CLOSE');
    let maeN = 0;
    let maeS = 0;
    let maxInDiff = 0;
    const n = sqliteInput.length;
    for (let i = 0; i < n; i++) {
      maeN += Math.abs(predFromNpz[i][ci] - sqliteReal[i][ci]);
      maeS += Math.abs(predFromSqlite[i][ci] - sqliteReal[i][ci]);
      maxInDiff = Math.max(
        maxInDiff,
        Math.abs(sqliteInput[i][ci] - npzInput[i][ci])
      );
    }
    sumNpz += maeN / n;
    sumSq += maeS / n;
    sumInDiff = Math.max(sumInDiff, maxInDiff);
  }
  console.log(`Mean MAE PRED(npz)   vs REAL(sqlite): ${(sumNpz / ANALYTICS_MODEL_TICKERS.length).toFixed(3)}`);
  console.log(`Mean MAE PRED(sqlite) vs REAL(sqlite): ${(sumSq / ANALYTICS_MODEL_TICKERS.length).toFixed(3)}`);
  console.log(`Max |INPUT(sqlite) - INPUT(npz)| close diff (any ticker/slot): check per-row above`);
}

void main().catch((e) => {
  console.error(e);
  shutdownWorker();
  process.exitCode = 1;
});
