/**
 * M3: тесты «торгового окна» графика — forward-fill для редких серий и
 * сетка слотов в торговом времени через TradingCalendar.
 * Запуск: npx tsx tests/console/m3-chart-windows.test.ts
 */
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
import type { TradingDayRecord } from '../../src/data/domain/TradingDaySession';
import {
  buildBackwardDailySlots,
  buildBackwardIntradaySlots,
  findSessionIndexForEpoch,
} from '../../src/logic/time/tradingTimeSlots';
import { buildForwardFilledLine } from '../../src/logic/modules/market/chartWindows';
import { exitCode, printResult } from './runner';

const M = 'M3-chart';
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

const SESSION_LEN_MS = 8 * 60 * 60_000 + 50 * 60_000; // 530 мин

function makeCalendar(dayCount: number, firstStart: number): TradingCalendar {
  const DAY = 86_400_000;
  const records: TradingDayRecord[] = Array.from({ length: dayCount }, (_, i) => ({
    mskDateYyyymmdd: `2024${String(i + 1).padStart(4, '0')}`,
    sessionStartEpochMs: firstStart + i * DAY,
    sessionEndEpochMs: firstStart + i * DAY + SESSION_LEN_MS,
    tickersWithData: ['X'],
  }));
  return TradingCalendar.fromRecords(records);
}

run('findSessionIndexForEpoch: anchor внутри сессии возвращает её индекс', () => {
  const cal = makeCalendar(3, 1_000_000);
  if (findSessionIndexForEpoch(cal, 1_000_000 + 100_000) !== 0) {
    throw new Error('должны попасть в 0-й день');
  }
  if (findSessionIndexForEpoch(cal, 1_000_000 + 86_400_000 + 100) !== 1) {
    throw new Error('должны попасть в 1-й день');
  }
});

run('findSessionIndexForEpoch: anchor до первой сессии → -1', () => {
  const cal = makeCalendar(2, 1_000_000);
  if (findSessionIndexForEpoch(cal, 0) !== -1) {
    throw new Error('до первого дня — -1');
  }
});

run('findSessionIndexForEpoch: anchor в «ночи» между сессиями → предыдущий день', () => {
  const cal = makeCalendar(3, 1_000_000);
  const nightT = 1_000_000 + SESSION_LEN_MS + 60_000; // через минуту после конца 0-й сессии
  if (findSessionIndexForEpoch(cal, nightT) !== 0) {
    throw new Error('в ночи между 0-й и 1-й — индекс 0');
  }
});

run('buildBackwardIntradaySlots: все 530 слотов внутри одной сессии, шаг 60s', () => {
  const cal = makeCalendar(1, 1_000_000);
  const session = cal.getDay(0)!;
  const slots = buildBackwardIntradaySlots(cal, session.sessionEndEpochMs, 60_000, 530);
  if (slots.length !== 530) {
    throw new Error(`ожидали 530 слотов, получили ${slots.length}`);
  }
  if (slots[slots.length - 1] !== session.sessionEndEpochMs) {
    throw new Error('последний слот должен быть == sessionEnd');
  }
  for (const t of slots) {
    if (t < session.sessionStartEpochMs || t > session.sessionEndEpochMs) {
      throw new Error(`слот t=${t} вне сессии`);
    }
  }
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] - slots[i - 1] !== 60_000) {
      throw new Error(`шаг не 60s: i=${i}, dt=${slots[i] - slots[i - 1]}`);
    }
  }
});

run('buildBackwardIntradaySlots: перенос остатка между сессиями', () => {
  const cal = makeCalendar(3, 1_000_000);
  const lastSession = cal.getDay(2)!;
  // запросим больше слотов, чем влезает в одну сессию (531 минут, ёмкость = 530 мин + 1)
  // — должны перетечь в предыдущую сессию.
  const slots = buildBackwardIntradaySlots(
    cal,
    lastSession.sessionEndEpochMs,
    60_000,
    532
  );
  if (slots.length !== 532) {
    throw new Error(`ожидали 532 слота, получили ${slots.length}`);
  }
  // Хотя бы один слот должен оказаться в предыдущей сессии.
  const prevSession = cal.getDay(1)!;
  const inPrev = slots.find(
    (t) =>
      t >= prevSession.sessionStartEpochMs && t <= prevSession.sessionEndEpochMs
  );
  if (inPrev === undefined) {
    throw new Error('должен быть хотя бы один слот в предыдущей сессии');
  }
  // Ни один слот не должен попасть в «ночь» между сессиями.
  for (const t of slots) {
    const inAny =
      (t >= prevSession.sessionStartEpochMs && t <= prevSession.sessionEndEpochMs) ||
      (t >= lastSession.sessionStartEpochMs && t <= lastSession.sessionEndEpochMs);
    if (!inAny) {
      throw new Error(`слот t=${t} попал в «ночь»`);
    }
  }
});

