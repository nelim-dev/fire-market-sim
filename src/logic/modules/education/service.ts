import type { MarketInstrumentCatalogItem } from '@/logic/modules/market/contracts';
import type { LogicCommand, LogicModule, ModuleContext } from '@/logic/modules/contracts';
import type { GameState } from '@/logic/managers/LogicManager';
import type { EducationModuleState } from './state';
import { isEducationDefaultLocked, normalizeEducationSymbol } from './state';

export class EducationModuleService implements LogicModule<GameState> {
  readonly id = 'education';

  createInitialState(): EducationModuleState {
    return {
      unlockedSymbols: [],
      ready: false,
    };
  }

  update(): void {
    // Пассивный модуль: unlock меняется командами и bootstrap из LogicManager.
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    switch (command.type) {
      case 'education/sync-unlocked-from-catalog':
        return this.syncUnlockedFromCatalog(state);
      case 'education/lock-symbol':
        return this.lockSymbol(state, command.symbol);
      case 'education/unlock-symbol':
        return this.unlockSymbol(state, command.symbol);
      default:
        return false;
    }
  }

  /**
   * Разблокировать все символы из каталога (текущая фаза: все инструменты доступны).
   */
  syncUnlockedFromCatalog(state: GameState): boolean {
    const catalog = state.market.instrumentCatalog;
    if (catalog.length === 0) {
      return false;
    }
    const next = catalog
      .map((row) => normalizeEducationSymbol(row.symbol))
      .filter((symbol) => !isEducationDefaultLocked(symbol));
    const prev = state.education.unlockedSymbols;
    if (
      state.education.ready &&
      prev.length === next.length &&
      prev.every((s, i) => s === next[i])
    ) {
      return false;
    }
    state.education.unlockedSymbols = next;
    state.education.ready = true;
    return true;
  }

  syncUnlockedFromCatalogItems(
    state: GameState,
    items: readonly MarketInstrumentCatalogItem[]
  ): boolean {
    if (items.length === 0) {
      return false;
    }
    const next = items
      .map((row) => normalizeEducationSymbol(row.symbol))
      .filter((symbol) => !isEducationDefaultLocked(symbol));
    state.education.unlockedSymbols = next;
    state.education.ready = true;
    return true;
  }

  isSymbolUnlocked(state: GameState, symbol: string): boolean {
    const key = normalizeEducationSymbol(symbol);
    return state.education.unlockedSymbols.includes(key);
  }

  private lockSymbol(state: GameState, symbol: string): boolean {
    const key = normalizeEducationSymbol(symbol);
    const next = state.education.unlockedSymbols.filter((s) => s !== key);
    if (next.length === state.education.unlockedSymbols.length) {
      return false;
    }
    state.education.unlockedSymbols = next;
    return true;
  }

  private unlockSymbol(state: GameState, symbol: string): boolean {
    const key = normalizeEducationSymbol(symbol);
    if (state.education.unlockedSymbols.includes(key)) {
      return false;
    }
    state.education.unlockedSymbols = [...state.education.unlockedSymbols, key];
    state.education.ready = true;
    return true;
  }
}
