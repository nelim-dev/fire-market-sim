import type {
  SimulationStepPreset,
  TimeScalePreset,
} from '@/logic/simulation/simulationConfig';

export type RuntimeCommand =
  | { type: 'runtime/pause' }
  | { type: 'runtime/resume' }
  | { type: 'runtime/set-time-scale'; preset: TimeScalePreset }
  | { type: 'runtime/set-simulation-step'; preset: SimulationStepPreset };