run('buildBackwardDailySlots: count сессий с t = sessionEnd', () => {
  const cal = makeCalendar(5, 1_000_000);
  const last = cal.getDay(4)!;
  const slots = buildBackwardDailySlots(cal, last.sessionEndEpochMs, 3);
  if (slots.length !== 3) {
    throw new Error(`ожидали 3 слота, получили ${slots.length}`);
  }
  for (let i = 0; i < 3; i++) {
    const s = cal.getDay(2 + i)!;
    if (slots[i] !== s.sessionEndEpochMs) {
      throw new Error(
        `slot[${i}] должен быть == sessionEnd дня ${2 + i}: ожидали ${s.sessionEndEpochMs}, получили ${slots[i]}`
      );
    }
  }
});

run('buildForwardFilledLine: пустые слоты заполняются последним известным close', () => {
  const slots = [100, 200, 300, 400, 500];
  const bars = [
    { t: 50, o: 9, h: 9, l: 9, c: 9, v: 1 }, // carry-init из «до окна»
    { t: 250, o: 11, h: 11, l: 11, c: 11, v: 2 }, // попадает в слот 300
  ];
  const out = buildForwardFilledLine(bars, slots);
  if (out.length !== 5) {
    throw new Error(`ожидали 5 баров (по числу слотов), получили ${out.length}`);
  }
  // slot 100: carry-init 9
  if (out[0].c !== 9 || out[0].t !== 100 || out[0].v !== 0) {
    throw new Error(`слот 100: ожидали carry c=9 t=100 v=0, получили ${JSON.stringify(out[0])}`);
  }
  // slot 200: carry-forward 9
  if (out[1].c !== 9 || out[1].t !== 200) {
    throw new Error(`слот 200 должен carry-forward c=9`);
  }
  // slot 300: реальный бар (t=250, c=11)
  if (out[2].c !== 11 || out[2].t !== 250 || out[2].v !== 2) {
    throw new Error(`слот 300 должен взять реальный бар c=11 t=250 v=2`);
  }
  // slot 400 / 500: carry-forward 11
  if (out[3].c !== 11 || out[4].c !== 11) {
    throw new Error(`слоты после реального бара carry c=11`);
  }
});

run('buildForwardFilledLine: без pre-window carry — ведущие слоты forward-fill из первого бара окна', () => {
  const slots = [100, 200, 300, 400];
  const bars = [{ t: 250, o: 7, h: 7, l: 7, c: 7, v: 1 }];
  const out = buildForwardFilledLine(bars, slots);
  if (out.length !== 4) {
    throw new Error(`ожидали 4 точки (полное окно), получили ${out.length}`);
  }
  if (out[0].c !== 7 || out[0].t !== 100 || out[0].v !== 0) {
    throw new Error('слот 100: forward-fill c=7 до первого реального бара');
  }
  if (out[2].c !== 7 || out[2].t !== 250) {
    throw new Error('слот 300: реальный бар t=250');
  }
  if (out[3].c !== 7 || out[3].t !== 400) {
    throw new Error('слот 400: carry-forward c=7');
  }
});

run('buildForwardFilledLine: до листинга слоты пропускаются (нет ни carry, ни бара в окне)', () => {
  const slots = [100, 200, 300];
  const bars = [{ t: 500, o: 7, h: 7, l: 7, c: 7, v: 1 }];
  const out = buildForwardFilledLine(bars, slots);
  if (out.length !== 0) {
    throw new Error(`все слоты до первого бара — пусто, получили ${out.length}`);
  }
});

exitCode(failures);
