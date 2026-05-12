/**
 * Утилиты налогового сабсервиса TradingModule.
 *
 * Сейчас фиксированная ставка НДФЛ 13%; прогрессив (15% после 5 млн дохода)
 * планируется отдельно (вне рамок текущей итерации M4).
 */

export const NDFL_RATE = 0.13;

export interface AppliedNdfl {
  grossRub: number;
  taxBaseRub: number;
  taxRub: number;
  netRub: number;
}

/**
 * Универсальное удержание НДФЛ с базы `taxBaseRub`.
 * `grossRub` — общая сумма поступления (для проводок); `netRub = grossRub - taxRub`.
 * Налог удерживается только при положительной базе.
 */
export function applyNdfl(grossRub: number, taxBaseRub: number): AppliedNdfl {
  const safeBase = Math.max(0, taxBaseRub);
  const taxRub = Math.round(safeBase * NDFL_RATE * 100) / 100;
  const netRub = grossRub - taxRub;
  return {
    grossRub,
    taxBaseRub: safeBase,
    taxRub,
    netRub,
  };
}
