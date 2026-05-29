import { LogicManager } from '../../src/logic/managers/LogicManager';
import { exitCode, printResult } from './runner';

const M = 'M3-day-buffer';
let failures = 0;
let testNum = 0;

async function run(description: string, fn: () => Promise<void>): Promise<void> {
  testNum += 1;
  try {
    await fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures += 1;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

function makeSingleBar(epochMs: number) {
  return [{ t: epochMs, o: 100, h: 101, l: 99, c: 100, v: 1_000 }];
}

async function main(): Promise<void> {
  await run(
    'day-buffer: после первичной загрузки дня minute getSlices не вызывается на тиках',
    async () => {
      const prevWindow = (globalThis as unknown as { window?: unknown }).window;
      let dayCalls = 0;
      let minuteCalls = 0;
      try {
        (globalThis as unknown as {
          window: {
            marketData: {
              getDaySlices: (p: {
                mskDateYyyymmdd: string;
                symbols: string[];
              }) => Promise<{
                ok: true;
                minuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                dailyCloseBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                fiveMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                thirtyMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                oneHourBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                weeklyBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
              }>;
              getSlices: () => Promise<{ ok: true }>;
            };
          };
        }).window = {
          marketData: {
            getDaySlices: async (p) => {
              dayCalls += 1;
              const minuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const dailyCloseBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const fiveMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const thirtyMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const oneHourBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const weeklyBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const barEpoch = Date.UTC(2020, 0, 1, 7, 0, 0);
              for (const s of p.symbols) {
                minuteBySymbol[s.toUpperCase()] = makeSingleBar(barEpoch);
                dailyCloseBySymbol[s.toUpperCase()] = makeSingleBar(barEpoch);
                fiveMinuteBySymbol[s.toUpperCase()] = makeSingleBar(barEpoch);
                thirtyMinuteBySymbol[s.toUpperCase()] = makeSingleBar(barEpoch);
                oneHourBySymbol[s.toUpperCase()] = makeSingleBar(barEpoch);
                weeklyBySymbol[s.toUpperCase()] = makeSingleBar(barEpoch);
              }
              return {
                ok: true,
                minuteBySymbol,
                dailyCloseBySymbol,
                fiveMinuteBySymbol,
                thirtyMinuteBySymbol,
                oneHourBySymbol,
                weeklyBySymbol,
              };
            },
            getSlices: async () => {
              minuteCalls += 1;
              return { ok: true };
            },
          },
        };

        const lm = new LogicManager();
        await lm.hydrateMarketFromDatabase();
        const dayCallsAfterFirst = dayCalls;
        const minuteCallsAfterFirst = minuteCalls;
        if (dayCallsAfterFirst <= 0) {
          throw new Error(
            'ожидали хотя бы один вызов getDaySlices для подготовки day-buffer'
          );
        }
        if (minuteCallsAfterFirst !== 0) {
          throw new Error(
            `getSlices не должен вызываться после day-buffer preload, получено: ${minuteCallsAfterFirst}`
          );
        }

        await lm.hydrateMarketFromDatabase();
        if (minuteCalls !== 0) {
          throw new Error(
            `на повторном тике внутри дня getSlices не должен вызываться, получено: ${minuteCalls}`
          );
        }
        if (dayCalls !== dayCallsAfterFirst) {
          throw new Error(
            'day-buffer должен переиспользоваться внутри дня без повторного day-load'
          );
        }
      } finally {
        if (typeof prevWindow === 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (globalThis as any).window;
        } else {
          (globalThis as { window?: unknown }).window = prevWindow;
        }
      }
    }
  );
  await run(
    'day-buffer: пустой day-slice не отключает minute fallback',
    async () => {
      const prevWindow = (globalThis as unknown as { window?: unknown }).window;
      let dayCalls = 0;
      let minuteCalls = 0;
      try {
        (globalThis as unknown as {
          window: {
            marketData: {
              getDaySlices: () => Promise<{
                ok: true;
                minuteBySymbol: Record<string, []>;
                dailyCloseBySymbol: Record<string, []>;
                fiveMinuteBySymbol: Record<string, []>;
                thirtyMinuteBySymbol: Record<string, []>;
                oneHourBySymbol: Record<string, []>;
                weeklyBySymbol: Record<string, []>;
              }>;
              getSlices: (p: {
                symbols: string[];
                epochMs: number;
              }) => Promise<{
                ok: true;
                minuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                dailyCloseBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                fiveMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                thirtyMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                oneHourBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
                weeklyBySymbol: Record<string, ReturnType<typeof makeSingleBar>>;
              }>;
            };
          };
        }).window = {
          marketData: {
            getDaySlices: async () => {
              dayCalls += 1;
              return {
                ok: true,
                minuteBySymbol: {},
                dailyCloseBySymbol: {},
                fiveMinuteBySymbol: {},
                thirtyMinuteBySymbol: {},
                oneHourBySymbol: {},
                weeklyBySymbol: {},
              };
            },
            getSlices: async (p) => {
              minuteCalls += 1;
              const minuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const dailyCloseBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const fiveMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const thirtyMinuteBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const oneHourBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              const weeklyBySymbol: Record<string, ReturnType<typeof makeSingleBar>> = {};
              for (const s of p.symbols) {
                minuteBySymbol[s.toUpperCase()] = makeSingleBar(p.epochMs);
                dailyCloseBySymbol[s.toUpperCase()] = makeSingleBar(p.epochMs);
                fiveMinuteBySymbol[s.toUpperCase()] = makeSingleBar(p.epochMs);
                thirtyMinuteBySymbol[s.toUpperCase()] = makeSingleBar(p.epochMs);
                oneHourBySymbol[s.toUpperCase()] = makeSingleBar(p.epochMs);
                weeklyBySymbol[s.toUpperCase()] = makeSingleBar(p.epochMs);
              }
              return {
                ok: true,
                minuteBySymbol,
                dailyCloseBySymbol,
                fiveMinuteBySymbol,
                thirtyMinuteBySymbol,
                oneHourBySymbol,
                weeklyBySymbol,
              };
            },
          },
        };

        const lm = new LogicManager();
        await lm.hydrateMarketFromDatabase();
        if (dayCalls <= 0) {
          throw new Error('ожидали попытку day-preload');
        }
        if (minuteCalls <= 0) {
          throw new Error('при пустом day-slice должен сработать minute fallback');
        }
      } finally {
        if (typeof prevWindow === 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (globalThis as any).window;
        } else {
          (globalThis as { window?: unknown }).window = prevWindow;
        }
      }
    }
  );

  process.exit(exitCode(failures));
}

void main();
