/**
 * Слой данных (офлайн-сборка): полный проход по tickers/*.txt,
 * группировка по календарному дню МСК, объединение сессии по правилам биржи.
 *
 * Запуск: npx tsx scripts/build-trading-calendar.ts
 * Результат: src/data/generated/tradingCalendar.json
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  finamDateTimeToEpochMs,
  mskDateKeyYyyymmdd,
  parseFinamDataLine,
} from '../src/data/tickerSessionBounds';
import { computeSessionWindowForDay } from '../src/data/services/tradingDaySessionMerge';
import type { TradingDayRecord } from '../src/data/domain/TradingDaySession';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const tickersDir = path.join(root, 'tickers');
const outFile = path.join(root, 'src/data/generated/tradingCalendar.json');

type DayMap = Map<string, Map<string, { minMs: number; maxMs: number }>>;

async function ingestFile(filePath: string, byDay: DayMap): Promise<void> {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const p = parseFinamDataLine(line);
    if (!p) continue;
    const ticker = p.ticker;
    const epoch = finamDateTimeToEpochMs(p.date, p.time);
    const dateKey = mskDateKeyYyyymmdd(epoch);
    let inner = byDay.get(dateKey);
    if (!inner) {
      inner = new Map();
      byDay.set(dateKey, inner);
    }
    const cur = inner.get(ticker);
    if (!cur) {
      inner.set(ticker, { minMs: epoch, maxMs: epoch });
    } else {
      cur.minMs = Math.min(cur.minMs, epoch);
      cur.maxMs = Math.max(cur.maxMs, epoch);
    }
  }
}

function buildRecords(byDay: DayMap): TradingDayRecord[] {
  const keys = [...byDay.keys()].sort();
  const out: TradingDayRecord[] = [];
  for (const k of keys) {
    const inner = byDay.get(k);
    if (!inner) continue;
    const win = computeSessionWindowForDay(inner);
    if (!win) continue;
    out.push({
      mskDateYyyymmdd: k,
      sessionStartEpochMs: win.sessionStartEpochMs,
      sessionEndEpochMs: win.sessionEndEpochMs,
      tickersWithData: win.tickersWithData,
    });
  }
  return out;
}

async function main(): Promise<void> {
  if (!fs.existsSync(tickersDir)) {
    throw new Error(`Каталог не найден: ${tickersDir}`);
  }
  const names = fs
    .readdirSync(tickersDir)
    .filter((n) => n.toLowerCase().endsWith('.txt'))
    .sort();

  if (names.length === 0) {
    throw new Error(`В ${tickersDir} нет .txt файлов`);
  }

  const byDay: DayMap = new Map();
  for (const n of names) {
    const fp = path.join(tickersDir, n);
    console.log('Сканирование', n, '...');
    await ingestFile(fp, byDay);
  }

  const days = buildRecords(byDay);
  if (days.length === 0) {
    throw new Error('Календарь пуст — нет валидных торговых дней');
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        days,
        dayCount: days.length,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
  console.log('OK →', outFile, 'дней:', days.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
