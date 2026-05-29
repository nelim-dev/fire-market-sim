import type { MarketChartSeriesBundle } from './chartWindows';
import type { MarketPriceBar } from './priceSeries';

export type MarketSlicesIpcPayload = {
  epochMs: number;
  symbols: readonly string[];
  fromEpochMs?: number;
};

export type MarketPrefetchIpcPayload = {
  epochMs: number;
  symbols: readonly string[];
};

export type MarketPrefetchDayIpcPayload = {
  mskDateYyyymmdd: string;
  symbols: readonly string[];
};

export type MarketDaySlicesIpcPayload = {
  mskDateYyyymmdd: string;
  symbols: readonly string[];
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

export type MarketPrefetchIpcResult =
  | { ok: true; prefetched?: boolean; mskDateYyyymmdd?: string }
  | { ok: false; error: string; path?: string };

function asBarList(v: unknown): MarketPriceBar[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.map((row) => ({
    t: Number((row as { t: unknown }).t),
    o: Number((row as { o: unknown }).o),
    h: Number((row as { h: unknown }).h),
    l: Number((row as { l: unknown }).l),
    c: Number((row as { c: unknown }).c),
    v: Number((row as { v: unknown }).v),
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

export async function prefetchNextDayFromElectron(
  epochMs: number,
  symbols: readonly string[]
): Promise<MarketPrefetchIpcResult | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    marketData?: {
      prefetchNextDay: (p: { epochMs: number; symbols: string[] }) => Promise<MarketPrefetchIpcResult>;
    };
  };
  if (!w.marketData?.prefetchNextDay) {
    return null;
  }
  return w.marketData.prefetchNextDay({
    epochMs,
    symbols: symbols.map((s) => s.toUpperCase()),
  });
}

export async function prefetchDayFromElectron(
  mskDateYyyymmdd: string,
  symbols: readonly string[]
): Promise<MarketPrefetchIpcResult | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    marketData?: {
      prefetchDay: (p: {
        mskDateYyyymmdd: string;
        symbols: string[];
      }) => Promise<MarketPrefetchIpcResult>;
    };
  };
  if (!w.marketData?.prefetchDay) {
    return null;
  }
  return w.marketData.prefetchDay({
    mskDateYyyymmdd,
    symbols: symbols.map((s) => s.toUpperCase()),
  });
}

export async function fetchDaySlicesFromElectron(
  mskDateYyyymmdd: string,
  symbols: readonly string[]
): Promise<MarketChartSeriesBundle | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    marketData?: {
      getDaySlices: (p: {
        mskDateYyyymmdd: string;
        symbols: string[];
      }) => Promise<MarketSlicesIpcResult>;
    };
  };
  if (!w.marketData?.getDaySlices) {
    return null;
  }
  const res = await w.marketData.getDaySlices({
    mskDateYyyymmdd,
    symbols: symbols.map((s) => s.toUpperCase()),
  });
  if (!res.ok) {
    console.warn('[marketData]', res);
    return null;
  }
  return bundleFromOkPayload(res);
}
