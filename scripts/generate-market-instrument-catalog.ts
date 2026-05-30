/**
 * Сканирует папки indexes/bonds/tickers/fonds и записывает каталог в JSON.
 * Запуск: npm run gen:market-catalog
 * Нужно после добавления новых .txt файлов с котировками.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarketInstrumentCatalog } from '../src/logic/modules/market/fileScanner';
import { FIREIDX_SYMBOL } from '../src/logic/modules/market/compositeIndex';

const FIREIDX_CATALOG_META = {
  assetKind: 'fund' as const,
  displayName: 'FIRE Market Index',
  isin: 'FIREIDX-SYNTH',
};

function applyFireidxCatalogMeta(
  items: ReturnType<typeof buildMarketInstrumentCatalog>
) {
  const hasFile = items.some(
    (item) =>
      item.symbol.toUpperCase() === FIREIDX_SYMBOL &&
      item.sourceFilePath.length > 0
  );
  const withoutDupes = items.filter(
    (item, index, arr) =>
      item.symbol.toUpperCase() !== FIREIDX_SYMBOL ||
      item.sourceFilePath.length > 0 ||
      arr.findIndex((row) => row.symbol.toUpperCase() === FIREIDX_SYMBOL) ===
        index
  );
  if (!hasFile) {
    return [
      ...withoutDupes.filter((item) => item.symbol.toUpperCase() !== FIREIDX_SYMBOL),
      {
        assetKind: 'fund' as const,
        ticker: FIREIDX_SYMBOL,
        symbol: FIREIDX_SYMBOL,
        displayName: FIREIDX_CATALOG_META.displayName,
        isin: FIREIDX_CATALOG_META.isin,
        sourceFilePath: '',
      },
    ];
  }
  return withoutDupes.map((item) =>
    item.symbol.toUpperCase() === FIREIDX_SYMBOL
      ? { ...item, ...FIREIDX_CATALOG_META }
      : item
  );
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const rawItems = applyFireidxCatalogMeta(buildMarketInstrumentCatalog(projectRoot));
const items = rawItems.map((item) => ({
  ...item,
  sourceFilePath: relative(projectRoot, item.sourceFilePath).replace(/\\/g, '/'),
}));
const outDir = join(projectRoot, 'src', 'data', 'generated');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'marketInstrumentCatalog.json');
writeFileSync(outPath, `${JSON.stringify({ items }, null, 2)}\n`, 'utf-8');
console.log(`[gen:market-catalog] записано инструментов: ${items.length} → ${outPath}`);
