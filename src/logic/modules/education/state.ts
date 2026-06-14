export type EducationBrowseMode = 'lessons' | 'tests';

export interface EducationTestResult {
  testId: string;
  correct: number;
  total: number;
  passed: boolean;
}

export interface EducationModuleState {
  ready: boolean;

  /** Пройденные тесты (score >= passingScorePercent). Единственный источник unlock. */
  passedTestIds: readonly string[];

  browseMode: EducationBrowseMode;
  selectedLessonId: string | null;
  selectedTestId: string | null;
  /** Seed для стабильной тасовки одной попытки теста. */
  testAttemptSeed: number | null;

  lastTestResult: EducationTestResult | null;

  hintQueue: readonly string[];
  activeHintId: string | null;
  /** Wall-clock: когда запланировать следующую авто-подсказку. */
  nextAutoHintAtMs: number | null;
  /** Id подсказки, ожидающей показа на вкладке «График». */
  pendingHintId: string | null;
  /** Wall-clock: когда показать pending на графике. */
  pendingHintRevealAtMs: number | null;
}

export function normalizeEducationSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function createInitialEducationState(): EducationModuleState {
  return {
    ready: false,
    passedTestIds: [],
    browseMode: 'lessons',
    selectedLessonId: 'lesson-1',
    selectedTestId: null,
    testAttemptSeed: null,
    lastTestResult: null,
    hintQueue: [],
    activeHintId: null,
    nextAutoHintAtMs: null,
    pendingHintId: null,
    pendingHintRevealAtMs: null,
  };
}
