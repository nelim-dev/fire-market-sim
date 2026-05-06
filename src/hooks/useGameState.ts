'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { gameLoop } from '@/logic/runners/GameLoop';
import type { GameState } from '@/logic/managers/LogicManager';

/**
 * Подписка на срез GameState через LogicManager.
 * useSyncExternalStore — каноничный способ React 18+ для стора, который обновляется
 * извне (игровой цикл в requestAnimationFrame); иначе setState из rAF может не
 * синхронизироваться с отрисовкой до следующего пользовательского события (пауза).
 */
export function useGameState<T>(
  selector: (state: GameState) => T,
  equalityFn: (a: T, b: T) => boolean = Object.is
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalityRef = useRef(equalityFn);
  equalityRef.current = equalityFn;
  const lmRef = useRef(gameLoop.getLogicManager());
  const valueRef = useRef<T>(
    selectorRef.current(lmRef.current.getState() as GameState)
  );
  const versionRef = useRef(0);

  const listenerRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback((onStoreChange: () => void) => {
    listenerRef.current = onStoreChange;
    let isInitialDelivery = true;
    return lmRef.current.subscribe(
      (state) => selectorRef.current(state),
      (nextValue) => {
        if (isInitialDelivery) {
          valueRef.current = nextValue;
          isInitialDelivery = false;
          return;
        }
        if (equalityRef.current(valueRef.current, nextValue)) {
          return;
        }
        valueRef.current = nextValue;
        versionRef.current += 1;
        listenerRef.current?.();
      },
      equalityRef.current
    );
  }, []);

  const getSnapshot = useCallback(() => versionRef.current, []);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return valueRef.current;
}
