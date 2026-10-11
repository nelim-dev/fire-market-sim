/**
 * service.ts — фасад модуля обучения (EducationModule).
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ---------------
 * Управляет прогрессом обучения в симуляторе:
 * - навигация по лекциям и тестам на экране /learn;
 * - проверка ответов и запись passedTestIds (единственный источник unlock инструментов);
 * - планировщик контекстных подсказок на графике (hint queue + таймеры).
 *
 * Контент (тексты лекций, вопросы, правила unlock) лежит в src/data/education/*.
 * Этот файл — только **логика состояния** и команды education/*.
 *
 * Модуль пассивен в update(): всё через handleCommand. Не мутирует рынок и портфель.
 * Разблокировка читается селекторами (selectEducationIsSymbolUnlocked) в UI и M5-тестах.
 *
 * СОБЫТИЯ
 * -------
 * - EDUCATION_TEST_SUBMITTED — любая попытка сдачи
 * - EDUCATION_TEST_PASSED — первый успешный зачёт + список newlyUnlockedSymbols
 */

import { EDUCATION_HINT_IDS } from '@/data/education/hints';
import { getTestById } from '@/data/education/tests';
import type { LogicCommand, LogicModule, ModuleContext } from '@/logic/modules/contracts';
import type { GameState } from '@/logic/managers/LogicManager';
import {
  EDUCATION_TEST_PASSED,
  EDUCATION_TEST_SUBMITTED,
  type EducationTestPassedPayload,
  type EducationTestSubmittedPayload,
} from './events';
import type { EducationModuleState } from './state';
import { createInitialEducationState } from './state';
import {
  computeNewlyUnlockedSymbols,
  createShuffledHintQueue,
} from './unlockResolver';
import {
  HINT_CHART_RETURN_DELAY_MS,
  randomHintIntervalMs,
} from './hintSchedule';

/**
 * EducationModule — лекции, тесты, подсказки, passedTestIds для допуска к бумагам.
 */
export class EducationModuleService implements LogicModule<GameState> {
  readonly id = 'education';

  /** Делегирует начальное состояние в state.ts (lesson-1, пустые passed, очередь hints). */
  createInitialState(): EducationModuleState {
    return createInitialEducationState();
  }

  /**
   * Намеренно пустой: модуль не тикает сам по себе.
   * Подсказки двигаются командами hint-scheduler-tick из ChartHintToast (раз в секунду).
   */
  update(): void {
    // Пассивный модуль: изменения только через команды.
  }

  /**
   * Роутер education/* из UI (/learn, ChartHintToast).
   * bootstrap вызывается при монтировании экранов обучения и графика.
   */
  handleCommand(
    state: GameState,
    command: LogicCommand,
    context: ModuleContext
  ): boolean {
    switch (command.type) {
      case 'education/bootstrap':
        return this.bootstrap(state);
      case 'education/set-browse-mode':
        return this.setBrowseMode(state, command.mode);
      case 'education/select-lesson':
        return this.selectLesson(state, command.lessonId);
      case 'education/select-test':
        return this.selectTest(state, command.testId);
      case 'education/submit-test':
        return this.submitTest(state, command, context);
      case 'education/show-next-hint':
        return this.showNextHint(state);
      case 'education/dismiss-hint':
        return this.dismissHint(state);
      case 'education/force-show-hint':
        return this.forceShowHint(state, command.hintId, command.chartSurfaceActive);
      case 'education/hint-scheduler-tick':
        return this.hintSchedulerTick(state, command.chartSurfaceActive, command.nowMs);
      case 'education/on-chart-hints-surface':
        return this.onChartHintsSurface(state, command.active, command.nowMs);
      case 'education/grant-test-pass':
        return this.grantTestPass(state, command.testId);
      default:
        return false;
    }
  }

  /**
   * Идемпотентная инициализация: ready, перемешанная очередь подсказок, первый таймер.
   * Всегда return true — иначе LogicManager залогирует «команда не обработана».
   */
  bootstrap(state: GameState): boolean {
    const nowMs = Date.now();

    if (!state.education.ready) {
      state.education.ready = true;
    }

    if (state.education.hintQueue.length === 0) {
      state.education.hintQueue = createShuffledHintQueue(
        EDUCATION_HINT_IDS,
        nowMs
      );
    }

    if (state.education.nextAutoHintAtMs == null) {
      state.education.nextAutoHintAtMs = nowMs + randomHintIntervalMs();
    }

    // Команда обработана модулем даже без изменений (LogicManager иначе логирует warning).
    return true;
  }

