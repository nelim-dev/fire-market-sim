/**
 * Импорт минутных рядов из .txt в SQLite (см. план миграции).
 * Запуск: npm run build:market-db
 */
import { createReadStream } from 'node:fs';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toDate } from 'date-fns-tz';
import type { MarketInstrumentCatalogItem } from '../src/logic/modules/market/contracts';
import { parseKeyRateScheduleText } from '../src/logic/modules/market/keyRateSchedule';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');

const DAY_MS = 86_400_000;

type CatalogShape = { items: MarketInstrumentCatalogItem[] };
type CalendarShape = {
  days: Array<{
    mskDateYyyymmdd: string;
    sessionStartEpochMs?: number;
    sessionEndEpochMs: number;
  }>;
};

function loadBarEpochFilter(): { minMs: number; maxMs: number } | null {
  const calPath = join(projectRoot, 'src', 'data', 'generated', 'tradingCalendar.json');
  const raw = JSON.parse(readFileSync(calPath, 'utf-8')) as CalendarShape;
  const days = raw.days ?? [];
  if (days.length === 0) {
    return null;
  }
  const first = days[0];
  const last = days[days.length - 1];
  const minMs =
    (first.sessionStartEpochMs ?? first.sessionEndEpochMs) - 370 * DAY_MS;
  const maxMs = last.sessionEndEpochMs + DAY_MS;
  return { minMs, maxMs };
}

function barEpochMskMinute(mskYyyymmdd: string, hhmmss: string): number {
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  const hh = hhmmss.slice(0, 2);
  const mi = hhmmss.slice(2, 4);
  const ss = hhmmss.slice(4, 6);
  const local = `${y}-${m}-${d}T${hh}:${mi}:${ss}`;
  return toDate(local, { timeZone: 'Europe/Moscow' }).getTime();
}

async function main(): Promise<void> {
  const catalogPath = join(
    projectRoot,
    'src',
    'data',
    'generated',
    'marketInstrumentCatalog.json'
  );
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as CatalogShape;
  const items = Array.isArray(catalog.items) ? catalog.items : [];
  const barEpochFilter = loadBarEpochFilter();

  const dataDir = join(projectRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  const calSrc = join(projectRoot, 'src', 'data', 'generated', 'tradingCalendar.json');
  const calDest = join(dataDir, 'tradingCalendar.json');
  if (!existsSync(calSrc)) {
    throw new Error(`Нет файла календаря: ${calSrc}`);
  }
  copyFileSync(calSrc, calDest);

  const dbPath = join(dataDir, 'market.sqlite');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS minute_bars (
      symbol TEXT NOT NULL,
      ts_ms INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, ts_ms)
    );
    CREATE INDEX IF NOT EXISTS idx_minute_symbol_ts ON minute_bars(symbol, ts_ms);
    CREATE TABLE IF NOT EXISTS key_rate_events (
      effective_ts_ms INTEGER NOT NULL PRIMARY KEY,
      rate_pct REAL NOT NULL
    );
  `);
  for (const alter of [
    'ALTER TABLE minute_bars ADD COLUMN open REAL',
    'ALTER TABLE minute_bars ADD COLUMN high REAL',
    'ALTER TABLE minute_bars ADD COLUMN low REAL',
    'ALTER TABLE minute_bars ADD COLUMN volume REAL DEFAULT 0',
  ]) {
    try {
      db.exec(alter);
    } catch {
      // Колонка уже есть — это нормальный случай при повторном запуске.
    }
  }

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO minute_bars (symbol, ts_ms, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction(
    (
      rows: Array<{
        sym: string;
        ts: number;
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
      }>
    ) => {
      for (const r of rows) {
        insertStmt.run(r.sym, r.ts, r.o, r.h, r.l, r.c, r.v);
      }
    }
  );

  /** Пакетная вставка для скорости: накапливаем батч. */
  const BATCH = 5000;
  let batch: Array<{
    sym: string;
    ts: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }> = [];

  const flush = () => {
    if (batch.length === 0) {
      return;
    }
    insertMany(batch);
    batch = [];
  };

  const insertOne = (
    sym: string,
    ts: number,
    o: number,
    h: number,
    l: number,
    c: number,
    v: number
  ) => {
    batch.push({ sym, ts, o, h, l, c, v });
    if (batch.length >= BATCH) {
      flush();
    }
  };

  const ksPath = join(projectRoot, 'indexes', 'KS.txt');
  if (existsSync(ksPath)) {
    const ksText = readFileSync(ksPath, 'utf-8');
    const schedule = parseKeyRateScheduleText(ksText);
    const insertKeyRate = db.prepare(
      `INSERT OR REPLACE INTO key_rate_events (effective_ts_ms, rate_pct) VALUES (?, ?)`
    );
    const importKeyRates = db.transaction((rows: typeof schedule.events) => {
      db.prepare('DELETE FROM key_rate_events').run();
      for (const row of rows) {
        insertKeyRate.run(row.effectiveEpochMs, row.ratePct);
      }
    });
    importKeyRates(schedule.events);
    const genDir = join(projectRoot, 'src', 'data', 'generated');
    mkdirSync(genDir, { recursive: true });
    const schedulePath = join(genDir, 'keyRateSchedule.json');
    writeFileSync(
      schedulePath,
      `${JSON.stringify({ events: schedule.events }, null, 2)}\n`,
      'utf-8'
    );
    console.log(
      `[build:market-db] KS: key_rate_events=${schedule.events.length} → ${schedulePath}`
    );
  } else {
    console.warn(`[build:market-db] пропуск KS: нет файла ${ksPath}`);
  }

  for (const item of items) {
    const abs = normalize(join(projectRoot, ...item.sourceFilePath.split('/')));
    const sym = item.symbol.toUpperCase();
    db.prepare(`DELETE FROM minute_bars WHERE symbol = ?`).run(sym);

    let count = 0;
    let lineNo = 0;
    const stream = createReadStream(abs, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      lineNo += 1;
      if (lineNo === 1) {
        continue;
      }
      const parts = line.split(',');
      if (parts.length < 8) {
        continue;
      }
      const date = parts[2]?.trim();
      const timeRaw = parts[3]?.trim() ?? '';
      const time = timeRaw.padStart(6, '0');
      const open = Number(parts[4]);
      const high = Number(parts[5]);
      const low = Number(parts[6]);
      const close = Number(parts[7]);
      const volume = Number(parts[8] ?? 0);
      if (
        !/^\d{8}$/.test(date) ||
        !/^\d{6}$/.test(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        continue;
      }

      const tBar = barEpochMskMinute(date, time);
      if (
        barEpochFilter !== null &&
        (tBar < barEpochFilter.minMs || tBar > barEpochFilter.maxMs)
      ) {
        continue;
      }

      insertOne(sym, tBar, open, high, low, close, Number.isFinite(volume) ? volume : 0);
      count += 1;
    }
    flush();
    console.log(`[build:market-db] ${sym}: minute rows=${count}`);
  }

  db.close();
  console.log(`[build:market-db] готово → ${dbPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
