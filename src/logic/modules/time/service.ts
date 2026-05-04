import type { TradingDayChangedPayload } from '@/logic/logicEvents';
import { TRADING_DAY_CHANGED } from '@/logic/logicEvents';
import { SIMULATION_MS_PER_LOGIC_SECOND_AT_1X } from '@/logic/simulation/simulationConfig';
import {
  SessionTimelineController,
  toSessionSnapshot,
} from '@/logic/time/SessionTimelineController';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
} from '@/logic/modules/contracts';
import type { TimeModuleState } from './state';

export class TimeModuleService implements LogicModule<TimeModuleState> {
  readonly id = 'time';

  constructor(private readonly sessionTimeline: SessionTimelineController) {}

  createInitialState(): TimeModuleState {
    this.sessionTimeline.reset();
    const ready = this.sessionTimeline.isReady();
    const start = this.sessionTimeline.getGlobalStartEpochMs();
    const end = this.sessionTimeline.getGlobalEndEpochMs();
    const cur = toSessionSnapshot(this.sessionTimeline.getCurrentDay());
    const nxt = toSessionSnapshot(this.sessionTimeline.getNextDay());
    return {
      tradingCalendarReady: ready,
      simulationStartEpochMs: start,
      simulationEpochMs: start,
      simulationEndEpochMs: end,
      currentTradingDayIndex: 0,
      currentTradingSession: cur,
      nextTradingSession: nxt,
      gameTime: 0,
      timeScale: 1,
      isPaused: false,
    };
  }

  update(
    state: TimeModuleState,
    deltaTime: number,
    context: ModuleContext
  ): void {
    if (state.isPaused) {
      return;
    }

    if (!state.tradingCalendarReady) {
      return;
    }

    const scaledDeltaTime = deltaTime * state.timeScale;
    const deltaSimMs =
      scaledDeltaTime * SIMULATION_MS_PER_LOGIC_SECOND_AT_1X;
    const { epochMs, dayChanged } = this.sessionTimeline.advance(
      state.simulationEpochMs,
      deltaSimMs
    );
    state.simulationEpochMs = epochMs;
    state.currentTradingDayIndex = this.sessionTimeline.getDayIndex();

    if (dayChanged) {
      state.currentTradingSession = toSessionSnapshot(
        this.sessionTimeline.getCurrentDay()
      );
      state.nextTradingSession = toSessionSnapshot(
        this.sessionTimeline.getNextDay()
      );
      const cur = this.sessionTimeline.getCurrentDay();
      const payload: TradingDayChangedPayload = {
        mskDateYyyymmdd: cur?.mskDateYyyymmdd ?? '',
        dayIndex: state.currentTradingDayIndex,
      };
      context.emit(TRADING_DAY_CHANGED, payload);
      this.sessionTimeline.schedulePrefetchNextSession();
    }

    state.gameTime = Math.max(
      0,
      (state.simulationEpochMs - state.simulationStartEpochMs) / 1000
    );
  }

  handleCommand(
    state: TimeModuleState,
    command: LogicCommand
  ): boolean {
    switch (command.type) {
      case 'runtime/pause':
        state.isPaused = true;
        return true;
      case 'runtime/resume':
        state.isPaused = false;
        return true;
      case 'runtime/set-time-scale':
        state.timeScale = command.preset;
        return true;
      default:
        return false;
    }
  }
}

