/**
 * Генерация синтетических минутных котировок DN-R «Денежный рынок».
 *
 *   npm run gen:dn-r-candles
 *   npm run gen:dn-r-candles -- --smoke
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAccrualRateEvents } from '../src/logic/modules/market/moneyMarketRateSchedule';
import {
  buildFlatSessionMinuteBars,
  computeNavSeries,
  DN_R_INITIAL_NAV_RUB,
} from '../src/logic/modules/market/moneyMarketNav';
import { createFinamMinuteBarsWriter } from '../src/logic/modules/market/finamMinuteBars';
import { loadKeyRateSchedule } from '../src/logic/modules/market/keyRateSchedule';
import type { TradingDayRecord } from '../src/data/domain/TradingDaySession';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');

const DN_R_SYMBOL = 'DN-R';
const GEN_START_MSK = '20090111';
const GEN_END_MSK = '20260527';
const LOG = '[DN-R gen]';

type CalendarShape = {
  days: TradingDayRecord[];
};

function loadTradingCalendar(): TradingDayRecord[] {
  const path = join(projectRoot, 'src', 'data', 'generated', 'tradingCalendar.json');
  if (!existsSync(path)) {
    throw new Error(`Нет календаря: ${path}. Сначала npm run gen:calendar`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as CalendarShape;
  const days = (raw.days ?? []).filter(
    (d) =>
      d.mskDateYyyymmdd >= GEN_START_MSK && d.mskDateYyyymmdd <= GEN_END_MSK
  );
  if (days.length === 0) {
    throw new Error(`Нет торговых дней в диапазоне ${GEN_START_MSK}…${GEN_END_MSK}`);
  }
  return days;
}

function formatDurationMs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

async function main(): Promise<void> {
  const smoke = process.argv.includes('--smoke');
  const startedAt = Date.now();
  let days = loadTradingCalendar();
  if (smoke) {
    days = [...days.slice(0, 5), ...days.slice(-5)];
    console.log(`${LOG} smoke: ${days.length} дней`);
  }

  const tradingMskDates = days.map((d) => d.mskDateYyyymmdd);
  const schedule = loadKeyRateSchedule();
  const accrualEvents = buildAccrualRateEvents(tradingMskDates, schedule);
  const navSeries = computeNavSeries(days, accrualEvents, DN_R_INITIAL_NAV_RUB);

  const fondsDir = join(projectRoot, 'fonds');
  mkdirSync(fondsDir, { recursive: true });
  const outPath = join(fondsDir, `${DN_R_SYMBOL}.txt`);
  const writer = createFinamMinuteBarsWriter(outPath, DN_R_SYMBOL);

  let totalBars = 0;
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i]!;
    const price = navSeries.get(day.mskDateYyyymmdd);
    if (price === undefined) {
      throw new Error(`NAV не найден для ${day.mskDateYyyymmdd}`);
    }
    const sessionEnd = day.sessionEndEpochMs;
    const sessionStart =
      day.sessionStartEpochMs ?? sessionEnd - 390 * 60_000;
    const bars = buildFlatSessionMinuteBars({
      priceRub: price,
      sessionStartEpochMs: sessionStart,
      sessionEndEpochMs: sessionEnd,
    });
    await writer.appendBars(bars);
    totalBars += bars.length;

    const done = i + 1;
    if (done === 1 || done % 250 === 0 || done === days.length) {
      const pct = ((done / days.length) * 100).toFixed(1);
      console.log(
        `${LOG} [${pct.padStart(5)}%] ${done}/${days.length} ${day.mskDateYyyymmdd} NAV=${price.toFixed(6)} bars+${bars.length}`
      );
    }
  }

  await writer.close();

  const firstNav = navSeries.get(days[0]!.mskDateYyyymmdd)!;
  const lastNav = navSeries.get(days[days.length - 1]!.mskDateYyyymmdd)!;
  console.log(`${LOG} ✓ готово за ${formatDurationMs(Date.now() - startedAt)}`);
  console.log(`${LOG}   файл: ${outPath}`);
  console.log(`${LOG}   сессий: ${days.length}, минуток: ${totalBars.toLocaleString('en-US')}`);
  console.log(`${LOG}   NAV: ${firstNav.toFixed(6)} → ${lastNav.toFixed(6)}`);
  console.log(`${LOG} ── дальше ──`);
  console.log(`${LOG}   npm run gen:market-catalog`);
  console.log(`${LOG}   npm run gen:instrument-details`);
  console.log(`${LOG}   npm run import:market-symbols -- --symbols=DN-R`);
}

main().catch((e) => {
  console.error(`${LOG} ✗`, e);
  process.exitCode = 1;
});
