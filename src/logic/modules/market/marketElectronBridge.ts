import type { MarketChartSeriesBundle } from './chartWindows';
import type { MarketPriceBar } from './priceSeries';

export type MarketSlicesIpcPayload = {
  epochMs: number;
  symbols: readonly string[];
  fromEpochMs?: number;
};

export type MarketSlicesIpcOk = {
  ok: true;
  minuteBySymbol: Record<string, MarketPriceBar[]>;
  dailyCloseBySymbol: Record<string, MarketPriceBar[]>;
  fiveMinuteBySymbol: Record<string, MarketPriceBar[]>;
  thirtyMinuteBySymbol: Record<string, MarketPriceBar[]>;
  oneHourBySymbol: Record<string, MarketPriceBar[]>;
  weeklyBySymbol: Record<string, MarketPriceBar[]>;
};

export type MarketSlicesIpcResult =
  | MarketSlicesIpcOk
  | { ok: false; error: string; path?: string };

function asBarList(v: unknown): MarketPriceBar[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.map((row) => ({
    t: Number((row as { t: unknown }).t),
    c: Number((row as { c: unknown }).c),
  }));
}

function bundleFromOkPayload(res: MarketSlicesIpcOk): MarketChartSeriesBundle {
  const upperRecord = (rec: Record<string, unknown>) => {
    const out: Record<string, readonly MarketPriceBar[]> = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k.toUpperCase()] = asBarList(v);
    }
    return out;
  };
  return {
    minute: upperRecord(res.minuteBySymbol as Record<string, unknown>),
    dailyClose: upperRecord(res.dailyCloseBySymbol as Record<string, unknown>),
    fiveMinute: upperRecord(res.fiveMinuteBySymbol as Record<string, unknown>),
    thirtyMinute: upperRecord(res.thirtyMinuteBySymbol as Record<string, unknown>),
    oneHour: upperRecord(res.oneHourBySymbol as Record<string, unknown>),
    weekly: upperRecord(res.weeklyBySymbol as Record<string, unknown>),
  };
}

/**
 * Запрос срезов из Electron main (SQLite). В чистом браузере / тестах API отсутствует — вернётся `null`.
 */
export async function fetchMarketSlicesFromElectron(
  epochMs: number,
  symbols: readonly string[],
  fromEpochMs?: number
): Promise<MarketChartSeriesBundle | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    marketData?: {
      getSlices: (p: {
        epochMs: number;
        symbols: string[];
        fromEpochMs?: number;
      }) => Promise<MarketSlicesIpcResult>;
    };
  };
  if (!w.marketData?.getSlices) {
    return null;
  }
  const res = await w.marketData.getSlices({
    epochMs,
    symbols: symbols.map((s) => s.toUpperCase()),
    ...(Number.isFinite(fromEpochMs) ? { fromEpochMs } : {}),
  });
  if (!res.ok) {
    console.warn('[marketData]', res);
    return null;
  }
  return bundleFromOkPayload(res);
}
