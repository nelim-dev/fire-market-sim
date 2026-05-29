import type { GameState } from '@/logic/managers/LogicManager';
import type { AssetKind, MarketInstrumentCatalogItem } from './contracts';
import {
  catalogSectionsInDisplayOrder,
  groupInstrumentsByAssetKind,
} from './catalogSort';
import { isInstrumentActiveOnMarket } from './instrumentLifecycle';
import type { MarketMacroSnapshot } from './macro';
import type { MarketAssetState, MarketModuleState } from './state';

export const selectMarketModule = (state: GameState): MarketModuleState =>
  state.market;

export const selectMarketReady = (state: GameState): boolean =>
  state.market.ready;

/** Листинг / погашение: виден в обзоре рынка и доступен для торговли (кроме index). */
export const selectIsInstrumentActiveOnMarket =
  (symbol: string) =>
  (state: GameState): boolean =>
    isInstrumentActiveOnMarket(
      state.market,
      symbol,
      state.simulationEpochMs
    );

/**
 * Каталог инструментов в стабильном порядке: `assetKind`, затем `ticker`
 * (нормализуется при создании `MarketModuleState`, см. `createMarketModuleState`).
 */
export const selectMarketInstrumentCatalog = (
  state: GameState
): readonly MarketInstrumentCatalogItem[] =>
  state.market.instrumentCatalog;

export const selectMarketAssetsBySymbol = (state: GameState) =>
  state.market.assetsBySymbol;

export const selectMarketAsset =
  (symbol: string) =>
  (state: GameState): MarketAssetState | undefined =>
    state.market.assetsBySymbol[symbol.toUpperCase()];

export const selectMarketMacroSnapshot = (
  state: GameState
): MarketMacroSnapshot => state.market.macroSnapshot;

/** Инструменты одного типа актива (порядок — по тикеру, т.к. каталог уже отсортирован). */
export const selectMarketInstrumentsByAssetKind =
  (assetKind: AssetKind) =>
  (state: GameState): readonly MarketInstrumentCatalogItem[] =>
    state.market.instrumentCatalog.filter((item) => item.assetKind === assetKind);

export const selectMarketHasInstrumentsOfKind =
  (assetKind: AssetKind) =>
  (state: GameState): boolean =>
    state.market.instrumentCatalog.some((item) => item.assetKind === assetKind);

/** Группировка по `assetKind` для таблиц/фильтров UI. */
export const selectMarketCatalogGroupedByKind = (
  state: GameState
): Record<AssetKind, MarketInstrumentCatalogItem[]> =>
  groupInstrumentsByAssetKind(state.market.instrumentCatalog);

/**
 * Секции каталога в порядке, заданном `MARKET_ASSET_KIND_SECTION_ORDER`
 * (акции → облигации → фонды → индексы, как в ТЗ по группам портфеля).
 */
export const selectMarketCatalogSectionsOrdered = (
  state: GameState
): Array<{ assetKind: AssetKind; items: readonly MarketInstrumentCatalogItem[] }> =>
  catalogSectionsInDisplayOrder(
    groupInstrumentsByAssetKind(state.market.instrumentCatalog)
  );

export const selectCompositeIndex = (state: GameState) =>
  state.market.compositeIndex;

export type InstrumentPayoutRow =
  | {
      kind: 'dividend';
      dateEpochMs: number;
      amountRub: number;
      currency: string;
    }
  | {
      kind: 'coupon';
      dateEpochMs: number;
      amountRub: number;
      currency: string;
    };

export function selectInstrumentPayoutHistory(
  symbol: string,
  simulationEpochMs: number,
  state: GameState
): InstrumentPayoutRow[] {
  const sym = symbol.toUpperCase();
  const asset = state.market.assetsBySymbol[sym];
  const details = state.market.details;
  if (!asset) {
    return [];
  }
  if (asset.isBond) {
    const coupons = details.couponsBySymbol[sym] ?? [];
    return coupons
      .filter((c) => c.payDateEpochMs <= simulationEpochMs)
      .map((c) => ({
        kind: 'coupon' as const,
        dateEpochMs: c.payDateEpochMs,
        amountRub: c.perBondRub,
        currency: 'RUB',
      }))
      .sort((a, b) => b.dateEpochMs - a.dateEpochMs);
  }
  const divs = details.dividendsBySymbol[sym] ?? [];
  return divs
    .filter((d) => d.recordCloseDateEpochMs <= simulationEpochMs)
    .map((d) => ({
      kind: 'dividend' as const,
      dateEpochMs: d.recordCloseDateEpochMs,
      amountRub: d.perShareRub,
      currency: d.currency,
    }))
    .sort((a, b) => b.dateEpochMs - a.dateEpochMs);
}
