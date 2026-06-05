/**
 * Точечный импорт одного или нескольких символов в `data/market.sqlite`
 * без перечитывания всех .txt файлов.
 *
 *   npm run import:market-symbols -- --symbols DN-R
 *   npm run import:market-symbols -- --symbols DN-R,SBMM
 *
 * Перед импортом: `npm run gen:market-catalog` (символ должен быть в каталоге).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterCatalogBySymbols,
  importKeyRateScheduleToDb,
  importSymbolMinuteBars,
  loadBarEpochFilter,
  loadCatalogItems,
  openMarketDatabase,
  parseSymbolsArg,
  syncTradingCalendarCopy,
  marketDbPath,
} from './marketSqliteImport';

const LOG = '[import:market-symbols]';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');

function readArg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  let symbols = parseSymbolsArg(readArg('--symbols'));
  if (symbols.length === 0) {
    const bare = process.argv.slice(2).find((a) => !a.startsWith('-'));
    if (bare) {
      symbols = parseSymbolsArg(bare);
    }
  }
  if (symbols.length === 0) {
    throw new Error(
      'Укажите символы: npm run import:market-symbols -- --symbols=DN-R'
    );
  }

  const withKeyRate = process.argv.includes('--with-key-rate');
  const allItems = loadCatalogItems(projectRoot);
  const items = filterCatalogBySymbols(allItems, symbols);
  const barEpochFilter = loadBarEpochFilter(projectRoot);

  syncTradingCalendarCopy(projectRoot);
  const db = openMarketDatabase(projectRoot);

  if (withKeyRate) {
    importKeyRateScheduleToDb(db, projectRoot, LOG);
  }

  let totalRows = 0;
  for (const item of items) {
    totalRows += await importSymbolMinuteBars(db, {
      projectRoot,
      item,
      barEpochFilter,
      logPrefix: LOG,
    });
  }

  db.close();
  console.log(
    `${LOG} ✓ импортировано символов: ${items.length}, minute rows=${totalRows} → ${marketDbPath(projectRoot)}`
  );
}

main().catch((e) => {
  console.error(`${LOG} ✗`, e);
  process.exitCode = 1;
});
