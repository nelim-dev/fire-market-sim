import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import {
  buildBackwardDailySlots,
  buildBackwardIntradaySlots,
} from '@/logic/time/tradingTimeSlots';
import type { ChartTimeframeId } from './chartTimeframes';
import { FIREIDX_SYMBOL } from './compositeIndex';
import {
  CHART_6M_1H_BAR_COUNT,
  CHART_ALL_DISPLAY_MAX,
  CHART_DAY_1M_BAR_COUNT,
  CHART_MONTH_30M_BAR_COUNT,
  CHART_WEEK_5M_BAR_COUNT,
  CHART_YEAR_DAILY_BAR_COUNT,
} from './chartTimeframes';
import {
  emptyChartLinesByTimeframe,
  lastBarIndexAtOrBefore,
  sliceTailAtOrBeforeEpoch,
  downsampleBarsForChartDisplay,
  type MarketPriceBar,
} from './priceSeries';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const TF_INTRADAY_STEP_MS: Record<'1d' | '1w' | '1m' | '6m', number> = {
  '1d': 1 * MINUTE_MS,
  '1w': 5 * MINUTE_MS,
  '1m': 30 * MINUTE_MS,
  '6m': HOUR_MS,
};
const TF_BAR_COUNT: Record<'1d' | '1w' | '1m' | '6m' | '1y', number> = {
  '1d': CHART_DAY_1M_BAR_COUNT,
  '1w': CHART_WEEK_5M_BAR_COUNT,
  '1m': CHART_MONTH_30M_BAR_COUNT,
  '6m': CHART_6M_1H_BAR_COUNT,
  '1y': CHART_YEAR_DAILY_BAR_COUNT,
};

/** Срезы рядов рынка (из SQLite через Electron или пусто до гидрации). */
export type MarketChartSeriesBundle = {
  minute: Record<string, readonly MarketPriceBar[]>;
  dailyClose: Record<string, readonly MarketPriceBar[]>;
  fiveMinute: Record<string, readonly MarketPriceBar[]>;
  thirtyMinute: Record<string, readonly MarketPriceBar[]>;
  oneHour: Record<string, readonly MarketPriceBar[]>;
  weekly: Record<string, readonly MarketPriceBar[]>;
};

/** Какой stored-ряд питает окно графика по таймфрейму. */
const CHART_TF_SOURCE: Record<
  ChartTimeframeId,
  keyof Pick<
    MarketChartSeriesBundle,
    'minute' | 'fiveMinute' | 'thirtyMinute' | 'oneHour' | 'dailyClose'
  >
> = {
  '1d': 'minute',
  '1w': 'fiveMinute',
  '1m': 'thirtyMinute',
  '6m': 'oneHour',
  '1y': 'dailyClose',
  all: 'dailyClose',
};

/**
 * FIREIDX: не строить forward-fill дальше последнего реального бара в ряду.
 * Иначе на слоте «текущей» минуты появляется carry-forward, а после hydrate
 * точка пересчитывается — визуальная «тряска».
 */
export function chartAnchorEpochMs(
  symbol: string,
  bundle: MarketChartSeriesBundle,
  simulationEpochMs: number,
  timeframe: ChartTimeframeId
): number {
  if (symbol.toUpperCase() !== FIREIDX_SYMBOL) {
    return simulationEpochMs;
  }
  const bars = bundle[CHART_TF_SOURCE[timeframe]][FIREIDX_SYMBOL] ?? [];
  if (bars.length === 0) {
    return simulationEpochMs;
  }
  const lastT = bars[bars.length - 1]!.t;
  return Math.min(simulationEpochMs, lastT);
}

export function emptyChartSeriesBundle(): MarketChartSeriesBundle {
  return {
    minute: {},
    dailyClose: {},
    fiveMinute: {},
    thirtyMinute: {},
    oneHour: {},
    weekly: {},
  };
}

