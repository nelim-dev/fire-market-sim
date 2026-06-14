import type { InstrumentUnlockRule } from './types';

/** Символы, заблокированные до прохождения отдельного теста (пока test-metals не реализован). */
export const EDUCATION_METAL_SYMBOLS = ['GLDRUB_TOM', 'SLVRUB_TOM'] as const;

/**
 * Правила доступа к инструментам. Все `requiredTestIds` должны быть пройдены (AND).
 * Приоритет: symbol → bondTier → assetKind → default [].
 */
export const INSTRUMENT_UNLOCK_RULES: readonly InstrumentUnlockRule[] = [
  { match: { symbol: 'GLDRUB_TOM' }, requiredTestIds: ['test-metals'] },
  { match: { symbol: 'SLVRUB_TOM' }, requiredTestIds: ['test-metals'] },
  { match: { assetKind: 'bond', bondTier: 'gov' }, requiredTestIds: ['test-1'] },
  {
    match: { assetKind: 'bond', bondTier: 'corporate' },
    requiredTestIds: ['test-1', 'test-2'],
  },
];

/** ОФЗ в симуляции: SU* и записи centrFinansOfz. */
export const GOV_BOND_SYMBOL_PREFIXES = ['SU'] as const;

export const GOV_BOND_SYMBOLS = new Set<string>([
  'RU000A107UW1',
  'RU000A10CRC4',
  'SU25072RMFS8',
  'SU25081RMFS9',
  'SU26207RMFS9',
  'SU26212RMFS9',
  'SU26218RMFS6',
  'SU26221RMFS0',
  'SU26227RMFS7',
  'SU26230RMFS1',
  'SU29010RMFS4',
  'SU46023RMFS6',
]);
