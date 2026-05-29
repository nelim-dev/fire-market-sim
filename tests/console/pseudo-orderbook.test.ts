import { buildPseudoOrderBook, resolveBaseVolume } from '../../src/logic/modules/market/pseudoOrderBook';
import { exitCode, printResult } from './runner';

const M = 'OB';
const MINUTE_MS = 60_000;
const MAX_STEP_PCT = 0.15;
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(M, testNum, description, false, e instanceof Error ? e.message : String(e));
  }
}

run('buildPseudoOrderBook: 5 уровней на сторону', () => {
  const book = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 250,
    lotSize: 1,
    minuteVolume: 50_000,
    simulationEpochMs: 1_700_000_000_000,
  });
  if (book.bids.length < 2 || book.asks.length < 2) {
    throw new Error('ожидали многоуровневый стакан');
  }
  const total = book.asks.reduce((s, l) => s + l.qty, 0);
  if (total < 200) {
    throw new Error(`слишком мало ликвидности: ${total}`);
  }
  const minLevel = Math.min(...book.asks.map((l) => l.qty));
  if (minLevel < 15) {
    throw new Error(`уровень ask слишком мал: ${minLevel}`);
  }
});

run('resolveBaseVolume: берёт v последнего бара', () => {
  const bars = [
    { t: 1000, v: 500 },
    { t: 2000, v: 900 },
  ];
  const v = resolveBaseVolume(bars, 2500);
  if (v !== 900) {
    throw new Error(`ожидали 900, получили ${v}`);
  }
});

run('уровни стакана имеют разные цены в пределах ±1%', () => {
  const book = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 253,
    lotSize: 1,
    minuteVolume: 50_000,
    simulationEpochMs: 1_700_000_120_000,
  });
  const bidPrices = new Set(book.bids.map((l) => l.priceRub));
  const askPrices = new Set(book.asks.map((l) => l.priceRub));
  if (bidPrices.size < 2 || askPrices.size < 2) {
    throw new Error('ожидали разные цены на уровнях');
  }
  const bestBid = Math.max(...book.bids.map((l) => l.priceRub));
  const bestAsk = Math.min(...book.asks.map((l) => l.priceRub));
  if (bestBid > 253 || bestAsk < 253) {
    throw new Error('лучшие цены должны обрамлять mid');
  }
  const worstBid = Math.min(...book.bids.map((l) => l.priceRub));
  const worstAsk = Math.max(...book.asks.map((l) => l.priceRub));
  if (worstBid < 253 * 0.99 - 0.01) {
    throw new Error(`bid слишком далеко от mid: ${worstBid}`);
  }
  if (worstAsk > 253 * 1.01 + 0.01) {
    throw new Error(`ask слишком далеко от mid: ${worstAsk}`);
  }
});

function totalAskLots(book: { asks: { qty: number }[] }): number {
  return book.asks.reduce((s, l) => s + l.qty, 0);
}

run('ликвидность: не более ±15% за минуту при скачке volume', () => {
  const t0 = 1_700_000_000_000;
  const book0 = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 250,
    lotSize: 1,
    minuteVolume: 400,
    simulationEpochMs: t0,
  });
  const total0 = totalAskLots(book0);
  const book1 = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 250,
    lotSize: 1,
    minuteVolume: 500_000,
    simulationEpochMs: t0 + 60_000,
    prevBook: book0,
    prevEpochMs: t0,
  });
  const total1 = totalAskLots(book1);
  const pct = Math.abs(total1 - total0) / total0;
  if (pct > MAX_STEP_PCT + 1e-6) {
    throw new Error(`скачок ${(pct * 100).toFixed(1)}% (было ${total0}, стало ${total1})`);
  }
  if (total1 <= total0) {
    throw new Error('ожидали рост к высокому target volume');
  }
});

run('два rebuild в одну минуту: без повторного шага ликвидности', () => {
  const t0 = 1_700_000_000_000;
  const book0 = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 250,
    lotSize: 1,
    minuteVolume: 1_000,
    simulationEpochMs: t0,
  });
  const total0 = totalAskLots(book0);
  const book1 = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 250,
    lotSize: 1,
    minuteVolume: 500_000,
    simulationEpochMs: t0 + 30_000,
    prevBook: book0,
    prevEpochMs: t0,
  });
  const total1 = totalAskLots(book1);
  if (total1 !== total0) {
    throw new Error(
      `повторный rebuild в ту же минуту: ${total0} → ${total1} (ожидали без изменения)`
    );
  }
});

run('ликвидность: несколько минут сходятся к target без скачков', () => {
  const t0 = 1_700_000_000_000;
  const MINUTE_MS = 60_000;
  let prev = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 250,
    lotSize: 1,
    minuteVolume: 1_000,
    simulationEpochMs: t0,
  });
  let prevT = t0;
  let prevTotal = totalAskLots(prev);
  for (let i = 1; i <= 8; i += 1) {
    const t = t0 + i * MINUTE_MS;
    const next = buildPseudoOrderBook({
      symbol: 'SBER',
      midPriceRub: 250,
      lotSize: 1,
      minuteVolume: 80_000,
      simulationEpochMs: t,
      prevBook: prev,
      prevEpochMs: prevT,
    });
    const nextTotal = totalAskLots(next);
    const pct = Math.abs(nextTotal - prevTotal) / prevTotal;
    if (pct > 0.15 + 1e-6) {
      throw new Error(`минута ${i}: скачок ${(pct * 100).toFixed(1)}%`);
    }
    prev = next;
    prevT = t;
    prevTotal = nextTotal;
  }
});

run('детерминизм при одинаковом seed минуты', () => {
  const a = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 100,
    lotSize: 1,
    minuteVolume: 10_000,
    simulationEpochMs: 1_700_000_060_000,
  });
  const b = buildPseudoOrderBook({
    symbol: 'SBER',
    midPriceRub: 100,
    lotSize: 1,
    minuteVolume: 10_000,
    simulationEpochMs: 1_700_000_060_000,
  });
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error('стаканы должны совпадать на одной минуте');
  }
});

exitCode(failures);
