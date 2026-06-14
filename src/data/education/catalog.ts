import type { LessonCatalogEntry, TestCatalogEntry } from './types';

export const LESSON_CATALOG: readonly LessonCatalogEntry[] = [
  {
    id: 'lesson-1',
    title: 'Вклады, облигации, акции – кто кого?',
    subtitle: 'Почему надёжность стоит дешевле, а риск приносит доход',
    emoji: '📚',
  },
];

export const TEST_CATALOG: readonly TestCatalogEntry[] = [
  {
    id: 'test-1',
    title: 'Облигации: долговая азбука',
    description: 'Открывает доступ к государственным облигациям (ОФЗ)',
    emoji: '📝',
    available: true,
  },
  {
    id: 'test-2',
    title: 'Корпоративные облигации',
    description: 'Открывает доступ к корпоративным облигациям',
    emoji: '🏢',
    available: false,
  },
];

export function getTestCatalogEntry(id: string): TestCatalogEntry | undefined {
  return TEST_CATALOG.find((t) => t.id === id);
}

export function getLessonCatalogEntry(id: string): LessonCatalogEntry | undefined {
  return LESSON_CATALOG.find((l) => l.id === id);
}
