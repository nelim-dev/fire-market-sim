import { EDUCATION_HINT_IDS } from '@/data/education/hints';
import { gameLoop } from '@/logic/runners/GameLoop';

export interface FireDevConsole {
  /** Показать подсказку сразу. hintId: hint-1 … hint-5 (опционально). */
  showHint(hintId?: string): boolean;
  hintIds: readonly string[];
}

declare global {
  interface Window {
    __fire?: FireDevConsole;
  }
}

export function registerFireDevConsole(): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
    return;
  }

  const api: FireDevConsole = {
    hintIds: EDUCATION_HINT_IDS,
    showHint(hintId?: string) {
      const lm = gameLoop.getLogicManager();
      const chartSurfaceActive = lm.getState().uiState.chartHintsActive;
      lm.dispatchCommand({
        type: 'education/force-show-hint',
        ...(hintId != null ? { hintId } : {}),
        chartSurfaceActive,
      });
      const activeId =
        lm.getState().education.activeHintId ??
        lm.getState().education.pendingHintId;
      if (!activeId) {
        console.warn(
          '[__fire.showHint] не удалось показать подсказку',
          hintId ?? '(следующая из очереди)'
        );
        return false;
      }
      console.info('[__fire.showHint] активна:', activeId);
      return true;
    },
  };

  window.__fire = api;
  console.info(
    '[FIRE dev] window.__fire.showHint() — форсировать подсказку на графике; ids:',
    EDUCATION_HINT_IDS.join(', ')
  );
}

export function unregisterFireDevConsole(): void {
  if (typeof window === 'undefined') {
    return;
  }
  delete window.__fire;
}
