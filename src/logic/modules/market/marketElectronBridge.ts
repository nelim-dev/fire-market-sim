/**
 * marketElectronBridge.ts — мост между слоем логики (renderer) и SQLite в Electron.
 *
 * MarketModule нуждается в исторических OHLCV из `data/market.sqlite`, но в браузере
 * (чистый `npm run dev`) к файлу БД доступа нет. В Electron main-процесс читает SQLite
 * через better-sqlite3; renderer вызывает `window.marketData.*`, которые preload
 * пробрасывает в IPC (`market:get-slices`, `market:get-day-slices` и т.д.).
 *
 * Этот файл — **тонкая обёртка** на стороне React/логики:
 * - проверяет, что мы в окне с `window.marketData`;
 * - нормализует тикеры в UPPER;
 * - превращает IPC-ответ в `MarketChartSeriesBundle` для MarketModule.
 *
 * В Node-тестах и SSR `window` нет → функции тихо возвращают `null` (рынок без графиков).
 *
 * СВЯЗЬ С ДРУГИМИ ФАЙЛАМИ
 * -----------------------
 * - electron/main.js           — регистрация IPC-хендлеров
 * - electron/preload.js        — expose `marketData` в renderer (не здесь)
 * - electron/market-db-slice.cjs — SQL-запросы и агрегация баров
 * - market/service.ts          — вызывает fetch* / prefetch* при реплее котировок
 */

import type { MarketChartSeriesBundle } from './chartWindows';
import type { MarketPriceBar } from './priceSeries';

/** Параметры IPC `market:get-slices` — срезы от эпохи симуляции назад. */
export type MarketSlicesIpcPayload = {
  epochMs: number;
  symbols: readonly string[];
  fromEpochMs?: number;
};

/** Подогрузка минут следующего торгового дня в кэш main (смена сессии без лага). */
export type MarketPrefetchIpcPayload = {
  epochMs: number;
  symbols: readonly string[];
};

/** Явный prefetch конкретного календарного дня (msk YYYYMMDD). */
export type MarketPrefetchDayIpcPayload = {
  mskDateYyyymmdd: string;
  symbols: readonly string[];
};

/** Для ML/аналитики: последний известный close до даты (seed тензора). */
export type MarketLastKnownSeedIpcPayload = {
  beforeMskDate: string;
  symbols: readonly string[];
};

export type MarketLastKnownSeedIpcResult =
  | { ok: true; closeBySymbol: Record<string, number | null> }
  | { ok: false; error?: string };

/** Все бары одного торгового/календарного дня по списку символов. */
export type MarketDaySlicesIpcPayload = {
  mskDateYyyymmdd: string;
  symbols: readonly string[];
  /** Analytics ML: all calendar-day minutes (prepare_raw), not session window only. */
  useCalendarDayMinutes?: boolean;
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

/** Приводит сырой массив из IPC к типизированным MarketPriceBar (защита от кривого JSON). */
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

/**
 * Конвертирует успешный ответ main в структуру графиков MarketModule.
 * Ключи символов приводятся к верхнему регистру для единообразия с каталогом.
 */
export function bundleFromOkPayload(res: MarketSlicesIpcOk): MarketChartSeriesBundle {
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
 * Основной запрос котировок для реплея: минутки + агрегаты (5m, 30m, 1h, daily, weekly).
 *
 * @param epochMs — текущая эпоха симуляции (конец окна)
 * @param symbols — тикеры, для которых нужны ряды
 * @param fromEpochMs — опционально начало окна (иначе main выбирает дефолт)
 * @returns bundle или null, если не Electron / ошибка IPC
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

/** Фоновая подгрузка данных следующего торгового дня (вызывается до смены дня). */
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

/** Подгрузка конкретного дня по дате MSK — для буфера day-buffer в MarketModule. */
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

/**
 * Полные срезы одного дня (mskDateYyyymmdd). Используется при prefetch границы сессии.
 * Обёрнут в try/catch — IPC может упасть при несовпадении ABI better-sqlite3.
 */
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
  try {
    const res = await w.marketData.getDaySlices({
      mskDateYyyymmdd,
      symbols: symbols.map((s) => s.toUpperCase()),
    });
    if (!res.ok) {
      console.warn('[marketData]', res);
      return null;
    }
    return bundleFromOkPayload(res);
  } catch (e) {
    console.warn('[marketData] getDaySlices failed', e);
    return null;
  }
}
