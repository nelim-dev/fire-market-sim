/**
 * Compare SQLite-built tensor vs training npz for a calendar day fingerprint.
 * Run: npx tsx scripts/compare-analytics-tensor-npz.ts --source 20191230
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ANALYTICS_MODEL_TICKERS,
  analyticsFeatureIndex,
} from '../src/logic/modules/analytics/modelConstants';
import { loadAnalyticsDayTensor } from '../tests/console/analyticsDayLoader';

const source = process.argv.includes('--source')
  ? process.argv[process.argv.indexOf('--source') + 1]
  : '20191230';

const outPath = path.join(process.cwd(), 'tmp', 'analytics-tensor-dump.json');

async function main() {
  const tensor = await loadAnalyticsDayTensor(source);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ source, tensor }));

  const py = process.env.ML_PYTHON ?? 'python';
  const script = `
import json, numpy as np
from pathlib import Path
BR=19; ci=BR*5+3; vi=BR*5+4
dump = json.loads(Path(${JSON.stringify(outPath)}).read_text())
t = np.array(dump['tensor'], dtype=np.float32)
npz = np.load('timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz')['data'].astype(np.float32)
print('SQLite tensor BR CLOSE', t[:,ci].min(), t[:,ci].max(), 'VOL', t[:,vi].min(), t[:,vi].max())
best_i, best_m = -1, 1e9
for i in range(npz.shape[0]):
    d = np.max(np.abs(npz[i] - t))
    if d < best_m:
        best_m, best_i = d, i
row = npz[best_i]
print(f'Closest npz idx={best_i} max_abs_diff={best_m:.6f}')
print('NPZ match BR CLOSE', row[:,ci].min(), row[:,ci].max(), 'VOL', row[:,vi].min(), row[:,vi].max())
zero_cols = np.sum(np.max(np.abs(t), axis=0) < 1e-9)
print('SQLite zero feature columns (max abs=0):', int(zero_cols), '/ 105')
for sym in ['GAZP','BR']:
    idx = ${JSON.stringify(ANALYTICS_MODEL_TICKERS)}.index(sym)
    if idx < 0: continue
    c = idx*5+3
    mx = np.max(np.abs(t[:, c]))
    print(f'  {sym} max close', mx)
`;
  const r = spawnSync(py, ['-c', script], { encoding: 'utf-8', cwd: process.cwd() });
  console.log(r.stdout || r.stderr);
}

void main();
