import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import { applyMacroSnapshotForEpoch } from './macroResolve';
import type { MarketAssetState, MarketModuleState } from './state';
import { CHART_TIMEFRAME_IDS } from './chartTimeframes';
import {
  buildChartLineByTimeframeFromBundle,
  precomputeChartSlotsForEpoch,
  type PrecomputedChartSlots,
} from './chartWindows';
import {
  computePeriodReturnPct,
  computePriceAndDailyChange,
  lastBarIndexAtOrBefore,
} from './priceSeries';
import type { MarketPriceBar } from './priceSeries';
import { faceValueAtTime, nkdPerBondRubAt } from './instrumentDetails';
import { FIREIDX_SYMBOL } from './compositeIndex';
import {
  buildPseudoOrderBook,
  orderBookSignature,
  resolveBaseVolume,
} from './pseudoOrderBook';

function effectiveFaceValueRub(
  asset: MarketAssetState,
  t: number,
  details: MarketModuleState['details']
): number | null {
  const fromDetails = faceValueAtTime(asset.symbol.toUpperCase(), t, details);
  if (fromDetails !== null && Number.isFinite(fromDetails) && fromDetails > 0) {
    return fromDetails;
  }
  return asset.faceValueRub ?? null;
}

function bondPricePctToRub(
  asset: MarketAssetState,
  pricePct: number,
  t: number,
  details: MarketModuleState['details']
): number {
  const face = effectiveFaceValueRub(asset, t, details);
  if (face === null || !Number.isFinite(face) || face <= 0) return pricePct;
  return (pricePct * face) / 100;
}

function maybeNormalizeBondBars(
  asset: MarketAssetState,
  bars: readonly MarketPriceBar[],
  details: MarketModuleState['details']
): readonly MarketPriceBar[] {
  if (!asset.isBond) return bars;
  return bars.map((bar) => {
    const face = effectiveFaceValueRub(asset, bar.t, details);
    if (face === null || !Number.isFinite(face) || face <= 0) return bar;
    const k = face / 100;
    return {
      t: bar.t,
      o: bar.o * k,
      h: bar.h * k,
      l: bar.l * k,
      c: bar.c * k,
      v: bar.v,
    };
  });
}

function symbolMatchesFilter(
  sym: string,
  options?: ApplyMarketQuotesOptions
): boolean {
  if (options?.onlySymbols?.length) {
    return options.onlySymbols.some((s) => s.toUpperCase() === sym);
  }
  if (options?.excludeSymbols?.length) {
    return !options.excludeSymbols.some((s) => s.toUpperCase() === sym);
  }
  return true;
}

export type ApplyMarketQuotesOptions = {
  excludeSymbols?: readonly string[];
  onlySymbols?: readonly string[];
  skipOrderBookIfBuiltThisEpoch?: boolean;
};

