import { KEY_RATE_FILE_STEM } from './macroSymbols';

/** Файлы в `indexes/` и др., которые не являются торгуемыми/графикуемыми инструментами. */
export const CATALOG_EXCLUDED_FILE_STEMS = new Set<string>([
  KEY_RATE_FILE_STEM.toUpperCase(),
]);

export function isExcludedFromMarketCatalog(fileStem: string): boolean {
  return CATALOG_EXCLUDED_FILE_STEMS.has(fileStem.toUpperCase());
}
