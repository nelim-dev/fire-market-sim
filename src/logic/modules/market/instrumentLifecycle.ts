import { FIREIDX_SYMBOL } from './compositeIndex';
import { lastBarIndexAtOrBefore } from './priceSeries';
import type { MarketModuleState } from './state';

/**
 * Первая минутная котировка: из каталога метаданных или первый бар после гидратации.
 */
export function resolveFirstTradeEpochMs(
  symbol: string,
  market: MarketModuleState
): number | null {
  const sym = symbol.toUpperCase();
  const fromMeta =
    market.details.instrumentMetaBySymbol[sym]?.firstTradeEpochMs ?? null;
  if (fromMeta != null && Number.isFinite(fromMeta)) {
    return fromMeta;
  }
  const minute = market.chartSeries.minute[sym] ?? [];
  if (minute.length > 0) {
    return minute[0]!.t;
  }
  return null;
}

/**
 * Инструмент торгуется / отображается в обзоре рынка на эпоху симуляции:
 * - до листинга (нет котировок) — скрыт;
 * - после погашения облигации — скрыт;
 * - FIREIDX — всегда виден.
 */
export function isInstrumentActiveOnMarket(
  market: MarketModuleState,
  symbol: string,
  epochMs: number
): boolean {
  const sym = symbol.toUpperCase();
  if (sym === FIREIDX_SYMBOL) {
    return true;
  }

  const asset = market.assetsBySymbol[sym];
  const meta = market.details.instrumentMetaBySymbol[sym];
  const maturityEpochMs =
    asset?.maturityEpochMs ?? meta?.maturityEpochMs ?? null;
  if (maturityEpochMs != null && epochMs >= maturityEpochMs) {
    return false;
  }

  const firstTradeEpochMs = resolveFirstTradeEpochMs(sym, market);
  if (firstTradeEpochMs != null) {
    return epochMs >= firstTradeEpochMs;
  }

  const minute = market.chartSeries.minute[sym] ?? [];
  if (minute.length > 0) {
    return lastBarIndexAtOrBefore(minute, epochMs) >= 0;
  }

  const isBond = asset?.isBond ?? meta?.isBond ?? false;
  return !isBond;
}