/**
 * Заполнить набор слотов реальными барами + forward-fill последним известным close.
 *
 * Для каждого `slotT`:
 *  - Если в (prevSlotT, slotT] есть реальные бары — берём последний из них (его OHLCV
 *    и собственный `t`); это сохраняет реальные ценовые данные неизменными.
 *  - Если нет — синтезируем бар `{ t: slotT, o=h=l=c=lastClose, v=0 }` (carry-forward).
 *  - Если до этого момента вообще не было ни одного известного close — слот пропускаем
 *    (инструмент ещё не торговался).
 *
 * Carry-init: берём `lastBarIndexAtOrBefore(bars, slots[0] - 1)`, чтобы первый слот
 * мог быть «занят» баром ровно с `t == slots[0]`.
 */
export function buildForwardFilledLine(
  bars: readonly MarketPriceBar[],
  slots: readonly number[]
): readonly MarketPriceBar[] {
  if (slots.length === 0) return [];
  const firstSlot = slots[0];
  const carryIdx = lastBarIndexAtOrBefore(bars, firstSlot - 1);
  let lastClose: number | null =
    carryIdx >= 0 ? bars[carryIdx].c : null;
  let cursor = carryIdx < 0 ? 0 : carryIdx;
  const out: MarketPriceBar[] = [];
  let prevSlot = firstSlot - 1;
  for (const t of slots) {
    let realIdx = -1;
    while (cursor < bars.length && bars[cursor].t <= t) {
      if (bars[cursor].t > prevSlot) {
        realIdx = cursor;
      } else {
        lastClose = bars[cursor].c;
      }
      cursor++;
    }
    if (realIdx >= 0) {
      out.push(bars[realIdx]);
      lastClose = bars[realIdx].c;
    } else if (lastClose !== null) {
      out.push({
        t,
        o: lastClose,
        h: lastClose,
        l: lastClose,
        c: lastClose,
        v: 0,
      });
    }
    prevSlot = t;
  }
  return out;
}

/**
 * Предвычисленные слоты торгового времени для одного тика.
 * Вычисляются один раз на всю итерацию applyMarketQuotesForSimulationEpoch
 * и переиспользуются для каждого инструмента (Option A performance optimization).
 */
export type PrecomputedChartSlots = {
  slots1d: readonly number[];
  slots1w: readonly number[];
  slots1m: readonly number[];
  slots6m: readonly number[];
  slots1y: readonly number[];
  epochMs: number;
};

/**
 * Построить все пять массивов слотов один раз для данного epochMs.
 * Вызывается один раз в applyMarketQuotesForSimulationEpoch перед циклом.
 */
export function precomputeChartSlotsForEpoch(
  calendar: TradingCalendar,
  epochMs: number
): PrecomputedChartSlots {
  return {
    slots1d: buildBackwardIntradaySlots(
      calendar,
      epochMs,
      TF_INTRADAY_STEP_MS['1d'],
      TF_BAR_COUNT['1d']
    ),
    slots1w: buildBackwardIntradaySlots(
      calendar,
      epochMs,
      TF_INTRADAY_STEP_MS['1w'],
      TF_BAR_COUNT['1w']
    ),
    slots1m: buildBackwardIntradaySlots(
      calendar,
      epochMs,
      TF_INTRADAY_STEP_MS['1m'],
      TF_BAR_COUNT['1m']
    ),
    slots6m: buildBackwardIntradaySlots(
      calendar,
      epochMs,
      TF_INTRADAY_STEP_MS['6m'],
      TF_BAR_COUNT['6m']
    ),
    slots1y: buildBackwardDailySlots(calendar, epochMs, TF_BAR_COUNT['1y']),
    epochMs,
  };
}

/**
 * Срезы линии графика по таймфрейму.
 *
 * Окно строится в **торговом времени** через `TradingCalendar` (ночи/выходные
 * пропускаются). Пустые слоты заполняются forward-fill последним известным
 * close, чтобы график редко торгуемых инструментов не растягивался на месяц.
 *
 * Каноника таймфреймов:
 *  1d → 530 слотов по 1 мин (≈ одна сессия);
 *  1w → 530 по 5 мин (≈ 5 сессий);
 *  1m → 380 по 30 мин (≈ 21 сессия);
 *  6m → 1125 по 1 ч (≈ 125 сессий);
 *  1y → 250 дневных закрытий;
 *  all → вся дневная история до epoch (без forward-fill).
 *
 * Если `calendar` не передан (например, до готовности календаря) — даём безопасный
 * fallback на «последние N баров clipped к epoch», чтобы UI не падал.
 *
 * `preSlots` — предвычисленные слоты (Option A). Если epochMs совпадает и инструмент
 * не FIREIDX (у него anchor может отличаться) — слоты переиспользуются без перестройки.
 */
