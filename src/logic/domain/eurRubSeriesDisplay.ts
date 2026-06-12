/**
 * Finam EUR/RUB row (indexes/Eu.txt, analytics channel EU): OHLC stored ×1000.
 * Model / SQLite / npz keep raw scale; UI shows rubles per € (÷1000).
 */
export const EUR_RUB_DISPLAY_SYMBOL = 'EU';

export const EUR_RUB_SERIES_PRICE_DIVISOR = 1000;

export function isEurRubDisplaySymbol(symbol: string): boolean {
  const sym = symbol.toUpperCase();
  return sym === EUR_RUB_DISPLAY_SYMBOL || sym === 'EUR-RUB';
}

export function eurRubSeriesPriceToDisplayRub(seriesPrice: number): number {
  return seriesPrice / EUR_RUB_SERIES_PRICE_DIVISOR;
}

/** Stored series close → rub/€ for charts and labels. Other symbols unchanged. */
export function displayPriceRubForSymbol(symbol: string, seriesPrice: number): number {
  if (!Number.isFinite(seriesPrice)) {
    return seriesPrice;
  }
  return isEurRubDisplaySymbol(symbol)
    ? eurRubSeriesPriceToDisplayRub(seriesPrice)
    : seriesPrice;
}
