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
  selectIsInstrumentActiveOnMarket,
} from '@/logic/modules/market/selectors';
import { selectPortfolioTradeLedger } from '@/logic/modules/portfolio/selectors';
import { selectEducationIsSymbolUnlocked } from '@/logic/modules/education/selectors';
import {
  selectMarketOverviewRows,
  selectUiLeftPanelMode,
  selectUiMarketOverviewFilters,
  selectUiSelectedSymbol,
} from '@/logic/modules/uiState/selectors';
import {
  selectSimulationStepPreset,
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

export const selectSimulationStep = (
  state: GameState
): GameState['simulationStep'] => selectSimulationStepPreset(state);

export const selectPortfolio = (state: GameState): GameState['portfolio'] =>
  state.portfolio;

export const selectTradeLedger = (state: GameState) =>
  selectPortfolioTradeLedger(state.portfolio);

export const selectTradingState = (state: GameState) => state.trading;

export const selectMarket = selectMarketModule;

export const selectMarketCatalog = selectMarketInstrumentCatalog;

export { selectMarketReady };

export const selectMacroSnapshot = selectMarketMacroSnapshot;

export {
  selectMarketCatalogGroupedByKind,
  selectMarketCatalogSectionsOrdered,
  selectMarketHasInstrumentsOfKind,
  selectMarketInstrumentsByAssetKind,
  selectIsInstrumentActiveOnMarket,
};

export {
  selectEducationIsSymbolUnlocked,
  selectUiLeftPanelMode,
  selectUiSelectedSymbol,
  selectUiMarketOverviewFilters,
  selectMarketOverviewRows,
};

