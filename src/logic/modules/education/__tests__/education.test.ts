import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameState } from '@/logic/managers/LogicManager';
import { buildDemoPortfolio } from '@/data/portfolio/buildDemoPortfolio';
import { createInitialEducationState } from '../state';
import { EducationModuleService } from '../service';
import {
  computeNewlyUnlockedSymbols,
  isSymbolUnlockedByTests,
  missingTestIdsForSymbol,
  resolveBondTier,
  resolveRequiredTestIds,
  shuffleWithSeed,
} from '../unlockResolver';

function minimalGameState(): GameState {
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
    },
    nextTradingSession: null,
    gameTime: 0,
    timeScale: 1,
    simulationStep: '1m',
    isPaused: false,
    currentUser: null,
    portfolio: buildDemoPortfolio(),
    market: {
      instrumentCatalog: [
        { assetKind: 'bond', ticker: 'SU26207', symbol: 'SU26207RMFS9', displayName: 'ОФЗ', isin: 'X', sourceFilePath: '' },
        { assetKind: 'bond', ticker: 'RU000A0JQCC3', symbol: 'RU000A0JQCC3', displayName: 'Corp', isin: 'Y', sourceFilePath: '' },
        { assetKind: 'stock', ticker: 'GAZP', symbol: 'GAZP', displayName: 'Gazp', isin: 'Z', sourceFilePath: '' },
      ],
    } as GameState['market'],
    trading: {} as GameState['trading'],
    education: createInitialEducationState(),
    uiState: { chartHintsActive: false, leftPanelMode: 'portfolio', portfolioMainTab: 'composition', selectedSymbol: 'GAZP', marketOverview: { searchQuery: '', assetKindFilter: 'all', showAvailable: true, showLocked: true }, ready: true } as GameState['uiState'],
    persistence: {} as GameState['persistence'],
    settings: {} as GameState['settings'],
    analytics: {} as GameState['analytics'],
  };
}

describe('education unlockResolver', () => {
  it('classifies gov vs corporate bonds', () => {
    assert.equal(resolveBondTier('SU26207RMFS9'), 'gov');
    assert.equal(resolveBondTier('RU000A0JQCC3'), 'corporate');
  });

  it('gov bonds require test-1 only', () => {
    const row = { assetKind: 'bond' as const, symbol: 'SU26207RMFS9', ticker: '', displayName: '', isin: '', sourceFilePath: '' };
    assert.deepEqual(resolveRequiredTestIds('SU26207RMFS9', row), ['test-1']);
  });

  it('corporate bonds require test-1 and test-2', () => {
    const row = { assetKind: 'bond' as const, symbol: 'RU000A0JQCC3', ticker: '', displayName: '', isin: '', sourceFilePath: '' };
    assert.deepEqual(resolveRequiredTestIds('RU000A0JQCC3', row), ['test-1', 'test-2']);
  });

  it('stocks require no tests', () => {
    const row = { assetKind: 'stock' as const, symbol: 'GAZP', ticker: '', displayName: '', isin: '', sourceFilePath: '' };
    assert.deepEqual(resolveRequiredTestIds('GAZP', row), []);
  });

  it('passing test-1 unlocks gov but not corporate bonds', () => {
    const govRow = { assetKind: 'bond' as const, symbol: 'SU26207RMFS9', ticker: '', displayName: '', isin: '', sourceFilePath: '' };
    const corpRow = { assetKind: 'bond' as const, symbol: 'RU000A0JQCC3', ticker: '', displayName: '', isin: '', sourceFilePath: '' };
    const passed = ['test-1'];
    assert.equal(isSymbolUnlockedByTests('SU26207RMFS9', govRow, passed), true);
    assert.equal(isSymbolUnlockedByTests('RU000A0JQCC3', corpRow, passed), false);
    assert.deepEqual(missingTestIdsForSymbol('RU000A0JQCC3', corpRow, passed), ['test-2']);
  });

  it('shuffleWithSeed is deterministic per seed', () => {
    const a = shuffleWithSeed(['a', 'b', 'c', 'd'], 42);
    const b = shuffleWithSeed(['a', 'b', 'c', 'd'], 42);
    const c = shuffleWithSeed(['a', 'b', 'c', 'd'], 99);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });
});