function applyQuotesForOneAsset(
  market: MarketModuleState,
  item: { symbol: string },
  simulationEpochMs: number,
  calendar: TradingCalendar | null,
  options?: ApplyMarketQuotesOptions,
  preSlots?: PrecomputedChartSlots | null
): boolean {
  const sym = item.symbol.toUpperCase();
  const minute = market.chartSeries.minute[sym] ?? [];
  const daily = market.chartSeries.dailyClose[sym] ?? [];
  const asset = market.assetsBySymbol[sym];
  if (!asset) {
    return false;
  }
  const minuteLastIdx = lastBarIndexAtOrBefore(minute, simulationEpochMs);
  const minutePricePct = minuteLastIdx >= 0 ? minute[minuteLastIdx].c : null;
  const lastIdx = lastBarIndexAtOrBefore(daily, simulationEpochMs);
  const { currentPriceRub: dailyPricePct, dailyChangePct } = computePriceAndDailyChange(
    daily,
    lastIdx
  );
  let effectivePriceRub: number;
  if (asset.isBond) {
    const pricePctFromBars = minutePricePct ?? dailyPricePct;
    if (pricePctFromBars !== null) {
      effectivePriceRub = bondPricePctToRub(
        asset,
        pricePctFromBars,
        simulationEpochMs,
        market.details
      );
    } else {
      effectivePriceRub = asset.currentPriceRub ?? 0;
    }
  } else {
    effectivePriceRub =
      minutePricePct ?? dailyPricePct ?? asset.currentPriceRub ?? 100;
  }
  const rawLines = buildChartLineByTimeframeFromBundle(
    sym,
    market.chartSeries,
    simulationEpochMs,
    calendar,
    preSlots
  );
  const lines: typeof rawLines = asset.isBond
    ? {
        '1d': maybeNormalizeBondBars(asset, rawLines['1d'], market.details),
        '1w': maybeNormalizeBondBars(asset, rawLines['1w'], market.details),
        '1m': maybeNormalizeBondBars(asset, rawLines['1m'], market.details),
        '6m': maybeNormalizeBondBars(asset, rawLines['6m'], market.details),
        '1y': maybeNormalizeBondBars(asset, rawLines['1y'], market.details),
        all: maybeNormalizeBondBars(asset, rawLines['all'], market.details),
      }
    : rawLines;
  let periodChanged = false;
  const nextPeriod = { ...asset.periodChangePctByTimeframe };
  for (const id of CHART_TIMEFRAME_IDS) {
    const nextValue = computePeriodReturnPct(lines[id]);
    if (nextValue !== asset.periodChangePctByTimeframe[id]) {
      periodChanged = true;
    }
    nextPeriod[id] = nextValue;
  }
  const chartChanged = CHART_TIMEFRAME_IDS.some(
    (id) => asset.chartLineByTimeframe[id] !== lines[id]
  );
  const skipOrderBook = asset.assetKind === 'index';
  const pin = asset.testOrderBookPin;
  const priceMoved =
    Math.abs((effectivePriceRub ?? 0) - (asset.currentPriceRub ?? 0)) > 0.0001;
  const skipBookRebuild =
    options?.skipOrderBookIfBuiltThisEpoch === true &&
    asset.orderBookBuiltAtEpochMs === simulationEpochMs &&
    !priceMoved;
  const nextOrderBook = skipOrderBook
    ? { bids: [], asks: [] }
    : skipBookRebuild
      ? asset.orderBook
      : pin
        ? {
            bids: [{ priceRub: pin.priceRub, qty: pin.qty }],
            asks: [{ priceRub: pin.priceRub, qty: pin.qty }],
          }
        : (() => {
            const minuteBars = market.chartSeries.minute[sym] ?? [];
            const baseVolume = resolveBaseVolume(minuteBars, simulationEpochMs);
            return buildPseudoOrderBook({
              symbol: sym,
              midPriceRub: effectivePriceRub,
              lotSize: asset.lotSize,
              minuteVolume: baseVolume,
              simulationEpochMs,
              prevBook: asset.orderBook,
              prevEpochMs: asset.orderBookBuiltAtEpochMs || undefined,
            });
          })();
  const orderBookChanged =
    orderBookSignature(asset.orderBook) !== orderBookSignature(nextOrderBook);
  let nextFaceValueRub = asset.faceValueRub;
  let nextNkd = asset.nkdPerBondRub;
  if (asset.isBond) {
    const faceFromDetails = faceValueAtTime(sym, simulationEpochMs, market.details);
    if (faceFromDetails !== null) {
      nextFaceValueRub = faceFromDetails;
    }
    const coupons = market.details.couponsBySymbol[sym] ?? [];
    if (coupons.length > 0) {
      nextNkd = nkdPerBondRubAt(sym, simulationEpochMs, market.details);
    }
  } else {
    nextNkd = 0;
  }
  if (
    !chartChanged &&
    !periodChanged &&
    !orderBookChanged &&
    asset.currentPriceRub === effectivePriceRub &&
    asset.dailyChangePct === dailyChangePct &&
    asset.nkdPerBondRub === nextNkd &&
    asset.faceValueRub === nextFaceValueRub
  ) {
    return false;
  }
  market.assetsBySymbol[sym] = {
    ...asset,
    currentPriceRub: effectivePriceRub,
    dailyChangePct,
    chartLineByTimeframe: lines,
    periodChangePctByTimeframe: nextPeriod,
    orderBook: nextOrderBook,
    orderBookBuiltAtEpochMs: simulationEpochMs,
    nkdPerBondRub: nextNkd,
    faceValueRub: nextFaceValueRub,
  };
  return true;
}

export function applyMarketQuotesForSimulationEpoch(
  market: MarketModuleState,
  simulationEpochMs: number,
  calendar: TradingCalendar | null = null,
  options?: ApplyMarketQuotesOptions
): void {
  // Option A: предвычислить слоты торгового времени один раз на весь тик.
  // Для 50 инструментов экономит 49/50 вызовов buildBackwardIntradaySlots/buildBackwardDailySlots.
  const preSlots =
    calendar && calendar.dayCount > 0
      ? precomputeChartSlotsForEpoch(calendar, simulationEpochMs)
      : null;

  for (const item of market.instrumentCatalog) {
    const sym = item.symbol.toUpperCase();
    if (!symbolMatchesFilter(sym, options)) {
      continue;
    }
    applyQuotesForOneAsset(market, item, simulationEpochMs, calendar, options, preSlots);
  }
  applyMacroSnapshotForEpoch(market.macroSnapshot, simulationEpochMs, market.chartSeries);
}

/** Обновить котировки одного символа (после sync FIREIDX). */
export function refreshQuotesForSymbol(
  market: MarketModuleState,
  symbol: string,
  simulationEpochMs: number,
  calendar: TradingCalendar | null = null,
  options?: ApplyMarketQuotesOptions
): boolean {
  const sym = symbol.toUpperCase();
  // Для FIREIDX пропускаем обновление только если минутная серия ещё пуста
  // (до первого hydrate/rebuild). Как только бары появятся — обновляем chart lines.
  // Прежняя проверка stocksHaveExactMinuteAtEpoch (все акции имеют бар точно в epochMs)
  // ломалась при любом каталоге > 1 акции: условие никогда не выполнялось.
  if (sym === FIREIDX_SYMBOL) {
    const fireidxMinute = market.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
    if (fireidxMinute.length === 0) {
      return false;
    }
  }
  const item = market.instrumentCatalog.find(
    (row) => row.symbol.toUpperCase() === sym
  );
  if (!item) {
    return false;
  }
  return applyQuotesForOneAsset(
    market,
    item,
    simulationEpochMs,
    calendar,
    options
  );
}
