/**
 * Генерирует `indexes/INFL.txt` из `src/data/generated/inflationSchedule.json`.
 *
 *   npm run gen:inflation-schedule
 *   npm run gen:inflation-index-data
 *   npm run gen:market-catalog
 *   npm run import:market-symbols -- --symbols=INFL
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildInflationIndexFinamText,
  buildInflationIndexBars,
  INFLATION_INDEX_SYMBOL,
} from '../src/logic/modules/market/inflationIndexSeries';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const outDir = join(projectRoot, 'indexes');
const outPath = join(outDir, `${INFLATION_INDEX_SYMBOL}.txt`);

mkdirSync(outDir, { recursive: true });
const text = buildInflationIndexFinamText();
const bars = buildInflationIndexBars();
writeFileSync(outPath, text, 'utf-8');
console.log(
  `[gen:inflation-index-data] ✓ bars=${bars.length} → ${outPath}`
);
