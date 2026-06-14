export const EDUCATION_TEST_SUBMITTED = 'EDUCATION_TEST_SUBMITTED';
export const EDUCATION_TEST_PASSED = 'EDUCATION_TEST_PASSED';

export type EducationTestSubmittedPayload = {
  testId: string;
  correct: number;
  total: number;
  passed: boolean;
};

export type EducationTestPassedPayload = {
  testId: string;
  newlyUnlockedSymbols: readonly string[];
};
