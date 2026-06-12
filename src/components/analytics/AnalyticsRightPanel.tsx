'use client';

import { useMemo } from 'react';
import { INSTRUMENT_COPY_BY_SYMBOL } from '@/data/instrumentCopyOverrides';
import { formatRub } from '@/components/portfolio/formatRub';
import { MarketCloseLineChart } from '@/components/market/MarketCloseLineChart';
import { useGameState } from '@/hooks/useGameState';
import { fiveMinuteBarsToMinuteChartPoints } from '@/logic/modules/analytics/predictionToBars';
import {
  analyticsChartBarsForDisplay,
  analyticsDisplayCloseRub,
} from '@/logic/modules/analytics/displayPrice';
import {
  selectAnalyticsPrediction,
  selectAnalyticsSelectedSymbol,
  selectPredictedCloseRangeForSymbol,
} from '@/logic/modules/analytics/selectors';

function displayNameForSymbol(symbol: string): string {
  return INSTRUMENT_COPY_BY_SYMBOL[symbol.toUpperCase()]?.displayName ?? symbol;
}

function formatPredictedPrice(symbol: string, price: number): string {
  const display = analyticsDisplayCloseRub(symbol, price);
  return display >= 100 ? formatRub(display) : `${display.toFixed(2).replace('.', ',')}\u00a0₽`;
}

export function AnalyticsRightPanel() {
  const selectedSymbol = useGameState(selectAnalyticsSelectedSymbol);
  const prediction = useGameState(selectAnalyticsPrediction);
  const closeRange = useGameState((s) => selectPredictedCloseRangeForSymbol(s, selectedSymbol));
  const currentDayMsk = useGameState((s) => s.currentTradingSession?.mskDateYyyymmdd ?? null);

  const chartData = useMemo(() => {
    const sym = selectedSymbol.toUpperCase();
    if (!prediction) {
      return { prev: [] as const, pred: [] as const };
    }
    const prev5 = prediction.prevDayFiveMinBySymbol[sym] ?? [];
    const pred5 = prediction.predictedFiveMinBySymbol[sym] ?? [];
    return {
      prev: analyticsChartBarsForDisplay(sym, fiveMinuteBarsToMinuteChartPoints(prev5)),
      pred: analyticsChartBarsForDisplay(sym, fiveMinuteBarsToMinuteChartPoints(pred5)),
    };
  }, [selectedSymbol, prediction]);

  const priceGuides = useMemo(() => {
    if (!closeRange) {
      return undefined;
    }
    return [
      {
        price: analyticsDisplayCloseRub(selectedSymbol, closeRange.maxClose),
        tone: 'max' as const,
      },
      {
        price: analyticsDisplayCloseRub(selectedSymbol, closeRange.minClose),
        tone: 'min' as const,
      },
    ];
  }, [closeRange, selectedSymbol]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0">
        <h3 className="text-base font-semibold text-zinc-100">
          {displayNameForSymbol(selectedSymbol)}
        </h3>
        <p className="text-xs text-zinc-500">
          {prediction
            ? `Реальный день ${prediction.sourceDayMsk} → предсказание ${prediction.targetDayMsk}`
            : currentDayMsk
              ? `Текущий день симуляции: ${currentDayMsk}`
              : '—'}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <p className="shrink-0 text-xs text-zinc-500">
          Две линии на одном графике: реальная динамика предыдущего торгового дня и предсказанная
          траектория следующего дня (цена закрытия, 1 мин).
        </p>
        <div className="mt-3 flex h-[calc(100vh-15rem)] min-h-[380px] w-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
          <MarketCloseLineChart
            points={chartData.prev}
            overlayPoints={chartData.pred}
            timeframe="1d"
            hideFooterHint
            priceGuides={priceGuides}
          />
        </div>
        <div className="mt-2 shrink-0 flex flex-wrap gap-4 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-sky-400" />
            Реальный предыдущий день
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-emerald-400" />
            Предсказание текущего дня
          </span>
          {closeRange ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t border-dashed border-amber-400" />
                Ожидаемый максимум
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t border-dashed border-violet-400" />
                Ожидаемый минимум
              </span>
            </>
          ) : null}
        </div>
        {prediction && closeRange ? (
          <div className="mt-4 shrink-0 grid gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Прогноз на {prediction.targetDayMsk}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <p className="text-zinc-200">
                <span className="text-zinc-500">Ожидаемый максимум (close): </span>
                <span className="font-mono text-amber-200">
                  {formatPredictedPrice(selectedSymbol, closeRange.maxClose)}
                </span>
              </p>
              <p className="text-zinc-200">
                <span className="text-zinc-500">Ожидаемый минимум (close): </span>
                <span className="font-mono text-violet-200">
                  {formatPredictedPrice(selectedSymbol, closeRange.minClose)}
                </span>
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
