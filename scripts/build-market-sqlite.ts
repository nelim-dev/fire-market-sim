/**
 * Полный импорт минутных рядов из .txt в SQLite (все символы каталога).
 * Для одного нового инструмента используйте `npm run import:market-symbols`.
 *
 * Запуск: npm run build:market-db
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MarketInstrumentCatalogItem } from '../src/logic/modules/market/contracts';
import {
  importKeyRateScheduleToDb,
  importSymbolMinuteBars,
  loadBarEpochFilter,
  openMarketDatabase,
  parseSymbolsArg,
  syncTradingCalendarCopy,
  marketDbPath,
} from './marketSqliteImport';

const LOG = '[build:market-db]';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');

function readSymbolsFilter(): string[] {
  const eq = process.argv.find((a) => a.startsWith('--symbols='));
  if (eq) {
    return parseSymbolsArg(eq.slice('--symbols='.length));
  }
  const idx = process.argv.indexOf('--symbols');
  if (idx >= 0 && process.argv[idx + 1]) {
    return parseSymbolsArg(process.argv[idx + 1]);
  }
  return [];
}

async function main(): Promise<void> {
  const catalogPath = join(
    projectRoot,
    'src',
    'data',
    'generated',
    'marketInstrumentCatalog.json'
  );
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as {
    items?: MarketInstrumentCatalogItem[];
  };
  let items = Array.isArray(catalog.items) ? catalog.items : [];
  const symbolFilter = readSymbolsFilter();
  if (symbolFilter.length > 0) {
    const want = new Set(symbolFilter);
    items = items.filter((item) => want.has(item.symbol.toUpperCase()));
    if (items.length === 0) {
      throw new Error(`Нет совпадений в каталоге для --symbols ${symbolFilter.join(',')}`);
    }
    console.log(`${LOG} частичный режим: ${items.map((i) => i.symbol).join(', ')}`);
  }

  const barEpochFilter = loadBarEpochFilter(projectRoot);
  syncTradingCalendarCopy(projectRoot);
  const db = openMarketDatabase(projectRoot);

  importKeyRateScheduleToDb(db, projectRoot, LOG);

  for (const item of items) {
    await importSymbolMinuteBars(db, {
      projectRoot,
      item,
      barEpochFilter,
      logPrefix: LOG,
    });
  }

  db.close();
  console.log(`${LOG} готово → ${marketDbPath(projectRoot)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
