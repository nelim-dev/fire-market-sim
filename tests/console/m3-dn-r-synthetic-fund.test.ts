/**
 * M3: smoke-тест синтетического фонда DN-R (fonds/DN-R.txt).
 * Требует предварительного `npm run gen:dn-r-candles`.
 */
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseFinamDataLine } from '../../src/data/tickerSessionBounds';
import {
  computeNavSeries,
  dailyAccrualFactor,
  DN_R_INITIAL_NAV_RUB,
  roundNavRub,
} from '../../src/logic/modules/market/moneyMarketNav';
import { buildAccrualRateEvents } from '../../src/logic/modules/market/moneyMarketRateSchedule';
import { loadKeyRateSchedule } from '../../src/logic/modules/market/keyRateSchedule';
import { exitCode, printResult } from './runner';

const M = 'M3-DNR';
const FILE = join(process.cwd(), 'fonds', 'DN-R.txt');
const EXPECT_START = '20090111';
const EXPECT_END = '20260527';

let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void | Promise<void>): void {
  testNum++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => printResult(M, testNum, description, true))
        .catch((e) => {
          failures++;
          printResult(
            M,
            testNum,
            description,
            false,
            e instanceof Error ? e.message : String(e)
          );
        });
      return;
    }
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function scanDnRFile(): Promise<{
  firstDate: string | null;
  lastDate: string | null;
  flatIntradayOk: boolean;
  monotonicClose: boolean;
  firstClose: number | null;
}> {
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let currentDate: string | null = null;
  let dayClose: number | null = null;
  let flatIntradayOk = true;
  let monotonicClose = true;
  let prevDayClose: number | null = null;
  let firstClose: number | null = null;

  const rl = createInterface({
    input: createReadStream(FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const meta = parseFinamDataLine(line);
    if (!meta || meta.ticker !== 'DN-R') continue;
    const parts = line.trim().split(',');
    if (parts.length < 8) continue;
    const o = Number(parts[4]);
    const h = Number(parts[5]);
    const l = Number(parts[6]);
    const c = Number(parts[7]);
    if (!Number.isFinite(c)) continue;

    if (firstDate === null) {
      firstDate = meta.date;
      firstClose = c;
    }
    lastDate = meta.date;

    if (o !== h || h !== l || l !== c) {
      flatIntradayOk = false;
    }

    if (currentDate !== meta.date) {
      if (dayClose !== null) {
        if (prevDayClose !== null && dayClose < prevDayClose - 1e-9) {
          monotonicClose = false;
        }
        prevDayClose = dayClose;
      }
      currentDate = meta.date;
      dayClose = c;
    } else {
      dayClose = c;
    }
  }

  if (dayClose !== null && prevDayClose !== null && dayClose < prevDayClose - 1e-9) {
    monotonicClose = false;
  }

  return { firstDate, lastDate, flatIntradayOk, monotonicClose, firstClose };
}

async function main(): Promise<void> {
  if (!existsSync(FILE)) {
    console.warn(`[${M}] skip: нет ${FILE} — сначала npm run gen:dn-r-candles`);
    process.exit(0);
  }

  run('DN-R.txt: диапазон дат 20090111–20260527', async () => {
    const scan = await scanDnRFile();
    if (scan.firstDate !== EXPECT_START) {
      throw new Error(`первая дата ${scan.firstDate}, ожидалось ${EXPECT_START}`);
    }
    if (scan.lastDate !== EXPECT_END) {
      throw new Error(`последняя дата ${scan.lastDate}, ожидалось ${EXPECT_END}`);
    }
  });

  run('DN-R.txt: константный OHLC внутри дня', async () => {
    const scan = await scanDnRFile();
    if (!scan.flatIntradayOk) {
      throw new Error('найдены бары с разным OHLC внутри дня');
    }
  });

  run('DN-R.txt: close монотонно не убывает', async () => {
    const scan = await scanDnRFile();
    if (!scan.monotonicClose) {
      throw new Error('дневной close убывает');
    }
  });

  run('DN-R.txt: NAV первого дня = 10', async () => {
    const scan = await scanDnRFile();
    if (scan.firstClose !== DN_R_INITIAL_NAV_RUB) {
      throw new Error(`первый close=${scan.firstClose}, ожидалось ${DN_R_INITIAL_NAV_RUB}`);
    }
  });

  run('NAV spot-check: 20090111→20090112', () => {
    const trading = [{ mskDateYyyymmdd: '20090111' }, { mskDateYyyymmdd: '20090112' }];
    const events = buildAccrualRateEvents(
      trading.map((d) => d.mskDateYyyymmdd),
      loadKeyRateSchedule()
    );
    const nav = computeNavSeries(trading, events);
    const expected = roundNavRub(10 * dailyAccrualFactor(12.4));
    if (nav.get('20090112') !== expected) {
      throw new Error(`20090112 NAV=${nav.get('20090112')}, expected ${expected}`);
    }
  });

  await new Promise((r) => setTimeout(r, 300));
  process.exit(exitCode(failures));
}

main();
