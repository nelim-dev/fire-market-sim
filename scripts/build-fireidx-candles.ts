/**
 * Офлайн-генерация минутных свечей FIREIDX (по одному торговому дню, без RAM на все акции).
 *
 * Рекомендуемый порядок (SQLite уже содержит акции):
 *   npm run gen:calendar
 *   npm run gen:market-catalog
 *   npm run gen:instrument-details
 *   npm run build:market-db          ← только акции/облигации
 *   npm run gen:fireidx-candles      ← этот скрипт
 *   npm run gen:market-catalog       ← подхватит fonds/FIREIDX.txt
 *   npm run build:market-db          ← импорт FIREIDX в SQLite
 *
 * Или одной цепочкой после подготовки tickers/*.txt:
 *   npm run gen:market-data
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { MarketInstrumentCatalogItem } from '../src/logic/modules/market/contracts';
import {
  FIREIDX_SYMBOL,
  stockSymbolsFromCatalog,
} from '../src/logic/modules/market/compositeIndex';
import {
  createFinamMinuteBarsWriter,
  loadFinamSessionBarsFromFile,
} from '../src/logic/modules/market/finamMinuteBars';
import {
  createEmptyFireidxReplayCursor,
  finalCompositeIndexFromCursor,
  replayFireidxMinuteBarsForSession,
} from '../src/logic/modules/market/fireidxOfflineReplay';
import type { InstrumentDetailsCatalog } from '../src/logic/modules/market/instrumentDetails';
import type { MarketPriceBar } from '../src/logic/modules/market/priceSeries';
import { TradingCalendar } from '../src/logic/time/TradingCalendar';
import type { TradingDayRecord } from '../src/data/domain/TradingDaySession';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');

const LOG = '[FIREIDX gen]';

/** Нижняя граница генерации FIREIDX (календарный день МСК, YYYYMMDD). */
const FIREIDX_GEN_START_MSK_DATE = '20090101';
/** Верхняя граница (фиксированная, без probe по акциям). */
const FIREIDX_GEN_END_MSK_DATE = '20260527';

function formatMskDateLabel(mskYyyymmdd: string): string {
  return `${mskYyyymmdd.slice(0, 4)}-${mskYyyymmdd.slice(4, 6)}-${mskYyyymmdd.slice(6, 8)}`;
}

function filterGenerationDays(
  calendarDays: readonly TradingDayRecord[]
): TradingDayRecord[] {
  const days = calendarDays.filter(
    (day) =>
      day.mskDateYyyymmdd >= FIREIDX_GEN_START_MSK_DATE &&
      day.mskDateYyyymmdd <= FIREIDX_GEN_END_MSK_DATE
  );
  if (days.length === 0) {
    throw new Error(
      `Нет торговых дней в диапазоне ${formatMskDateLabel(FIREIDX_GEN_START_MSK_DATE)} … ${formatMskDateLabel(FIREIDX_GEN_END_MSK_DATE)}`
    );
  }
  return days;
}

type CatalogShape = { items: MarketInstrumentCatalogItem[] };

type StockSource = {
  symbol: string;
  mode: 'sqlite' | 'txt';
  txtPath?: string;
};

function loadCatalog(): MarketInstrumentCatalogItem[] {
  const path = join(
    projectRoot,
    'src',
    'data',
    'generated',
    'marketInstrumentCatalog.json'
  );
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as CatalogShape;
  return Array.isArray(raw.items) ? raw.items : [];
}

function loadDetails(): InstrumentDetailsCatalog {
  const path = join(
    projectRoot,
    'src',
    'data',
    'generated',
    'marketInstrumentDetailsCatalog.json'
  );
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<InstrumentDetailsCatalog>;
  return {
    lotSizeBySymbol: raw.lotSizeBySymbol ?? {},
    sharesOutstandingBySymbol: raw.sharesOutstandingBySymbol ?? {},
    instrumentMetaBySymbol: raw.instrumentMetaBySymbol ?? {},
    dividendsBySymbol: raw.dividendsBySymbol ?? {},
    couponsBySymbol: raw.couponsBySymbol ?? {},
    amortizationsBySymbol: raw.amortizationsBySymbol ?? {},
    redemptionBySymbol: raw.redemptionBySymbol ?? {},
    generatedAt: raw.generatedAt,
  };
}

