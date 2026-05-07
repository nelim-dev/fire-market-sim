import { SIMULATED_MS_PER_REAL_SECOND_AT_1X } from '@/data/simulationTimeConfig';

/**
 * Пресеты скорости симуляции (ТЗ: 1x, 10x, 100x, 1000x).
 */
export type TimeScalePreset = 1 | 10 | 100 | 1000;

export const TIME_SCALE_PRESETS: readonly TimeScalePreset[] = [1, 10, 100, 1000];

/**
 * Дискретный шаг симуляции в рыночном времени.
 * UI пока может не использоваться, но логический контракт готов.
 */
export type SimulationStepPreset = '1m' | '5m';

export const SIMULATION_STEP_PRESETS: readonly SimulationStepPreset[] = ['1m', '5m'];

export const SIMULATION_STEP_MS_BY_PRESET: Record<SimulationStepPreset, number> = {
  '1m': 60_000,
  '5m': 300_000,
};

/**
 * Сколько миллисекунд **симуляционного** времени приходится на одну **реальную секунду**
 * накопленного `deltaTime * timeScale` при timeScale = 1.
 * Сейчас: 1 реальная секунда → 1 минута биржи (согласовано с [simulationTimeConfig](src/data/simulationTimeConfig.ts)).
 */
export const SIMULATION_MS_PER_LOGIC_SECOND_AT_1X =
  SIMULATED_MS_PER_REAL_SECOND_AT_1X;
