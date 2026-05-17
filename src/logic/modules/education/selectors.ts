import type { GameState } from '@/logic/managers/LogicManager';
import { normalizeEducationSymbol } from './state';

export const selectEducationModule = (state: GameState) => state.education;

export const selectEducationIsSymbolUnlocked =
  (symbol: string) =>
  (state: GameState): boolean => {
    const key = normalizeEducationSymbol(symbol);
    return state.education.unlockedSymbols.includes(key);
  };
