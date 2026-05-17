/**
 * Макропоказатели из шапки UI (см. docs/TZ_MARKET.txt): Brent ($/ббл), USD/RUB, ключевая ставка ЦБ (%).
 * MarketModule владеет срезом; значения резолвятся в macroResolve.ts по барам и расписанию KS.
 */
export interface MarketMacroSnapshot {
  /** Brent, USD за баррель */
  brentUsd: number | null;
  /** Курс USD к RUB */
  usdRub: number | null;
  /** Ключевая ставка ЦБ РФ, % годовых; null до первой даты в indexes/KS.txt */
  keyRatePct: number | null;
}

export const EMPTY_MARKET_MACRO_SNAPSHOT: Readonly<MarketMacroSnapshot> = {
  brentUsd: null,
  usdRub: null,
  keyRatePct: null,
};

/** @deprecated используйте EMPTY_MARKET_MACRO_SNAPSHOT */
export const STATIC_MARKET_MACRO_SNAPSHOT = EMPTY_MARKET_MACRO_SNAPSHOT;
