import type { GameState } from '@/logic/managers/LogicManager';
import { EDUCATION_HINTS } from '@/data/education/hints';
import { LESSON_CATALOG, TEST_CATALOG, getTestCatalogEntry } from '@/data/education/catalog';
import { getLessonById } from '@/data/education/lessons';
import { getTestById } from '@/data/education/tests';
import type { TestOption } from '@/data/education/types';
import { normalizeEducationSymbol } from './state';
import {
  isSymbolUnlockedByTests,
  missingTestIdsForSymbol,
  shuffleWithSeed,
} from './unlockResolver';

export const selectEducationHintSchedulingActive = (state: GameState): boolean => {
  if (state.uiState.leftPanelMode === 'analytics') {
    return false;
  }
  if (
    state.uiState.leftPanelMode === 'portfolio' &&
    state.uiState.portfolioMainTab === 'stats'
  ) {
    return false;
  }
  const symbol = state.uiState.selectedSymbol;
  if (!symbol) {
    return false;
  }
  return selectEducationIsSymbolUnlocked(symbol)(state);
};

export const selectEducationModule = (state: GameState) => state.education;

export const selectEducationIsSymbolUnlocked =
  (symbol: string) =>
  (state: GameState): boolean => {
    const key = normalizeEducationSymbol(symbol);
    const catalogRow = state.market.instrumentCatalog.find(
      (row) => normalizeEducationSymbol(row.symbol) === key
    );
    return isSymbolUnlockedByTests(key, catalogRow, state.education.passedTestIds);
  };

export const selectEducationMissingTestsForSymbol =
  (symbol: string) =>
  (state: GameState): readonly string[] => {
    const key = normalizeEducationSymbol(symbol);
    const catalogRow = state.market.instrumentCatalog.find(
      (row) => normalizeEducationSymbol(row.symbol) === key
    );
    return missingTestIdsForSymbol(key, catalogRow, state.education.passedTestIds);
  };

export const selectEducationBrowseMode = (state: GameState) => state.education.browseMode;

export const selectEducationSelectedLessonId = (state: GameState) =>
  state.education.selectedLessonId;

export const selectEducationSelectedTestId = (state: GameState) =>
  state.education.selectedTestId;

export const selectEducationSelectedLesson = (state: GameState) => {
  const id = state.education.selectedLessonId;
  return id ? getLessonById(id) ?? null : null;
};

export const selectEducationSelectedTest = (state: GameState) => {
  const id = state.education.selectedTestId;
  return id ? getTestById(id) ?? null : null;
};

export const selectEducationLastTestResult = (state: GameState) =>
  state.education.lastTestResult;

export const selectEducationIsTestPassed = (testId: string) => (state: GameState) =>
  state.education.passedTestIds.includes(testId);

export interface ShuffledTestQuestionView {
  id: string;
  prompt: string;
  options: readonly TestOption[];
  correctOptionId: string;
}

export interface ShuffledTestView {
  testId: string;
  questions: readonly ShuffledTestQuestionView[];
}

export const selectEducationShuffledTestView = (state: GameState): ShuffledTestView | null => {
  const testId = state.education.selectedTestId;
  const seed = state.education.testAttemptSeed;
  if (!testId || seed == null) {
    return null;
  }
  const test = getTestById(testId);
  if (!test) {
    return null;
  }
  const questionOrder = shuffleWithSeed(
    test.questions.map((q) => q.id),
    seed
  );
  const questions: ShuffledTestQuestionView[] = questionOrder.map((qId, qi) => {
    const q = test.questions.find((x) => x.id === qId)!;
    const optionOrder = shuffleWithSeed(
      q.options.map((o) => o.id),
      seed + qi * 9973
    );
    const options = optionOrder.map((oId) => q.options.find((o) => o.id === oId)!);
    return {
      id: q.id,
      prompt: q.prompt,
      options,
      correctOptionId: q.correctOptionId,
    };
  });
  return { testId, questions };
};

export const selectActiveChartHint = (state: GameState) => {
  const id = state.education.activeHintId;
  if (!id) {
    return null;
  }
  return EDUCATION_HINTS.find((h) => h.id === id) ?? null;
};

export const selectEducationLessonCatalog = () => LESSON_CATALOG;

export const selectEducationTestCatalog = (state: GameState) =>
  TEST_CATALOG.map((entry) => ({
    ...entry,
    passed: state.education.passedTestIds.includes(entry.id),
  }));

export function getTestTitle(testId: string): string {
  return getTestCatalogEntry(testId)?.title ?? testId;
}
