import type { LogicManager } from '@/logic/managers/LogicManager';

/**
 * Счётчик паузы для модальных оверлеев (меню, настройки).
 * Пока открыт хотя бы один оверлей — симуляция на паузе; при закрытии последнего
 * возобновляем только если паузу включил сам оверлей (игрок не ставил паузу вручную).
 */
let overlayPauseDepth = 0;
let shouldResumeAfterOverlay = false;

export function getOverlayPauseDepth(): number {
  return overlayPauseDepth;
}

export function acquireOverlayPause(lm: LogicManager): void {
  if (overlayPauseDepth === 0) {
    shouldResumeAfterOverlay = !lm.getState().isPaused;
    if (shouldResumeAfterOverlay) {
      lm.pause();
    }
  }
  overlayPauseDepth += 1;
}

export function releaseOverlayPause(lm: LogicManager): void {
  if (overlayPauseDepth <= 0) {
    return;
  }
  overlayPauseDepth -= 1;
  if (overlayPauseDepth === 0 && shouldResumeAfterOverlay) {
    lm.resume();
    shouldResumeAfterOverlay = false;
  }
}

/** Сброс при размонтировании layout (hot reload / тесты). */
export function resetOverlayPauseForTests(): void {
  overlayPauseDepth = 0;
  shouldResumeAfterOverlay = false;
}
