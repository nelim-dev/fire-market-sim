import fs from 'node:fs';
import {
  ANALYTICS_MODEL_TICKERS,
  analyticsFeatureIndex,
} from '../src/logic/modules/analytics/modelConstants';

const ALL = [...ANALYTICS_MODEL_TICKERS];
const dump = JSON.parse(fs.readFileSync('tmp/analytics-tensor-dump.json', 'utf-8'));
const t = dump.tensor as number[][];

for (const sym of ['VTBR', 'HYDR', 'GMKN', 'YDEX', 'BR', 'GAZP']) {
  const idx = ALL.indexOf(sym as (typeof ALL)[number]);
  const vi = analyticsFeatureIndex(idx, 'VOL');
  const ci = analyticsFeatureIndex(idx, 'CLOSE');
  const vols = t.map((r) => r[vi]);
  const closes = t.map((r) => r[ci]);
  console.log(`\n${sym} VOL slots 0-4:`, vols.slice(0, 5).map((v) => v.toFixed(4)));
  console.log(`${sym} VOL min/max:`, Math.min(...vols).toFixed(4), Math.max(...vols).toFixed(4));
  console.log(`${sym} CLOSE min/max:`, Math.min(...closes).toFixed(2), Math.max(...closes).toFixed(2));
  const bad = vols.filter((v) => v > 1000);
  if (bad.length) console.log(`${sym} WARNING: ${bad.length} VOL slots > 1000 (likely unscaled raw)`);
}
