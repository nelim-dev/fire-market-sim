import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { formatInTimeZone } from 'date-fns-tz';
import {
  finamDateTimeToEpochMs,
  parseFinamDataLine,
} from '@/data/tickerSessionBounds';
import type { MarketPriceBar } from './priceSeries';

const FINAM_HEADER =
  '<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>';

export type FinamBarFilter = {
  minTs?: number;
  maxTs?: number;
  /** YYYYMMDD (МСК) — быстрый фильтр до расчёта epoch. */
  mskDateYyyymmdd?: string;
};

function finamLineForBar(symbol: string, bar: MarketPriceBar): string {
  const date = formatInTimeZone(bar.t, 'Europe/Moscow', 'yyyyMMdd');
  const time = formatInTimeZone(bar.t, 'Europe/Moscow', 'HHmmss');
  const vol = Number.isFinite(bar.v) ? Math.round(bar.v) : 0;
  return `${symbol},1,${date},${time},${bar.o},${bar.h},${bar.l},${bar.c},${vol}`;
}

function parseFinamBarLine(line: string, filter?: FinamBarFilter): MarketPriceBar | null {
  const meta = parseFinamDataLine(line);
  if (!meta) {
    return null;
  }
  if (filter?.mskDateYyyymmdd && meta.date !== filter.mskDateYyyymmdd) {
    return null;
  }
  const parts = line.trim().split(',');
  if (parts.length < 8) {
    return null;
  }
  const open = Number(parts[4]);
  const high = Number(parts[5]);
  const low = Number(parts[6]);
  const close = Number(parts[7]);
  const volume = Number(parts[8] ?? 0);
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }
  const t = finamDateTimeToEpochMs(meta.date, meta.time);
  if (filter?.minTs != null && t < filter.minTs) {
    return null;
  }
  if (filter?.maxTs != null && t > filter.maxTs) {
    return null;
  }
  return {
    t,
    o: open,
    h: high,
    l: low,
    c: close,
    v: Number.isFinite(volume) ? volume : 0,
  };
}

/** Потоковое чтение минуток Finam CSV → `MarketPriceBar[]`. */
export async function loadFinamMinuteBarsFromFile(
  filePath: string,
  filter?: FinamBarFilter
): Promise<MarketPriceBar[]> {
  const bars: MarketPriceBar[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const bar = parseFinamBarLine(line, filter);
    if (bar) {
      bars.push(bar);
    }
  }

  return bars;
}

/** Один проход по Finam CSV: min/max epoch без загрузки баров в RAM. */
export async function probeFinamFileEpochBounds(
  filePath: string
): Promise<{ minTs: number; maxTs: number } | null> {
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  let count = 0;
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const bar = parseFinamBarLine(line);
    if (!bar) {
      continue;
    }
    count += 1;
    if (bar.t < minTs) {
      minTs = bar.t;
    }
    if (bar.t > maxTs) {
      maxTs = bar.t;
    }
  }
  if (count === 0 || !Number.isFinite(minTs) || !Number.isFinite(maxTs)) {
    return null;
  }
  return { minTs, maxTs };
}

/** Загрузить минутки одного торгового дня из Finam CSV (без полного файла в RAM). */
export async function loadFinamSessionBarsFromFile(
  filePath: string,
  mskDateYyyymmdd: string,
  minTs: number,
  maxTs: number
): Promise<MarketPriceBar[]> {
  return loadFinamMinuteBarsFromFile(filePath, {
    mskDateYyyymmdd,
    minTs,
    maxTs,
  });
}

export type FinamMinuteBarsWriter = {
  appendBars: (bars: readonly MarketPriceBar[]) => Promise<void>;
  close: () => Promise<void>;
};

/** Потоковая запись Finam CSV: header один раз, дальше append по сессиям. */
export function createFinamMinuteBarsWriter(
  filePath: string,
  symbol: string
): FinamMinuteBarsWriter {
  const ws = createWriteStream(filePath, { encoding: 'utf8' });
  ws.write(`${FINAM_HEADER}\n`);

  const appendBars = async (bars: readonly MarketPriceBar[]): Promise<void> => {
    for (const bar of bars) {
      const line = `${finamLineForBar(symbol, bar)}\n`;
      if (!ws.write(line)) {
        await new Promise<void>((resolve) => ws.once('drain', resolve));
      }
    }
  };

  const close = async (): Promise<void> => {
    ws.end();
    await finished(ws);
  };

  return { appendBars, close };
}

/** Запись всех минуток разом (малые объёмы / тесты). */
export async function writeFinamMinuteBarsToFile(
  filePath: string,
  symbol: string,
  bars: readonly MarketPriceBar[]
): Promise<void> {
  const writer = createFinamMinuteBarsWriter(filePath, symbol);
  await writer.appendBars(bars);
  await writer.close();
}
