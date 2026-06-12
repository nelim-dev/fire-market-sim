import type { PredictionSnapshot } from './state';

export type AnalyticsSetSelectedSymbolCommand = {
  type: 'analytics/set-selected-symbol';
  symbol: string;
};

export type AnalyticsSetAutoPredictCommand = {
  type: 'analytics/set-auto-predict';
  enabled: boolean;
};

export type AnalyticsPredictCurrentDayCommand = {
  type: 'analytics/predict-current-day';
};

export type AnalyticsBootstrapPrevDayCommand = {
  type: 'analytics/bootstrap-prev-day';
};

export type AnalyticsPredictionCompleteCommand = {
  type: 'analytics/prediction-complete';
  prediction: PredictionSnapshot;
};

export type AnalyticsPredictionFailedCommand = {
  type: 'analytics/prediction-failed';
  error: string;
};

export type AnalyticsCommand =
  | AnalyticsSetSelectedSymbolCommand
  | AnalyticsSetAutoPredictCommand
  | AnalyticsBootstrapPrevDayCommand
  | AnalyticsPredictCurrentDayCommand
  | AnalyticsPredictionCompleteCommand
  | AnalyticsPredictionFailedCommand;
