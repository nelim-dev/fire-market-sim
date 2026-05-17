export interface EducationModuleState {
  /** Символы (UPPERCASE), доступные для торговли и просмотра без теста. */
  unlockedSymbols: readonly string[];
  ready: boolean;
}

export function normalizeEducationSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}