  /** Если очередь подсказок опустела — пересоздаём shuffle (новый цикл без мгновенного повтора). */
  private ensureHintQueue(state: GameState): void {
    if (state.education.hintQueue.length === 0) {
      state.education.hintQueue = createShuffledHintQueue(
        EDUCATION_HINT_IDS,
        Date.now()
      );
    }
  }

  /** Берёт следующий hint id из головы очереди и сдвигает массив. */
  private popNextHintId(state: GameState): string | null {
    this.ensureHintQueue(state);
    const [next, ...rest] = state.education.hintQueue;
    if (!next) {
      return null;
    }
    state.education.hintQueue = rest;
    return next;
  }

  /** Планирует следующую авто-подсказку через случайный интервал 3–6 минут (wall-clock). */
  private scheduleNextAutoHint(state: GameState, nowMs: number): void {
    state.education.nextAutoHintAtMs = nowMs + randomHintIntervalMs();
  }

  /**
   * Шаг планировщика (вызывается из UI каждую секунду, если schedulingActive).
   *
   * 1) Попытаться показать pending-подсказку, если пользователь на вкладке «График».
   * 2) Если пришло время nextAutoHintAtMs — положить новую подсказку в pending/active.
   */
  private hintSchedulerTick(
    state: GameState,
    chartSurfaceActive: boolean,
    nowMs = Date.now()
  ): boolean {
    this.bootstrap(state);

    this.tryRevealPendingHint(state, chartSurfaceActive, nowMs);

    if (
      state.education.nextAutoHintAtMs != null &&
      nowMs >= state.education.nextAutoHintAtMs &&
      !state.education.pendingHintId &&
      !state.education.activeHintId
    ) {
      const nextId = this.popNextHintId(state);
      if (nextId) {
        state.education.pendingHintId = nextId;
        state.education.pendingHintRevealAtMs = chartSurfaceActive
          ? nowMs
          : null;
        this.scheduleNextAutoHint(state, nowMs);
        this.tryRevealPendingHint(state, chartSurfaceActive, nowMs);
      }
    }

    return true;
  }

  /**
   * Пользователь открыл/закрыл вкладку «График» на карточке инструмента.
   * При уходе с графика активный toast скрываем; при возврате — откладываем reveal на 10 с.
   */
  private onChartHintsSurface(
    state: GameState,
    active: boolean,
    nowMs = Date.now()
  ): boolean {
    if (!active) {
      if (state.education.activeHintId) {
        state.education.activeHintId = null;
      }
      return true;
    }

    if (
      state.education.pendingHintId &&
      state.education.pendingHintRevealAtMs == null
    ) {
      state.education.pendingHintRevealAtMs = nowMs + HINT_CHART_RETURN_DELAY_MS;
    }

    this.tryRevealPendingHint(state, true, nowMs);
    return true;
  }

  /**
   * Переводит pendingHintId → activeHintId, когда наступило pendingHintRevealAtMs
   * и пользователь смотрит на график (chartSurfaceActive).
   */
  private tryRevealPendingHint(
    state: GameState,
    chartSurfaceActive: boolean,
    nowMs: number
  ): boolean {
    if (!chartSurfaceActive || state.education.activeHintId) {
      return false;
    }
    const pendingId = state.education.pendingHintId;
    const revealAt = state.education.pendingHintRevealAtMs;
    if (!pendingId || revealAt == null || nowMs < revealAt) {
      return false;
    }
    state.education.activeHintId = pendingId;
    state.education.pendingHintId = null;
    state.education.pendingHintRevealAtMs = null;
    return true;
  }

  /** Переключатель «Лекции» / «Тесты» в левой колонке /learn. */
  private setBrowseMode(state: GameState, mode: EducationModuleState['browseMode']): boolean {
    if (state.education.browseMode === mode) {
      return false;
    }
    state.education.browseMode = mode;
    return true;
  }

  /** Выбор лекции; сбрасываем lastTestResult, чтобы не путать с результатом теста. */
  private selectLesson(state: GameState, lessonId: string): boolean {
    if (state.education.selectedLessonId === lessonId) {
      return false;
    }
    state.education.selectedLessonId = lessonId;
    state.education.lastTestResult = null;
    return true;
  }

