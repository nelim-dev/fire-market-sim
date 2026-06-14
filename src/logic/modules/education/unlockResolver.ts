import type { MarketInstrumentCatalogItem } from '@/logic/modules/market/contracts';
import {
  GOV_BOND_SYMBOL_PREFIXES,
  GOV_BOND_SYMBOLS,
  INSTRUMENT_UNLOCK_RULES,
} from '@/data/education/unlockRequirements';
import type { BondEducationTier } from '@/data/education/types';
import { normalizeEducationSymbol } from './state';

export function resolveBondTier(symbol: string): BondEducationTier {
  const key = normalizeEducationSymbol(symbol);
  if (GOV_BOND_SYMBOLS.has(key)) {
    return 'gov';
  }
  for (const prefix of GOV_BOND_SYMBOL_PREFIXES) {
    if (key.startsWith(prefix)) {
      return 'gov';
    }
  }
  return 'corporate';
}

export function resolveRequiredTestIds(
  symbol: string,
  catalogRow: MarketInstrumentCatalogItem | undefined
): readonly string[] {
  const key = normalizeEducationSymbol(symbol);

  for (const rule of INSTRUMENT_UNLOCK_RULES) {
    if (rule.match.symbol && normalizeEducationSymbol(rule.match.symbol) === key) {
      return rule.requiredTestIds;
    }
  }

  if (catalogRow?.assetKind === 'bond') {
    const tier = resolveBondTier(key);
    for (const rule of INSTRUMENT_UNLOCK_RULES) {
      if (
        rule.match.assetKind === 'bond' &&
        rule.match.bondTier === tier &&
        !rule.match.symbol
      ) {
        return rule.requiredTestIds;
      }
    }
  }

  if (catalogRow?.assetKind) {
    for (const rule of INSTRUMENT_UNLOCK_RULES) {
      if (
        rule.match.assetKind === catalogRow.assetKind &&
        !rule.match.bondTier &&
        !rule.match.symbol
      ) {
        return rule.requiredTestIds;
      }
    }
  }

  return [];
}

export function areRequiredTestsPassed(
  requiredTestIds: readonly string[],
  passedTestIds: readonly string[]
): boolean {
  if (requiredTestIds.length === 0) {
    return true;
  }
  const passed = new Set(passedTestIds);
  return requiredTestIds.every((id) => passed.has(id));
}

export function isSymbolUnlockedByTests(
  symbol: string,
  catalogRow: MarketInstrumentCatalogItem | undefined,
  passedTestIds: readonly string[]
): boolean {
  const required = resolveRequiredTestIds(symbol, catalogRow);
  return areRequiredTestsPassed(required, passedTestIds);
}

export function missingTestIdsForSymbol(
  symbol: string,
  catalogRow: MarketInstrumentCatalogItem | undefined,
  passedTestIds: readonly string[]
): readonly string[] {
  const required = resolveRequiredTestIds(symbol, catalogRow);
  const passed = new Set(passedTestIds);
  return required.filter((id) => !passed.has(id));
}

export function computeNewlyUnlockedSymbols(
  catalog: readonly MarketInstrumentCatalogItem[],
  prevPassedTestIds: readonly string[],
  nextPassedTestIds: readonly string[]
): string[] {
  const newlyUnlocked: string[] = [];
  for (const item of catalog) {
    const symbol = normalizeEducationSymbol(item.symbol);
    const wasUnlocked = isSymbolUnlockedByTests(symbol, item, prevPassedTestIds);
    const nowUnlocked = isSymbolUnlockedByTests(symbol, item, nextPassedTestIds);
    if (!wasUnlocked && nowUnlocked) {
      newlyUnlocked.push(symbol);
    }
  }
  return newlyUnlocked;
}

/** Fisher–Yates shuffle (deterministic copy). */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createShuffledHintQueue(allHintIds: readonly string[], seed: number): string[] {
  return shuffleWithSeed(allHintIds, seed);
}
