import type { TradingDayRecord } from '@/data/domain/TradingDaySession';
import tradingCalendarJson from '@/data/generated/tradingCalendar.json';
import type { GameState } from '@/logic/managers/LogicManager';
import type { LogicEventMap } from '@/logic/logicEvents';
import type { LogicCommand, LogicModule, ModuleContext } from '@/logic/modules/contracts';
import { TradingCalendar } from '@/logic/time/TradingCalendar';
import {
  fetchDaySlicesFromElectron,
  fetchLastKnownSeedFromElectron,
  predictDayFromElectron,
} from './analyticsElectronBridge';
import type { AnalyticsCommand } from './commands';
import {
  ensureLastKnownThroughMsk,
  applyLastKnownSeed,
  previousTradingDayMsk,
} from './crossDayLastKnown';
import { ANALYTICS_MODEL_TICKERS, ANALYTICS_PREDICT_FEE_RUB } from './modelConstants';
import {
  assertFullModelInputTensor,
  buildModelDayTensorFromDayBundle,
  type DayMinuteBundle,
  type LastKnownSessionBySymbol,
} from './modelDayTensor';
import { tensorToFiveMinuteBarsBySymbol } from './predictionToBars';
import type { AnalyticsModuleState, PredictionSnapshot } from './state';

const calendar = TradingCalendar.fromRecords(
  (tradingCalendarJson as { days: TradingDayRecord[] }).days ?? []
);

function persistedToLastKnown(
  raw: AnalyticsModuleState['lastKnownSessionBySymbol']
): LastKnownSessionBySymbol | null {
  if (!raw) {
    return null;
  }
  const out: LastKnownSessionBySymbol = {};
  for (const [sym, session] of Object.entries(raw)) {
    if (!session) {
      out[sym] = null;
      continue;
    }
    out[sym] = session.map(
      (row) => [row[0], row[1], row[2], row[3], row[4]] as [number, number, number, number, number]
    );
  }
  return out;
}

function lastKnownToPersisted(
  state: LastKnownSessionBySymbol
): NonNullable<AnalyticsModuleState['lastKnownSessionBySymbol']> {
  const out: NonNullable<AnalyticsModuleState['lastKnownSessionBySymbol']> = {};
  for (const [sym, session] of Object.entries(state)) {
    out[sym] = session ? session.map((row) => [...row]) : null;
  }
  return out;
}

export class AnalyticsModuleService implements LogicModule<GameState> {
  readonly id = 'analytics';

  private notifyHook: (() => void) | null = null;
  private predictInFlight = false;

  setNotifyHook(hook: () => void): void {
    this.notifyHook = hook;
  }

  createInitialState(): AnalyticsModuleState {
    return {
      selectedSymbol: 'GAZP',
      autoPredictEnabled: false,
      status: 'idle',
      errorMessage: null,
      prediction: null,
      retainedPrevDayMsk: null,
      retainedPrevDayFiveMinBySymbol: null,
      lastKnownSessionBySymbol: null,
      lastKnownBuiltThroughMsk: null,
    };
  }

  update(): void {
    // On-demand predict only; no per-tick work.
  }

  onTradingDayChanged(
    state: GameState,
    payload: LogicEventMap['TRADING_DAY_CHANGED'],
    context: ModuleContext
  ): void {
    void this.refreshRetainedPrevDay(state, payload.dayIndex);
    if (state.analytics.autoPredictEnabled) {
      this.beginPredict(state, context, { silentOnInsufficientFunds: true });
    }
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    context: ModuleContext
  ): boolean {
    if (!command.type.startsWith('analytics/')) {
      return false;
    }
    const cmd = command as AnalyticsCommand;
    switch (cmd.type) {
      case 'analytics/set-selected-symbol': {
        const sym = cmd.symbol.toUpperCase();
        if (!ANALYTICS_MODEL_TICKERS.includes(sym as (typeof ANALYTICS_MODEL_TICKERS)[number])) {
          return false;
        }
        if (state.analytics.selectedSymbol === sym) {
          return false;
        }
        state.analytics.selectedSymbol = sym;
        return true;
      }
      case 'analytics/set-auto-predict': {
        if (state.analytics.autoPredictEnabled === cmd.enabled) {
          return false;
        }
        state.analytics.autoPredictEnabled = cmd.enabled;
        return true;
      }
      case 'analytics/bootstrap-prev-day': {
        void this.refreshRetainedPrevDay(state, state.currentTradingDayIndex);
        return false;
      }
      case 'analytics/predict-current-day': {
        return this.beginPredict(state, context);
      }
      case 'analytics/prediction-complete': {
        state.analytics.prediction = cmd.prediction;
        state.analytics.status = 'ready';
        state.analytics.errorMessage = null;
        return true;
      }
      case 'analytics/prediction-failed': {
        state.analytics.status = 'error';
        state.analytics.errorMessage = cmd.error;
        return true;
      }
      default:
        return false;
    }
  }

  private mskDateAtDayIndex(dayIndex: number): string | null {
    const day = calendar.getDay(dayIndex);
    return day?.mskDateYyyymmdd ?? null;
  }

  private async loadAnalyticsDayBundle(mskDate: string): Promise<DayMinuteBundle | null> {
    const bundle = await fetchDaySlicesFromElectron(mskDate, ANALYTICS_MODEL_TICKERS);
    if (!bundle) {
      return null;
    }
    const out: DayMinuteBundle = {};
    for (const sym of ANALYTICS_MODEL_TICKERS) {
      out[sym] = bundle.minute[sym] ?? [];
    }
    return out;
  }