export function buildChartLineByTimeframeFromBundle(
  symbol: string,
  bundle: MarketChartSeriesBundle,
  epochMs: number,
  calendar: TradingCalendar | null = null,
  preSlots?: PrecomputedChartSlots | null
): Record<ChartTimeframeId, readonly MarketPriceBar[]> {
  const sym = symbol.toUpperCase();
  const minute = bundle.minute[sym] ?? [];
  const daily = bundle.dailyClose[sym] ?? [];
  const m5 = bundle.fiveMinute[sym] ?? [];
  const m30 = bundle.thirtyMinute[sym] ?? [];
  const h1 = bundle.oneHour[sym] ?? [];

  const anchor = (tf: ChartTimeframeId) =>
    chartAnchorEpochMs(sym, bundle, epochMs, tf);

  // Для FIREIDX anchor может отличаться от epochMs (защита от forward-fill).
  // Для всех прочих инструментов anchor всегда равен epochMs, поэтому
  // предвычисленные слоты безопасно переиспользуются.
  const canReuseSlots =
    preSlots != null &&
    preSlots.epochMs === epochMs &&
    sym !== FIREIDX_SYMBOL;

  const out = emptyChartLinesByTimeframe();

  if (!calendar || calendar.dayCount === 0) {
    out['1d'] = sliceTailAtOrBeforeEpoch(
      minute,
      anchor('1d'),
      TF_BAR_COUNT['1d']
    );
    out['1w'] = sliceTailAtOrBeforeEpoch(m5, anchor('1w'), TF_BAR_COUNT['1w']);
    out['1m'] = sliceTailAtOrBeforeEpoch(
      m30,
      anchor('1m'),
      TF_BAR_COUNT['1m']
    );
    out['6m'] = sliceTailAtOrBeforeEpoch(h1, anchor('6m'), TF_BAR_COUNT['6m']);
    out['1y'] = sliceTailAtOrBeforeEpoch(
      daily,
      anchor('1y'),
      TF_BAR_COUNT['1y']
    );
    out['all'] = downsampleBarsForChartDisplay(
      sliceTailAtOrBeforeEpoch(daily, anchor('all')),
      CHART_ALL_DISPLAY_MAX
    );
    return out;
  }

  const slots1d = canReuseSlots
    ? preSlots!.slots1d
    : buildBackwardIntradaySlots(
        calendar,
        anchor('1d'),
        TF_INTRADAY_STEP_MS['1d'],
        TF_BAR_COUNT['1d']
      );
  out['1d'] = buildForwardFilledLine(minute, slots1d);

  const slots1w = canReuseSlots
    ? preSlots!.slots1w
    : buildBackwardIntradaySlots(
        calendar,
        anchor('1w'),
        TF_INTRADAY_STEP_MS['1w'],
        TF_BAR_COUNT['1w']
      );
  out['1w'] = buildForwardFilledLine(m5, slots1w);

  const slots1m = canReuseSlots
    ? preSlots!.slots1m
    : buildBackwardIntradaySlots(
        calendar,
        anchor('1m'),
        TF_INTRADAY_STEP_MS['1m'],
        TF_BAR_COUNT['1m']
      );
  out['1m'] = buildForwardFilledLine(m30, slots1m);

  const slots6m = canReuseSlots
    ? preSlots!.slots6m
    : buildBackwardIntradaySlots(
        calendar,
        anchor('6m'),
        TF_INTRADAY_STEP_MS['6m'],
        TF_BAR_COUNT['6m']
      );
  out['6m'] = buildForwardFilledLine(h1, slots6m);

  const slots1y = canReuseSlots
    ? preSlots!.slots1y
    : buildBackwardDailySlots(calendar, anchor('1y'), TF_BAR_COUNT['1y']);
  out['1y'] = buildForwardFilledLine(daily, slots1y);

  out['all'] = downsampleBarsForChartDisplay(
    sliceTailAtOrBeforeEpoch(daily, anchor('all')),
    CHART_ALL_DISPLAY_MAX
  );

  return out;
}
