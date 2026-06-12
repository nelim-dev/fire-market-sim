import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameState } from '@/logic/managers/LogicManager';
import { buildDemoPortfolio } from '@/data/portfolio/buildDemoPortfolio';
import { ANALYTICS_PREDICT_FEE_RUB } from '../modelConstants';
import { AnalyticsModuleService } from '../service';
import { createInitialAnalyticsState } from '../state';

function minimalGameState(cashRub = 1_000_000): GameState {
  return {
    simulationEpochMs: 1_700_000_000_000,
    simulationStartEpochMs: 0,
    simulationEndEpochMs: 0,
    tradingCalendarReady: true,
    currentTradingDayIndex: 5,
    currentTradingSession: {
      mskDateYyyymmdd: '20240604',
      sessionStartEpochMs: 0,
      sessionEndEpochMs: 0,
      dayIndex: 5,
    },
    nextTradingSession: null,
    gameTime: 0,
    timeScale: 1,
    simulationStep: '1m',
    isPaused: false,
    currentUser: null,
    portfolio: { ...buildDemoPortfolio(), cashRub },
    market: { chartSeries: { minute: {}, dailyClose: {} } } as GameState['market'],
    trading: {} as GameState['trading'],
    education: {} as GameState['education'],
    uiState: {} as GameState['uiState'],
    persistence: {} as GameState['persistence'],
    settings: {} as GameState['settings'],
    analytics: {
      ...createInitialAnalyticsState(),
      retainedPrevDayMsk: '20240603',
    },
  };
}

describe('AnalyticsModuleService', () => {
  it('set-selected-symbol updates analytics only', () => {
    const svc = new AnalyticsModuleService();
    const state = minimalGameState();
    const minuteBefore = state.market.chartSeries.minute;
    const changed = svc.handleCommand(
      state,
      { type: 'analytics/set-selected-symbol', symbol: 'SBER' },
      { emit: () => {}, dispatchCommand: () => {} }
    );
    assert.equal(changed, true);
    assert.equal(state.analytics.selectedSymbol, 'SBER');
    assert.equal(state.market.chartSeries.minute, minuteBefore);
  });

  it('predict-current-day rejects when cash is below fee', () => {
    const svc = new AnalyticsModuleService();
    const state = minimalGameState(ANALYTICS_PREDICT_FEE_RUB - 1);
    const debits: unknown[] = [];
    const changed = svc.handleCommand(
      state,
      { type: 'analytics/predict-current-day' },
      {
        emit: () => {},
        dispatchCommand: (cmd) => {
          debits.push(cmd);
        },
      }
    );
    assert.equal(changed, false);
    assert.equal(state.analytics.errorMessage, 'insufficient_funds');
    assert.equal(debits.length, 0);
  });

  it('predict-current-day debits fee before loading', () => {
    const svc = new AnalyticsModuleService();
    // runPredict ходит в Electron IPC — в unit-тесте не вызываем.
    Object.assign(svc, { runPredict: async () => {} });
    const state = minimalGameState(ANALYTICS_PREDICT_FEE_RUB);
    const debits: unknown[] = [];
    const changed = svc.handleCommand(
      state,
      { type: 'analytics/predict-current-day' },
      {
        emit: () => {},
        dispatchCommand: (cmd) => {
          debits.push(cmd);
        },
      }
    );
    assert.equal(changed, true);
    assert.equal(state.analytics.status, 'loading');
    assert.equal(debits.length, 1);
    assert.equal((debits[0] as { type: string }).type, 'portfolio/debit-cash');
    assert.equal((debits[0] as { amountRub: number }).amountRub, ANALYTICS_PREDICT_FEE_RUB);
  });
});
