/**
 * M3: макропоказатели шапки (BR, USD/RUB, ставка ЦБ).
 */
import { LogicManager } from '../../src/logic/managers/LogicManager';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { parseKeyRateScheduleText, resolveKeyRatePct } from '../../src/logic/modules/market/keyRateSchedule';
import { MACRO_BRENT_SYMBOL, MACRO_USD_RUB_SYMBOL } from '../../src/logic/modules/market/macroSymbols';
import { pickHydrateSymbolsFromCatalog } from '../../src/logic/modules/market/service';
import { join } from 'node:path';
import { toDate } from 'date-fns-tz';
import { buildMarketInstrumentCatalog } from '../../src/logic/modules/market/fileScanner';
import { exitCode, printResult } from './runner';

const projectRoot = process.cwd();

const M = 'M3';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
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

function mskEpoch(y: number, m: number, d: number, h = 12): number {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const hh = String(h).padStart(2, '0');
  return toDate(`${y}-${mm}-${dd}T${hh}:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

run('key-rate: null до 16.09.2013', () => {
  const schedule = parseKeyRateScheduleText('16.09.2013\t5,50\n');
  const before = mskEpoch(2013, 9, 15);
  if (resolveKeyRatePct(before, schedule) !== null) {
    throw new Error('ожидали null до первой даты KS');
  }
});

run('macro-dynamic: snapshot обновляется при подложенных барах', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const t0 = mskEpoch(2020, 6, 1);
  const t1 = mskEpoch(2020, 6, 2);
  state.market.chartSeries.minute[MACRO_BRENT_SYMBOL] = [
    { t: t0, o: 40, h: 41, l: 39, c: 40, v: 1 },
    { t: t1, o: 41, h: 42, l: 40, c: 41.5, v: 1 },
  ];
  state.market.chartSeries.minute[MACRO_USD_RUB_SYMBOL] = [
    { t: t0, o: 70, h: 71, l: 69, c: 70, v: 1 },
    { t: t1, o: 71, h: 72, l: 70, c: 71.2, v: 1 },
  ];
  applyMarketQuotesForSimulationEpoch(state.market, t1, null);
  const macro = state.market.macroSnapshot;
  if (macro.brentUsd !== 41.5 || macro.usdRub !== 71.2) {
    throw new Error(
      `ожидали brent=41.5 usd=71.2, получили ${macro.brentUsd} ${macro.usdRub}`
    );
  }
});

run('catalog-exclusion: KS не в generated каталоге при скане', () => {
  const items = buildMarketInstrumentCatalog(projectRoot);
  const symbols = new Set(items.map((i) => i.symbol.toUpperCase()));
  if (symbols.has('KS')) {
    throw new Error('KS не должен попадать в каталог инструментов');
  }
  if (!symbols.has('BR')) {
    throw new Error('BR должен быть в каталоге (indexes/BR.txt)');
  }
});

run('hydrate-symbols: индексы BR/RTSI/EU/USD000UTSTOM должны подгружаться', () => {
  const lm = new LogicManager();
  const catalog = lm.getState().market.instrumentCatalog;
  const symbols = new Set(pickHydrateSymbolsFromCatalog(catalog));
  for (const required of ['BR', 'RTSI', 'EU', 'USD000UTSTOM']) {
    if (!symbols.has(required)) {
      throw new Error(`ожидали ${required} в hydrate symbols`);
    }
  }
  const fireidxRow = catalog.find((item) => item.symbol.toUpperCase() === 'FIREIDX');
  const fireidxPrebaked = Boolean(fireidxRow?.sourceFilePath?.trim());
  if (fireidxPrebaked && !symbols.has('FIREIDX')) {
    throw new Error('FIREIDX с fonds/FIREIDX.txt должен идти в hydrate symbols');
  }
  if (!fireidxPrebaked && symbols.has('FIREIDX')) {
    throw new Error('FIREIDX без файла не должен идти в hydrate symbols');
  }
});

exitCode(failures);
