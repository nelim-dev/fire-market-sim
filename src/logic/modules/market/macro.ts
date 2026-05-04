/**
 * Макропоказатели из шапки UI (см. docs/TZ_MARKET.txt): Brent ($/ббл), USD/RUB, ключевая ставка ЦБ (%).
 *
 * Временный режим: фиксированные значения до отдельных исторических файлов (нефть, курс, ставка).
 * MarketModule владеет этим срезом; он не зависит от котировок инструментов.
 */
export interface MarketMacroSnapshot {
  /** Brent, USD за баррель */
  brentUsd: number;
  /** Курс USD к RUB */
  usdRub: number;
  /** Ключевая ставка ЦБ РФ, % годовых */
  keyRatePct: number;
}

/** Значения-заглушка в духе макета ТЗ (вторая строка хедера). */
export const STATIC_MARKET_MACRO_SNAPSHOT: Readonly<MarketMacroSnapshot> = {
  brentUsd: 65,
  usdRub: 75,
  keyRatePct: 6.0,
};
