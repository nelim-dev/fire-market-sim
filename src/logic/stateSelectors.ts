import type { GameState } from '@/logic/managers/LogicManager';
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