  private async refreshRetainedPrevDay(
    state: GameState,
    currentDayIndex: number
  ): Promise<void> {
    const prevIdx = currentDayIndex - 1;
    if (prevIdx < 0) {
      state.analytics.retainedPrevDayMsk = null;
      state.analytics.retainedPrevDayFiveMinBySymbol = null;
      this.notifyHook?.();
      return;
    }
    const prevMsk = this.mskDateAtDayIndex(prevIdx);
    if (!prevMsk) {
      return;
    }
    state.analytics.retainedPrevDayMsk = prevMsk;
    state.analytics.retainedPrevDayFiveMinBySymbol = null;
    this.notifyHook?.();
  }

  private beginPredict(
    state: GameState,
    context: ModuleContext,
    opts?: { silentOnInsufficientFunds?: boolean }
  ): boolean {
    if (this.predictInFlight || state.currentTradingDayIndex <= 0) {
      return false;
    }
    if (state.analytics.retainedPrevDayMsk === null) {
      return false;
    }
    if (state.portfolio.cashRub < ANALYTICS_PREDICT_FEE_RUB) {
      if (!opts?.silentOnInsufficientFunds) {
        state.analytics.status = 'error';
        state.analytics.errorMessage = 'insufficient_funds';
      }
      return false;
    }

    context.dispatchCommand({
      type: 'portfolio/debit-cash',
      amountRub: ANALYTICS_PREDICT_FEE_RUB,
      ledgerEntry: {
        id: `analytics-predict-${state.simulationEpochMs}-${Date.now()}`,
        simulationEpochMs: state.simulationEpochMs,
        kind: 'commission',
        ticker: 'ANALYTICS',
        amountRub: -ANALYTICS_PREDICT_FEE_RUB,
        notes: 'Предсказание торгового дня (ML)',
      },
    });

    state.analytics.status = 'loading';
    state.analytics.errorMessage = null;
    void this.runPredict(state);
    return true;
  }

  private async runPredict(state: GameState): Promise<void> {
    if (this.predictInFlight) {
      return;
    }
    this.predictInFlight = true;
    try {
      const targetDayMsk = state.currentTradingSession?.mskDateYyyymmdd ?? null;
      const sourceDayMsk =
        state.analytics.retainedPrevDayMsk ??
        this.mskDateAtDayIndex(state.currentTradingDayIndex - 1);
      if (!targetDayMsk || !sourceDayMsk) {
        state.analytics.status = 'error';
        state.analytics.errorMessage = 'no_previous_trading_day';
        this.notifyHook?.();
        return;
      }

      const dayBeforeSource = previousTradingDayMsk(sourceDayMsk);
      const loadDay = async (msk: string) => {
        const bundle = await this.loadAnalyticsDayBundle(msk);
        if (!bundle) {
          throw new Error(`day_slices_unavailable:${msk}`);
        }
        return bundle;
      };

      let crossDay: LastKnownSessionBySymbol = {};
      const seed = await fetchLastKnownSeedFromElectron(
        sourceDayMsk,
        ANALYTICS_MODEL_TICKERS
      );
      if (dayBeforeSource) {
        const ensured = await ensureLastKnownThroughMsk(
          dayBeforeSource,
          loadDay,
          state.analytics.lastKnownBuiltThroughMsk,
          persistedToLastKnown(state.analytics.lastKnownSessionBySymbol),
          seed
        );
        crossDay = ensured.state;
      } else {
        crossDay = applyLastKnownSeed({}, seed);
      }

      const minuteBySymbol = await loadDay(sourceDayMsk);

      const prevTensor = buildModelDayTensorFromDayBundle(
        minuteBySymbol,
        sourceDayMsk,
        crossDay
      );
      assertFullModelInputTensor(prevTensor);

      const mlRes = await predictDayFromElectron(prevTensor);
      if (!mlRes || !mlRes.ok) {
        state.analytics.status = 'error';
        state.analytics.errorMessage = mlRes && !mlRes.ok ? mlRes.error : 'ml_unavailable';
        this.notifyHook?.();
        return;
      }

      const predictedFiveMin = tensorToFiveMinuteBarsBySymbol(mlRes.next_day, targetDayMsk);
      const prevFiveMin = tensorToFiveMinuteBarsBySymbol(prevTensor, sourceDayMsk);

      const prediction: PredictionSnapshot = {
        targetDayMsk,
        sourceDayMsk,
        predictedAtEpochMs: Date.now(),
        predictedFiveMinBySymbol: predictedFiveMin,
        prevDayFiveMinBySymbol: prevFiveMin,
      };

      const folded = await ensureLastKnownThroughMsk(
        sourceDayMsk,
        loadDay,
        state.analytics.lastKnownBuiltThroughMsk,
        persistedToLastKnown(state.analytics.lastKnownSessionBySymbol),
        seed
      );
      state.analytics.lastKnownSessionBySymbol = lastKnownToPersisted(folded.state);
      state.analytics.lastKnownBuiltThroughMsk = folded.builtThroughMsk;

      state.analytics.prediction = prediction;
      state.analytics.status = 'ready';
      state.analytics.errorMessage = null;
      state.analytics.retainedPrevDayMsk = sourceDayMsk;
      state.analytics.retainedPrevDayFiveMinBySymbol = prevFiveMin;
    } catch (e) {
      state.analytics.status = 'error';
      state.analytics.errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      this.predictInFlight = false;
      this.notifyHook?.();
    }
  }
}
