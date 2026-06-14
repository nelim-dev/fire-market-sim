'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import {
  selectEducationBrowseMode,
  selectEducationLessonCatalog,
  selectEducationSelectedLessonId,
  selectEducationSelectedTestId,
  selectEducationTestCatalog,
} from '@/logic/modules/education/selectors';
import type { EducationBrowseMode } from '@/logic/modules/education/state';

const TAB_CLASS = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-xs font-medium transition ${
    active ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
  }`;

const LIST_ITEM_CLASS = (active: boolean) =>
  `w-full rounded-lg border px-3 py-2.5 text-left text-sm transition ${
    active
      ? 'border-sky-700/60 bg-sky-950/30 text-zinc-100'
      : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900/60'
  }`;

export function EducationLeftPanel() {
  const browseMode = useGameState(selectEducationBrowseMode);
  const selectedLessonId = useGameState(selectEducationSelectedLessonId);
  const selectedTestId = useGameState(selectEducationSelectedTestId);
  const testCatalog = useGameState(selectEducationTestCatalog);
  const lessonCatalog = selectEducationLessonCatalog();
  const lm = gameLoop.getLogicManager();

  useEffect(() => {
    lm.dispatchCommand({ type: 'education/bootstrap' });
  }, [lm]);

  const setMode = (mode: EducationBrowseMode) => {
    lm.dispatchCommand({ type: 'education/set-browse-mode', mode });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-zinc-100">
      <Link href="/" className="text-xs text-sky-500 hover:text-sky-400">
        ← Портфель
      </Link>
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Обучение</h1>

      <nav className="flex flex-wrap gap-2 border-b border-zinc-800 pb-2">
        <button type="button" className={TAB_CLASS(browseMode === 'lessons')} onClick={() => setMode('lessons')}>
          Лекции
        </button>
        <button type="button" className={TAB_CLASS(browseMode === 'tests')} onClick={() => setMode('tests')}>
          Тесты
        </button>
      </nav>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {browseMode === 'lessons'
          ? lessonCatalog.map((lesson) => (
              <button
                key={lesson.id}
                type="button"
                className={LIST_ITEM_CLASS(selectedLessonId === lesson.id)}
                onClick={() =>
                  lm.dispatchCommand({ type: 'education/select-lesson', lessonId: lesson.id })
                }
              >
                <span className="mr-1.5" aria-hidden>
                  {lesson.emoji ?? '📚'}
                </span>
                <span className="font-medium">{lesson.title}</span>
              </button>
            ))
          : testCatalog.map((test) => (
              <button
                key={test.id}
                type="button"
                disabled={!test.available}
                className={`${LIST_ITEM_CLASS(selectedTestId === test.id)} ${
                  !test.available ? 'cursor-not-allowed opacity-50' : ''
                }`}
                onClick={() =>
                  lm.dispatchCommand({ type: 'education/select-test', testId: test.id })
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="mr-1.5" aria-hidden>
                      {test.emoji ?? '📝'}
                    </span>
                    <span className="font-medium">{test.title}</span>
                    {!test.available ? (
                      <p className="mt-1 text-xs text-zinc-500">Скоро</p>
                    ) : (
                      <p className="mt-1 text-xs text-zinc-500">{test.description}</p>
                    )}
                  </div>
                  {test.available ? (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        test.passed
                          ? 'bg-emerald-900/50 text-emerald-400'
                          : 'bg-amber-900/40 text-amber-400'
                      }`}
                    >
                      {test.passed ? 'Пройден' : 'Доступен'}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}
