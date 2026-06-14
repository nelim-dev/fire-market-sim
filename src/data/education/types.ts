export interface EducationHint {
  id: string;
  text: string;
}

export type LessonBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bulletList'; items: readonly string[] }
  | { type: 'callout'; emoji: string; text: string };

export interface LessonChapter {
  id: string;
  title: string;
  emoji?: string;
  blocks: readonly LessonBlock[];
}

export interface Lesson {
  id: string;
  title: string;
  subtitle?: string;
  emoji?: string;
  chapters: readonly LessonChapter[];
}

export interface TestOption {
  id: string;
  text: string;
}

export interface TestQuestion {
  id: string;
  prompt: string;
  options: readonly TestOption[];
  correctOptionId: string;
}

export interface TestDefinition {
  id: string;
  title: string;
  description: string;
  passingScorePercent: number;
  questions: readonly TestQuestion[];
}

export interface TestCatalogEntry {
  id: string;
  title: string;
  description: string;
  emoji?: string;
  /** false — тест в каталоге, но контент ещё не готов */
  available: boolean;
}

export interface LessonCatalogEntry {
  id: string;
  title: string;
  subtitle?: string;
  emoji?: string;
}

export type BondEducationTier = 'gov' | 'corporate';

export interface InstrumentUnlockRule {
  match: {
    symbol?: string;
    assetKind?: 'stock' | 'index' | 'bond' | 'fund';
    bondTier?: BondEducationTier;
  };
  requiredTestIds: readonly string[];
}