  /**
   * Новая попытка теста: фиксируем testId и новый testAttemptSeed для перетасовки вопросов.
   * return true даже если testId тот же — UI мог нажать «пройти заново».
   */
  private selectTest(state: GameState, testId: string): boolean {
    const changedSelection = state.education.selectedTestId !== testId;
    state.education.selectedTestId = testId;
    state.education.testAttemptSeed = Date.now();
    state.education.lastTestResult = null;
    return changedSelection || true;
  }

  /**
   * Проверка ответов, запись lastTestResult, при первом pass — passedTestIds и unlock.
   *
   * Порог прохождения — test.passingScorePercent из данных (например 80 %).
   * computeNewlyUnlockedSymbols сравнивает каталог рынка до/после pass.
   */
  private submitTest(
    state: GameState,
    command: Extract<LogicCommand, { type: 'education/submit-test' }>,
    context: ModuleContext
  ): boolean {
    const test = getTestById(command.testId);
    if (!test) {
      return false;
    }

    let correct = 0;
    for (const q of test.questions) {
      if (command.answers[q.id] === q.correctOptionId) {
        correct += 1;
      }
    }
    const total = test.questions.length;
    const scorePercent = total > 0 ? (correct / total) * 100 : 0;
    const passed = scorePercent >= test.passingScorePercent;

    state.education.lastTestResult = {
      testId: command.testId,
      correct,
      total,
      passed,
    };

    const submittedPayload: EducationTestSubmittedPayload = {
      testId: command.testId,
      correct,
      total,
      passed,
    };
    context.emit(EDUCATION_TEST_SUBMITTED, submittedPayload);

    if (passed && !state.education.passedTestIds.includes(command.testId)) {
      const prevPassed = state.education.passedTestIds;
      const nextPassed = [...prevPassed, command.testId];
      state.education.passedTestIds = nextPassed;

      const newlyUnlockedSymbols = computeNewlyUnlockedSymbols(
        state.market.instrumentCatalog,
        prevPassed,
        nextPassed
      );
      const passedPayload: EducationTestPassedPayload = {
        testId: command.testId,
        newlyUnlockedSymbols,
      };
      context.emit(EDUCATION_TEST_PASSED, passedPayload);
    }

    return true;
  }

  /** Ручной показ следующей подсказки из очереди (без ожидания таймера). */
  private showNextHint(state: GameState): boolean {
    if (state.education.activeHintId) {
      return false;
    }
    if (state.education.hintQueue.length === 0) {
      state.education.hintQueue = createShuffledHintQueue(
        EDUCATION_HINT_IDS,
        Date.now()
      );
    }
    const [next, ...rest] = state.education.hintQueue;
    if (!next) {
      return false;
    }
    state.education.hintQueue = rest;
    state.education.activeHintId = next;
    return true;
  }

  /** Закрытие toast пользователем или по таймауту HINT_VISIBLE_MS в ChartHintToast. */
  private dismissHint(state: GameState): boolean {
    if (!state.education.activeHintId) {
      return false;
    }
    state.education.activeHintId = null;
    return true;
  }

  /**
   * Dev/отладка: показать конкретную или следующую подсказку немедленно.
   * chartSurfaceActive=true — сразу в activeHintId; иначе через pending + задержку.
   */
  private forceShowHint(
    state: GameState,
    hintId?: string,
    chartSurfaceActive = false
  ): boolean {
    state.education.pendingHintId = null;
    state.education.pendingHintRevealAtMs = null;
    state.education.activeHintId = null;

    const nowMs = Date.now();
    let id: string | null = null;

    if (hintId != null) {
      const trimmed = hintId.trim();
      if (!EDUCATION_HINT_IDS.includes(trimmed)) {
        return false;
      }
      id = trimmed;
    } else {
      id = this.popNextHintId(state);
      if (!id) {
        return false;
      }
    }

    if (chartSurfaceActive) {
      state.education.activeHintId = id;
    } else {
      state.education.pendingHintId = id;
      state.education.pendingHintRevealAtMs = nowMs + HINT_CHART_RETURN_DELAY_MS;
    }

    state.education.ready = true;
    if (state.education.nextAutoHintAtMs == null) {
      this.scheduleNextAutoHint(state, nowMs);
    }
    return true;
  }

  /**
   * Зачесть тест без UI (load save, консольные тесты).
   * Не эмитит EDUCATION_TEST_PASSED — только расширяет passedTestIds.
   */
  private grantTestPass(state: GameState, testId: string): boolean {
    if (state.education.passedTestIds.includes(testId)) {
      return false;
    }
    state.education.passedTestIds = [...state.education.passedTestIds, testId];
    state.education.ready = true;
    return true;
  }
}