describe('EducationModuleService', () => {
  it('submit-test grades and records pass', () => {
    const svc = new EducationModuleService();
    const state = minimalGameState();
    const events: string[] = [];
    svc.handleCommand(
      state,
      { type: 'education/select-test', testId: 'test-1' },
      { emit: () => {}, dispatchCommand: () => {} }
    );

    const allCorrect: Record<string, string> = {
      q1: 'b',
      q2: 'a',
      q3: 'b',
      q4: 'a',
      q5: 'b',
    };

    svc.handleCommand(
      state,
      { type: 'education/submit-test', testId: 'test-1', answers: allCorrect },
      {
        emit: (e) => events.push(String(e)),
        dispatchCommand: () => {},
      }
    );

    assert.equal(state.education.lastTestResult?.passed, true);
    assert.equal(state.education.lastTestResult?.correct, 5);
    assert.ok(state.education.passedTestIds.includes('test-1'));
    assert.ok(events.includes('EDUCATION_TEST_PASSED'));
  });

  it('hint queue cycles without immediate repeat', () => {
    const svc = new EducationModuleService();
    const state = minimalGameState();
    svc.bootstrap(state);
    const shown: string[] = [];
    for (let i = 0; i < 5; i++) {
      svc.handleCommand(state, { type: 'education/show-next-hint' }, { emit: () => {}, dispatchCommand: () => {} });
      shown.push(state.education.activeHintId!);
      svc.handleCommand(state, { type: 'education/dismiss-hint' }, { emit: () => {}, dispatchCommand: () => {} });
    }
    assert.equal(new Set(shown).size, 5);
  });

  it('hint scheduler fires in background and reveals after chart return delay', () => {
    const svc = new EducationModuleService();
    const state = minimalGameState();
    state.uiState = {
      ...state.uiState,
      chartHintsActive: false,
      selectedSymbol: 'GAZP',
      leftPanelMode: 'portfolio',
    };
    svc.bootstrap(state);
    const now = 1_000_000;
    state.education.nextAutoHintAtMs = now;
    svc.handleCommand(
      state,
      { type: 'education/hint-scheduler-tick', chartSurfaceActive: false, nowMs: now },
      { emit: () => {}, dispatchCommand: () => {} }
    );
    assert.ok(state.education.pendingHintId);
    assert.equal(state.education.activeHintId, null);
    svc.handleCommand(
      state,
      { type: 'education/on-chart-hints-surface', active: true, nowMs: now },
      { emit: () => {}, dispatchCommand: () => {} }
    );
    assert.ok(state.education.pendingHintRevealAtMs! >= now + 9_000);
    svc.handleCommand(
      state,
      { type: 'education/hint-scheduler-tick', chartSurfaceActive: true, nowMs: now + 10_000 },
      { emit: () => {}, dispatchCommand: () => {} }
    );
    assert.ok(state.education.activeHintId);
  });

  it('force-show-hint on chart surface shows immediately', () => {
    const svc = new EducationModuleService();
    const state = minimalGameState();
    svc.handleCommand(
      state,
      { type: 'education/force-show-hint', chartSurfaceActive: true },
      { emit: () => {}, dispatchCommand: () => {} }
    );
    assert.ok(state.education.activeHintId);
    assert.equal(state.education.pendingHintId, null);
  });

  it('computeNewlyUnlockedSymbols after test-1 pass', () => {
    const state = minimalGameState();
    const newly = computeNewlyUnlockedSymbols(
      state.market.instrumentCatalog,
      [],
      ['test-1']
    );
    assert.ok(newly.includes('SU26207RMFS9'));
    assert.ok(!newly.includes('RU000A0JQCC3'));
  });
});
