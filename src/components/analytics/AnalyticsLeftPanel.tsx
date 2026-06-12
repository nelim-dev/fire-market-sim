'use client';

import { useEffect } from 'react';
import { INSTRUMENT_COPY_BY_SYMBOL } from '@/data/instrumentCopyOverrides';
import { formatRub } from '@/components/portfolio/formatRub';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { ANALYTICS_MODEL_TICKERS } from '@/logic/modules/analytics/modelConstants';
import {
  selectAnalyticsPredictFeeRub,
  selectAnalyticsSelectedSymbol,
  selectCanAffordAnalyticsPredict,
  selectCanPredictAnalytics,
} from '@/logic/modules/analytics/selectors';

const BACK_BUTTON_CLASS =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-sky-700/60 hover:bg-zinc-800 hover:text-white';

function displayNameForSymbol(symbol: string): string {
  return INSTRUMENT_COPY_BY_SYMBOL[symbol.toUpperCase()]?.displayName ?? symbol;
}

const ERROR_LABELS: Record<string, string> = {
  insufficient_funds: 'Недостаточно средств на счёте для запроса прогноза.',
  no_previous_trading_day: 'Нет предыдущего торгового дня для сравнения.',
  ml_unavailable: 'ML-сервис недоступен. Запустите приложение через Electron.',
};

function formatErrorMessage(code: string | null): string | null {
  if (!code) {
    return null;
  }
  return ERROR_LABELS[code] ?? code;
}

export function AnalyticsLeftPanel({
  onBackToPortfolio,
}: {
  onBackToPortfolio: () => void;
}) {
  const selectedSymbol = useGameState(selectAnalyticsSelectedSymbol);
  const autoPredictEnabled = useGameState((s) => s.analytics.autoPredictEnabled);
  const analyticsStatus = useGameState((s) => s.analytics.status);
  const errorMessage = useGameState((s) => s.analytics.errorMessage);
  const canPredict = useGameState(selectCanPredictAnalytics);
  const canAfford = useGameState(selectCanAffordAnalyticsPredict);
  const predictFeeRub = selectAnalyticsPredictFeeRub();
  const currentDayMsk = useGameState((s) => s.currentTradingSession?.mskDateYyyymmdd ?? null);
  const lm = gameLoop.getLogicManager();

  useEffect(() => {
    lm.dispatchCommand({ type: 'analytics/bootstrap-prev-day' });
  }, [lm]);

  const predict = () => {
    lm.dispatchCommand({ type: 'analytics/predict-current-day' });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-zinc-100">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Аналитика</h1>
        <button type="button" onClick={onBackToPortfolio} className={`mt-3 ${BACK_BUTTON_CLASS}`}>
          Мой портфель
        </button>
      </div>
      <p className="text-xs leading-snug text-zinc-500">
        Предсказание текущего торгового дня по полному предыдущему дню (21 актив). Не влияет на
        котировки симуляции. Стоимость одного запроса — {formatRub(predictFeeRub)}.
      </p>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {ANALYTICS_MODEL_TICKERS.map((sym) => {
          const active = selectedSymbol === sym;
          return (
            <li key={sym}>
              <button
                type="button"
                onClick={() =>
                  lm.dispatchCommand({
                    type: 'analytics/set-selected-symbol',
                    symbol: sym,
                  })
                }
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  active
                    ? 'bg-sky-900/50 text-sky-100 ring-1 ring-sky-700'
                    : 'bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {displayNameForSymbol(sym)}
              </button>
            </li>
          );
        })}
      </ul>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={autoPredictEnabled}
          onChange={(e) =>
            lm.dispatchCommand({
              type: 'analytics/set-auto-predict',
              enabled: e.target.checked,
            })
          }
          className="rounded border-zinc-600"
        />
        Автопредсказание при смене дня ({formatRub(predictFeeRub)} за день)
      </label>
      <button
        type="button"
        disabled={!canPredict}
        onClick={predict}
        className="rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {analyticsStatus === 'loading'
          ? 'Предсказание…'
          : `Предсказать (${formatRub(predictFeeRub)})`}
      </button>
      {!canAfford && currentDayMsk && analyticsStatus !== 'loading' ? (
        <p className="text-[11px] text-amber-400/90">
          На счёте недостаточно средств. Нужно минимум {formatRub(predictFeeRub)}.
        </p>
      ) : null}
      {!canPredict && canAfford && currentDayMsk && analyticsStatus !== 'loading' ? (
        <p className="text-[11px] text-zinc-500">
          Недоступно: нет предыдущего торгового дня или идёт загрузка данных.
        </p>
      ) : null}
      {analyticsStatus === 'error' && errorMessage ? (
        <p className="text-xs text-red-400">{formatErrorMessage(errorMessage)}</p>
      ) : null}
    </div>
  );
}
