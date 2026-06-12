/**
 * VTBR: raw SQLite vs tensor (÷100) vs npz on a calendar day.
 * Run: npx tsx scripts/compare-vtbr-sqlite-npz.ts --date 20191230
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { analyticsFeatureIndex } from '../src/logic/modules/analytics/modelConstants';
import { loadAnalyticsDayTensor } from '../tests/console/analyticsDayLoader';

const VTBR_IDX = 6;
const CI = analyticsFeatureIndex(VTBR_IDX, 'CLOSE');
const VI = analyticsFeatureIndex(VTBR_IDX, 'VOL');

function parseDate(): string {
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--date' && process.argv[i + 1]) {
      return process.argv[++i];
    }
  }
  return '20191230';
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

function findNpzIdxByGazp(tensor: number[][], npzPath: string): number {
  const py = process.env.ML_PYTHON ?? 'python';
  const gazpCi = analyticsFeatureIndex(0, 'CLOSE');
  const dump = path.join(process.cwd(), 'tmp', 'vtbr-compare-tensor.json');
  fs.mkdirSync(path.dirname(dump), { recursive: true });
  fs.writeFileSync(dump, JSON.stringify({ tensor }));
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
  const r = spawnSync(py, ['-c', script], { encoding: 'utf-8' });
  return Number(String(r.stdout).trim());
}

async function main(): Promise<void> {
  const msk = parseDate();
  const dbPath = path.join(process.cwd(), 'data', 'market.sqlite');
  const db = new Database(dbPath, { readonly: true });

  const rows = db
    .prepare(
      `SELECT epoch_ms, open, high, low, close, volume
       FROM minute_bars
       WHERE symbol = 'VTBR' AND msk_date_yyyymmdd = ?
       ORDER BY epoch_ms
       LIMIT 20`
    )
    .all(msk) as Array<{
    epoch_ms: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(close) AS minC, MAX(close) AS maxC, MIN(epoch_ms) AS minT, MAX(epoch_ms) AS maxT
       FROM minute_bars WHERE symbol = 'VTBR' AND msk_date_yyyymmdd = ?`
    )
    .get(msk) as {
    n: number;
    minC: number;
    maxC: number;
    minT: number;
    maxT: number;
  };

  db.close();

  console.log(`=== VTBR raw SQLite minute_bars ${msk} ===`);
  console.log(`rows=${countRow.n} close min/max=${countRow.minC}..${countRow.maxC}`);
  console.log('first 10 bars (raw close/vol):');
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  close=${r.close} vol=${r.volume} (÷100 close=${(r.close / 100).toFixed(2)})`
    );
  }

  const tensor = await loadAnalyticsDayTensor(msk);
  const closes = tensor.map((row) => row[CI]);
  const vols = tensor.map((row) => row[VI]);
  const finiteCloses = closes.filter(Number.isFinite);
  console.log(`\n=== VTBR modelDayTensor ${msk} (after pipeline) ===`);
  console.log(
    `CLOSE min/max/mean: ${Math.min(...finiteCloses).toFixed(2)} .. ${Math.max(...finiteCloses).toFixed(2)} μ=${(finiteCloses.reduce((a, b) => a + b, 0) / finiteCloses.length).toFixed(2)}`
  );
  console.log(
    `VOL min/max: ${Math.min(...vols).toFixed(2)} .. ${Math.max(...vols).toFixed(2)}`
  );
  console.log('CLOSE slots 0-5:', closes.slice(0, 6).map((c) => c.toFixed(2)));

  const npzPath = path.join(
    process.cwd(),
    'timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz'
  );
  const npzIdx = findNpzIdxByGazp(tensor, npzPath);
  const npzRow = loadNpzRow(npzIdx);
  const npzCloses = npzRow.map((r) => r[CI]);
  const npzVols = npzRow.map((r) => r[VI]);
  console.log(`\n=== VTBR npz row idx=${npzIdx} (GAZP-matched day) ===`);
  console.log(
    `CLOSE min/max/mean: ${Math.min(...npzCloses).toFixed(2)} .. ${Math.max(...npzCloses).toFixed(2)} μ=${(npzCloses.reduce((a, b) => a + b, 0) / npzCloses.length).toFixed(2)}`
  );
  console.log(
    `VOL min/max: ${Math.min(...npzVols).toFixed(2)} .. ${Math.max(...npzVols).toFixed(2)}`
  );
  console.log('CLOSE slots 0-5:', npzCloses.slice(0, 6).map((c) => c.toFixed(2)));

  let maxCloseDiff = 0;
  let maxVolDiff = 0;
  for (let i = 0; i < closes.length; i++) {
    maxCloseDiff = Math.max(maxCloseDiff, Math.abs(closes[i] - npzCloses[i]));
    maxVolDiff = Math.max(maxVolDiff, Math.abs(vols[i] - npzVols[i]));
  }
  console.log(`\n=== VTBR SQLite tensor vs npz (same day) ===`);
  console.log(`max |ΔCLOSE|=${maxCloseDiff.toFixed(4)} max |ΔVOL|=${maxVolDiff.toFixed(4)}`);

  const oldScale = countRow.maxC > 1000;
  console.log(`\n=== Diagnosis ===`);
  if (oldScale) {
    console.log(
      'SQLite raw close > 1000 → likely OLD Moex decimals (~230) OR unscaled kopecks; new file uses ~4673 kopecks ints.'
    );
  } else if (countRow.maxC > 100 && countRow.maxC < 500) {
    console.log('SQLite raw close ~46-47 range → already scaled rubles (good for new file after import).');
  }
  if (Math.max(...npzCloses) > 100 && Math.min(...finiteCloses) < 100) {
    console.log(
      'NPZ uses ~230 scale, pipeline uses ~47 (÷100) — MODEL INPUT MISMATCH vs training npz for VTBR.'
    );
  } else if (maxCloseDiff < 0.5) {
    console.log('CLOSE aligned with npz on this day.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
