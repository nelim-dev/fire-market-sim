import type { GameState } from '@/logic/managers/LogicManager';
import { ANALYTICS_MODEL_TICKERS, ANALYTICS_PREDICT_FEE_RUB } from './modelConstants';
import { computePredictedCloseRange } from './predictionDayStats';
import type { AnalyticsModuleState } from './state';
import type { PredictedCloseRange } from './predictionDayStats';

export function selectAnalyticsState(state: GameState): AnalyticsModuleState {
  return state.analytics;
}

export function selectAnalyticsSelectedSymbol(state: GameState): string {
  return state.analytics.selectedSymbol;
}

export function selectAnalyticsPrediction(state: GameState): AnalyticsModuleState['prediction'] {
  return state.analytics.prediction;
}

export function selectAnalyticsModelTickers(): readonly string[] {
  return ANALYTICS_MODEL_TICKERS;
}

export function selectAnalyticsPredictFeeRub(): number {
  return ANALYTICS_PREDICT_FEE_RUB;
}

export function selectCanAffordAnalyticsPredict(state: GameState): boolean {
  return state.portfolio.cashRub >= ANALYTICS_PREDICT_FEE_RUB;
}

export function selectCanPredictAnalytics(state: GameState): boolean {
  return (
    state.currentTradingDayIndex > 0 &&
    state.analytics.retainedPrevDayMsk !== null &&
    state.analytics.status !== 'loading' &&
    selectCanAffordAnalyticsPredict(state)
  );
}

export function selectPredictedCloseRangeForSymbol(
  state: GameState,
  symbol: string
): PredictedCloseRange | null {
  const bars = state.analytics.prediction?.predictedFiveMinBySymbol[symbol.toUpperCase()];
  if (!bars?.length) {
    return null;
  }
  return computePredictedCloseRange(bars);
}
