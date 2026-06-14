'use client';

import { useEffect, useState } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { gameLoop } from '@/logic/runners/GameLoop';
import { getTestCatalogEntry } from '@/data/education/catalog';
import {
  selectEducationLastTestResult,
  selectEducationShuffledTestView,
} from '@/logic/modules/education/selectors';

export function TestViewer({
  testId,
  title,
  description,
}: {
  testId: string;
  title: string;
  description: string;
}) {
  const shuffled = useGameState(selectEducationShuffledTestView);
  const lastResult = useGameState(selectEducationLastTestResult);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const lm = gameLoop.getLogicManager();

  useEffect(() => {
    setAnswers({});
  }, [testId]);

  const submitted = lastResult?.testId === testId;
  const questions = shuffled?.testId === testId ? shuffled.questions : [];
  const allAnswered =
    questions.length > 0 && questions.every((q) => answers[q.id] != null);

  const submit = () => {
    lm.dispatchCommand({
      type: 'education/submit-test',
      testId,
      answers,
    });
  };

  const retry = () => {
    setAnswers({});
    lm.dispatchCommand({ type: 'education/select-test', testId });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2 border-b border-zinc-800 pb-4">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">{title}</h2>
        <p className="text-sm text-zinc-400">{description}</p>
      </header>

      <div className="space-y-6">
        {questions.map((q, idx) => {
          const selected = answers[q.id];
          const isCorrect = submitted && selected === q.correctOptionId;
          const isWrong = submitted && selected != null && selected !== q.correctOptionId;

          return (
            <fieldset
              key={q.id}
              className={`rounded-xl border p-4 ${
                submitted
                  ? isCorrect
                    ? 'border-emerald-800/60 bg-emerald-950/20'
                    : isWrong
                      ? 'border-red-800/60 bg-red-950/20'
                      : 'border-zinc-800 bg-zinc-950/40'
                  : 'border-zinc-800 bg-zinc-950/40'
              }`}
            >
              <legend className="mb-3 text-sm font-medium text-zinc-100">
                {idx + 1}. {q.prompt}
              </legend>
              <div className="space-y-2">
                {q.options.map((opt) => {
                  const showAsCorrect = submitted && opt.id === q.correctOptionId;
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                        submitted
                          ? showAsCorrect
                            ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-100'
                            : selected === opt.id
                              ? 'border-red-700/50 bg-red-950/30 text-red-100'
                              : 'border-transparent text-zinc-400'
                          : selected === opt.id
                            ? 'border-sky-700/50 bg-sky-950/30 text-zinc-100'
                            : 'border-transparent text-zinc-300 hover:bg-zinc-900/60'
                      } ${submitted ? 'cursor-default' : ''}`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={opt.id}
                        checked={selected === opt.id}
                        disabled={submitted}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                        className="mt-0.5"
                      />
                      <span>{opt.text}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      {submitted && lastResult ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-6 text-center">
          <p className="text-lg font-semibold text-zinc-100">
            Правильных ответов: {lastResult.correct} из {lastResult.total}
          </p>
          <p
            className={`mt-2 text-sm font-medium ${
              lastResult.passed ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {lastResult.passed ? '✅ Тест пройден!' : '❌ Тест не пройден (нужно ≥ 80%)'}
          </p>
          {lastResult.passed ? (
            <p className="mt-3 text-sm text-zinc-400">
              {testId === 'test-1'
                ? 'Открыт доступ к государственным облигациям (ОФЗ).'
                : 'Новые инструменты разблокированы.'}
            </p>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">
              Рекомендуем повторить материал лекции и попробовать снова.
            </p>
          )}
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-400"
          >
            Пройти заново
          </button>
        </div>
      ) : (
        <div className="flex justify-end border-t border-zinc-800 pt-4">
          <button
            type="button"
            disabled={!allAnswered}
            onClick={submit}
            className="rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Проверить
          </button>
        </div>
      )}
    </div>
  );
}

export function getTestDisplayTitle(testId: string): string {
  return getTestCatalogEntry(testId)?.title ?? testId;
}
