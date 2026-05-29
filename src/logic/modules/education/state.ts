export interface EducationModuleState {
  /** Символы (UPPERCASE), доступные для торговли и просмотра без теста. */
  unlockedSymbols: readonly string[];
  ready: boolean;
}

/** Индексы металлов: график доступен после unlock, торговля spot недоступна (assetKind=index). */
export const EDUCATION_DEFAULT_LOCKED_SYMBOLS = new Set<string>([
  'GLDRUB_TOM',
  'SLVRUB_TOM',
]);

export function normalizeEducationSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function isEducationDefaultLocked(symbol: string): boolean {
  return EDUCATION_DEFAULT_LOCKED_SYMBOLS.has(normalizeEducationSymbol(symbol));
}
