import type { TimeModuleState } from './state';

export const selectTimeSimulationEpochMs = (state: TimeModuleState): number =>
  state.simulationEpochMs;

export const selectTimeIsPaused = (state: TimeModuleState): boolean =>
  state.isPaused;

export const selectTimeScalePreset = (
  state: TimeModuleState
): TimeModuleState['timeScale'] => state.timeScale;

export const selectSimulationStepPreset = (
  state: TimeModuleState
): TimeModuleState['simulationStep'] => state.simulationStep;

