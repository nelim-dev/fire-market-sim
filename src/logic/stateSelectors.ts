import type { GameState } from '@/logic/managers/LogicManager';
import {
  selectMarketCatalogGroupedByKind,
  selectMarketCatalogSectionsOrdered,
  selectMarketHasInstrumentsOfKind,
  selectMarketInstrumentCatalog,
  selectMarketInstrumentsByAssetKind,
  selectMarketMacroSnapshot,
  selectMarketModule,
  selectMarketReady,
} from '@/logic/modules/market/selectors';
import {
  selectTimeIsPaused,
  selectTimeScalePreset,
  selectTimeSimulationEpochMs,
} from '@/logic/modules/time/selectors';

export const selectSimulationEpochMs = (state: GameState): number =>
  selectTimeSimulationEpochMs(state);

export const selectIsPaused = (state: GameState): boolean =>
  selectTimeIsPaused(state);

export const selectTimeScale = (state: GameState): GameState['timeScale'] =>
  selectTimeScalePreset(state);

export const selectPortfolio = (state: GameState): GameState['portfolio'] =>
  state.portfolio;

export const selectMarket = selectMarketModule;

export const selectMarketCatalog = selectMarketInstrumentCatalog;

export { selectMarketReady };

export const selectMacroSnapshot = selectMarketMacroSnapshot;

export {
  selectMarketCatalogGroupedByKind,
  selectMarketCatalogSectionsOrdered,
  selectMarketHasInstrumentsOfKind,
  selectMarketInstrumentsByAssetKind,
};

