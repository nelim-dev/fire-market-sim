/**
 * Парсит `assets/инфляция.txt` → `src/data/generated/inflationSchedule.json`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInflationScheduleText } from '../src/logic/modules/market/inflationScheduleParse';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const sourcePath = join(projectRoot, 'assets', 'инфляция.txt');
const outPath = join(projectRoot, 'src', 'data', 'generated', 'inflationSchedule.json');

const text = readFileSync(sourcePath, 'utf8');
const schedule = parseInflationScheduleText(text);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify(schedule, null, 2)}\n`,
  'utf8'
);

console.log(
  `[gen:inflation-schedule] ✓ months=${Object.keys(schedule.momByYyyymm).length}, last=${schedule.lastAvailableYyyymm} → ${outPath}`
);
