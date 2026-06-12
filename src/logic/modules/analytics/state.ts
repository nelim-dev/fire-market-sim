import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';

export type AnalyticsPredictionStatus = 'idle' | 'loading' | 'ready' | 'error';

export type PredictionSnapshot = {
  targetDayMsk: string;
  sourceDayMsk: string;
  predictedAtEpochMs: number;
  /** 5m bars per symbol for predicted current day. */
  predictedFiveMinBySymbol: Record<string, readonly MarketPriceBar[]>;
  /** 5m bars per symbol for real previous day (chart overlay). */
  prevDayFiveMinBySymbol: Record<string, readonly MarketPriceBar[]>;
};

/** Serialized 107×5 unscaled OHLCV per symbol (prepare_raw last_known). */
export type PersistedLastKnownSession = readonly (readonly number[])[];

export interface AnalyticsModuleState {
  selectedSymbol: string;
  autoPredictEnabled: boolean;
  status: AnalyticsPredictionStatus;
  errorMessage: string | null;
  /** Only the latest prediction kept in RAM. */
  prediction: PredictionSnapshot | null;
  retainedPrevDayMsk: string | null;
  retainedPrevDayFiveMinBySymbol: Record<string, readonly MarketPriceBar[]> | null;
  /** Cross-day last_known through `lastKnownBuiltThroughMsk` (incremental fold). */
  lastKnownSessionBySymbol: Record<string, PersistedLastKnownSession | null> | null;
  lastKnownBuiltThroughMsk: string | null;
}

export function createInitialAnalyticsState(): AnalyticsModuleState {
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
