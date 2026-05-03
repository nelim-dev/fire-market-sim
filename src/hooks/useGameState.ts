'use client';

import { useEffect, useRef, useState } from 'react';
import { gameLoop } from '@/logic/runners/GameLoop';
import type { GameState } from '@/logic/managers/LogicManager';

/**
 * Подписка на срез GameState через LogicManager.subscribe (как в ТЗ M1).
 * Селектор хранится в ref — не нужен useCallback у вызывающего.
 */
export function useGameState<T>(selector: (state: GameState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [value, setValue] = useState<T>(() =>
    selector(gameLoop.getLogicManager().getState() as GameState)
  );

  useEffect(() => {
    const lm = gameLoop.getLogicManager();
    return lm.subscribe(
      (state) => selectorRef.current(state),
      setValue
    );
  }, []);

  return value;
}
