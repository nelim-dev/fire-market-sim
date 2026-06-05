/** Стартовый кэш (наличные), ₽ */
export const DEMO_INITIAL_CASH_RUB = 150_000;

/**
 * Условный «взнос» игрока на момент старта симуляции.
 * Подобран как `cash + Σ(cost_basis позиций демо-сида)`:
 * 150 000 (кэш) + 2 000 (SBER 10×200) + 1 800 (SU26227RMFS7 2×900) + 130 (DN-R 10×13) = 153 930 ₽.
 * `portfolioProfitRub = totalNav − DEMO_INITIAL_DEPOSIT_RUB` поэтому отражает
 * чистый прирост курсовой стоимости позиций относительно средних цен покупки.
 */
export const DEMO_INITIAL_DEPOSIT_RUB = 153_930;
