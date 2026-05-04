/**
 * Сканирует папки indexes/bonds/tickers/fonds и записывает каталог в JSON.
 * Запуск: npm run gen:market-catalog
 * Нужно после добавления новых .txt файлов с котировками.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarketInstrumentCatalog } from '../src/logic/modules/market/fileScanner';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const rawItems = buildMarketInstrumentCatalog(projectRoot);
const items = rawItems.map((item) => ({
  ...item,
  sourceFilePath: relative(projectRoot, item.sourceFilePath).replace(/\\/g, '/'),
}));
const outDir = join(projectRoot, 'src', 'data', 'generated');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'marketInstrumentCatalog.json');
writeFileSync(outPath, `${JSON.stringify({ items }, null, 2)}\n`, 'utf-8');
console.log(`[gen:market-catalog] записано инструментов: ${items.length} → ${outPath}`);
