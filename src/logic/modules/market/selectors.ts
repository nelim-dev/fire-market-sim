import type { GameState } from '@/logic/managers/LogicManager';
import type { AssetKind, MarketInstrumentCatalogItem } from './contracts';
import {
  catalogSectionsInDisplayOrder,
  groupInstrumentsByAssetKind,
} from './catalogSort';
import type { MarketMacroSnapshot } from './macro';
import type { MarketAssetState, MarketModuleState } from './state';

export const selectMarketModule = (state: GameState): MarketModuleState =>
  state.market;

export const selectMarketReady = (state: GameState): boolean =>
  state.market.ready;

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
