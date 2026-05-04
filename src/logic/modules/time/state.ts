import type { TradingSessionSnapshot } from '@/logic/time/SessionTimelineController';
import type { TimeScalePreset } from '@/logic/simulation/simulationConfig';

export interface TimeModuleState {
  simulationEpochMs: number;
  simulationStartEpochMs: number;
  simulationEndEpochMs: number;
  tradingCalendarReady: boolean;
  currentTradingDayIndex: number;
  currentTradingSession: TradingSessionSnapshot | null;
  nextTradingSession: TradingSessionSnapshot | null;
  gameTime: number;
  timeScale: TimeScalePreset;
  isPaused: boolean;
}

