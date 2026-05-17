import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import { applyMacroSnapshotForEpoch } from './macroResolve';
import type { MarketAssetState, MarketModuleState } from './state';
import { CHART_TIMEFRAME_IDS } from './chartTimeframes';
import { buildChartLineByTimeframeFromBundle } from './chartWindows';
import {
  computePeriodReturnPct,
  computePriceAndDailyChange,
  lastBarIndexAtOrBefore,
} from './priceSeries';
import type { MarketPriceBar } from './priceSeries';
import { faceValueAtTime, nkdPerBondRubAt } from './instrumentDetails';

const PSEUDO_ORDERBOOK_QTY = 1_000;

/**
 * Эффективный face value на момент `t`: сначала из details (с учётом амортизаций),
 * иначе — fallback на текущее значение asset.faceValueRub.
 */
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

/**
 * Нормализация цены бонда: бары приходят в % от номинала (MOEX), и для торговли надо ₽.
 * Применяется только к бондам с известным faceValue на момент `t`.
 */
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

/** Обновляет цену, дневное изменение, графики и НКД (для бондов) по всем инструментам.
 *
 * `calendar` нужен для построения окна графика в торговом времени
 * (см. `buildChartLineByTimeframeFromBundle`). Если не передан — chart-провайдер
 * сделает безопасный fallback на «последние N баров», чтобы UI не падал.
 */
export function applyMarketQuotesForSimulationEpoch(
  market: MarketModuleState,
  simulationEpochMs: number,
  calendar: TradingCalendar | null = null
): void {
  for (const item of market.instrumentCatalog) {
    const sym = item.symbol.toUpperCase();
    const minute = market.chartSeries.minute[sym] ?? [];
    const daily = market.chartSeries.dailyClose[sym] ?? [];
    const asset = market.assetsBySymbol[sym];
    if (!asset) {
      continue;
    }
    const minuteLastIdx = lastBarIndexAtOrBefore(minute, simulationEpochMs);
    const minutePricePct = minuteLastIdx >= 0 ? minute[minuteLastIdx].c : null;
    const lastIdx = lastBarIndexAtOrBefore(daily, simulationEpochMs);
    const { currentPriceRub: dailyPricePct, dailyChangePct } = computePriceAndDailyChange(
      daily,
      lastIdx
    );
    // Для бондов: бары приходят в % от номинала и нормализуются → ₽.
    // asset.currentPriceRub уже хранится в ₽ (нормализованной форме),
    // поэтому повторно нормализовать его нельзя — это удваивает множитель face/100.
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
      calendar
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
    const nextOrderBook = {
      bids: [{ priceRub: effectivePriceRub, qty: PSEUDO_ORDERBOOK_QTY }],
      asks: [{ priceRub: effectivePriceRub, qty: PSEUDO_ORDERBOOK_QTY }],
    };
    const orderBookChanged =
      asset.orderBook.bids[0]?.priceRub !== nextOrderBook.bids[0]?.priceRub ||
      asset.orderBook.bids[0]?.qty !== nextOrderBook.bids[0]?.qty ||
      asset.orderBook.asks[0]?.priceRub !== nextOrderBook.asks[0]?.priceRub ||
      asset.orderBook.asks[0]?.qty !== nextOrderBook.asks[0]?.qty;
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
      continue;
    }
    market.assetsBySymbol[sym] = {
      ...asset,
      currentPriceRub: effectivePriceRub,
      dailyChangePct,
      chartLineByTimeframe: lines,
      periodChangePctByTimeframe: nextPeriod,
      orderBook: nextOrderBook,
      nkdPerBondRub: nextNkd,
      faceValueRub: nextFaceValueRub,
    };
  }
  applyMacroSnapshotForEpoch(market.macroSnapshot, simulationEpochMs, market.chartSeries);
}