function loadTradingCalendar(): TradingCalendar {
  const path = join(
    projectRoot,
    'src',
    'data',
    'generated',
    'tradingCalendar.json'
  );
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { days?: TradingDayRecord[] };
  return TradingCalendar.fromRecords(raw.days ?? []);
}

function formatDurationMs(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function resolveStockSources(
  catalog: readonly MarketInstrumentCatalogItem[],
  symbols: readonly string[]
): { sources: StockSource[]; sqliteDb: Database.Database | null } {
  const sqlitePath = join(projectRoot, 'data', 'market.sqlite');
  let sqliteDb: Database.Database | null = null;

  if (existsSync(sqlitePath)) {
    try {
      sqliteDb = new Database(sqlitePath, { readonly: true });
      const probe = sqliteDb.prepare(
        `SELECT COUNT(*) AS c FROM minute_bars WHERE symbol = ? LIMIT 1`
      );
      const allInDb = symbols.every((sym) => {
        const row = probe.get(sym) as { c: number } | undefined;
        return (row?.c ?? 0) > 0;
      });
      if (allInDb) {
        console.log(`${LOG} источник: SQLite (${sqlitePath})`);
        return {
          sqliteDb,
          sources: symbols.map((symbol) => ({ symbol, mode: 'sqlite' as const })),
        };
      }
      console.warn(`${LOG} SQLite неполный → fallback на .txt для пропусков`);
    } catch (err) {
      console.warn(
        `${LOG} SQLite недоступен (${err instanceof Error ? err.message : err}) → .txt`
      );
      sqliteDb = null;
    }
  } else {
    console.log(`${LOG} SQLite не найден → чтение tickers/*.txt по дням`);
  }

  const sources: StockSource[] = [];
  for (const sym of symbols) {
    const item = catalog.find((row) => row.symbol.toUpperCase() === sym);
    if (!item?.sourceFilePath?.trim()) {
      console.warn(`${LOG} пропуск ${sym}: нет sourceFilePath`);
      continue;
    }
    const abs = normalize(join(projectRoot, ...item.sourceFilePath.split('/')));
    if (!existsSync(abs)) {
      console.warn(`${LOG} пропуск ${sym}: нет файла ${abs}`);
      continue;
    }
    sources.push({ symbol: sym, mode: 'txt', txtPath: abs });
  }
  return { sources, sqliteDb };
}

function loadSessionBarsFromSqlite(
  db: Database.Database,
  symbol: string,
  minTs: number,
  maxTs: number
): MarketPriceBar[] {
  const rows = db
    .prepare(
      `SELECT ts_ms, open, high, low, close, volume
       FROM minute_bars
       WHERE symbol = ? AND ts_ms >= ? AND ts_ms <= ?
       ORDER BY ts_ms ASC`
    )
    .all(symbol, minTs, maxTs) as Array<{
    ts_ms: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  return rows.map((r) => ({
    t: r.ts_ms,
    o: r.open,
    h: r.high,
    l: r.low,
    c: r.close,
    v: r.volume,
  }));
}

async function loadSessionBarsForStock(
  source: StockSource,
  db: Database.Database | null,
  mskDate: string,
  minTs: number,
  maxTs: number
): Promise<MarketPriceBar[]> {
  if (source.mode === 'sqlite' && db) {
    return loadSessionBarsFromSqlite(db, source.symbol, minTs, maxTs);
  }
  if (source.txtPath) {
    return loadFinamSessionBarsFromFile(source.txtPath, mskDate, minTs, maxTs);
  }
  return [];
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const catalog = loadCatalog();
  const details = loadDetails();
  const calendar = loadTradingCalendar();
  if (calendar.dayCount === 0) {
    throw new Error('tradingCalendar.json пуст — сначала npm run gen:calendar');
  }

  const stockSymbols = stockSymbolsFromCatalog(catalog);
  if (stockSymbols.length === 0) {
    throw new Error('В каталоге нет акций для расчёта FIREIDX');
  }

  const { sources, sqliteDb } = resolveStockSources(catalog, stockSymbols);
  if (sources.length === 0) {
    throw new Error(
      'Нет источников данных акций. Сначала npm run build:market-db или положите tickers/*.txt'
    );
  }

  const days = filterGenerationDays(calendar.readonlyDays);
  const totalDays = days.length;

  console.log(
    `${LOG} диапазон: ${formatMskDateLabel(FIREIDX_GEN_START_MSK_DATE)} … ${formatMskDateLabel(FIREIDX_GEN_END_MSK_DATE)}`
  );
  console.log(
    `${LOG} ▶ старт: ${sources.length} акций, ${totalDays} торговых дней (из ${calendar.dayCount} в календаре), режим=${
      sqliteDb ? 'sqlite-by-day' : 'txt-by-day'
    }`
  );
  if (!sqliteDb) {
    console.warn(
      `${LOG} ⚠ txt-by-day: ~${totalDays * sources.length} проходов по файлам — долго. Рекомендуется build:market-db сначала.`
    );
  }

  const fondsDir = join(projectRoot, 'fonds');
  mkdirSync(fondsDir, { recursive: true });
  const outPath = join(fondsDir, `${FIREIDX_SYMBOL}.txt`);
  const writer = createFinamMinuteBarsWriter(outPath, FIREIDX_SYMBOL);

  let cursor = createEmptyFireidxReplayCursor();
  let sessionBarsLoaded = 0;
  let daysWithOutput = 0;

  for (let dayIndex = 0; dayIndex < totalDays; dayIndex += 1) {
    const day = days[dayIndex]!;
    const mskDate = day.mskDateYyyymmdd;
    const minTs = day.sessionStartEpochMs ?? day.sessionEndEpochMs - 390 * 60_000;
    const maxTs = day.sessionEndEpochMs;

    const barsBySymbol: Record<string, readonly MarketPriceBar[]> = {};
    let dayStockBars = 0;
    for (const source of sources) {
      const bars = await loadSessionBarsForStock(
        source,
        sqliteDb,
        mskDate,
        minTs,
        maxTs
      );
      if (bars.length > 0) {
        barsBySymbol[source.symbol] = bars;
        dayStockBars += bars.length;
      }
    }
    sessionBarsLoaded += dayStockBars;

    const replay = replayFireidxMinuteBarsForSession({
      catalog,
      symbols: sources.map((s) => s.symbol),
      barsBySymbol,
      details,
      sessionEndEpochMs: maxTs,
      calendar,
      cursor,
    });
    cursor = replay.cursor;

    if (replay.bars.length > 0) {
      await writer.appendBars(replay.bars);
      daysWithOutput += 1;
    }

    const done = dayIndex + 1;
    const pct = ((done / totalDays) * 100).toFixed(1);
    const elapsed = Date.now() - startedAt;
    const eta =
      done > 0 ? Math.round((elapsed / done) * (totalDays - done)) : 0;
    const level = finalCompositeIndexFromCursor(cursor).level;
    const logEvery = sqliteDb ? 25 : 5;
    const isLast = done === totalDays;
    if (done === 1 || done % logEvery === 0 || isLast) {
      console.log(
        `${LOG} [${pct.padStart(5)}%] день ${done}/${totalDays} ${mskDate}  ` +
          `stockBars=${dayStockBars} fireidx+${replay.bars.length}  ` +
          `total=${cursor.totalOutputBars.toLocaleString('en-US')}  ` +
          `level=${level.toFixed(2)}  elapsed=${formatDurationMs(elapsed)}  ETA~${formatDurationMs(eta)}`
      );
    }
  }

  await writer.close();
  sqliteDb?.close();

  const totalMs = Date.now() - startedAt;
  const finalIndex = finalCompositeIndexFromCursor(cursor);
  console.log(`${LOG} ✓ готово за ${formatDurationMs(totalMs)}`);
  console.log(
    `${LOG}   файл: ${outPath}`
  );
  console.log(
    `${LOG}   минуток FIREIDX: ${cursor.totalOutputBars.toLocaleString('en-US')} (${daysWithOutput} сессий с данными)`
  );
  console.log(
    `${LOG}   загружено stock-баров (сумма по дням): ${sessionBarsLoaded.toLocaleString('en-US')}`
  );
  console.log(`${LOG}   финальный level≈${finalIndex.level.toFixed(2)}`);
  console.log(`${LOG} ── дальше ──`);
  console.log(`${LOG}   npm run gen:market-catalog`);
  console.log(`${LOG}   npm run build:market-db`);
}

main().catch((e) => {
  console.error(`${LOG} ✗ ошибка:`, e);
  process.exitCode = 1;
});
