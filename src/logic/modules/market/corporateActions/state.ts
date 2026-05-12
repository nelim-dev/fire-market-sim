/**
 * Состояние сабсервиса corporateActions внутри MarketModule.
 * Хранит уникальные id уже эмитированных деклараций, чтобы избежать дублирования
 * при backfill (например, после прыжка симуляции при первом старте).
 */
export interface CorporateActionsState {
  /** processedPaymentIds: hashset из строк `kind:ticker:epochMs`. */
  processedPaymentIds: Set<string>;
}

export function createCorporateActionsState(): CorporateActionsState {
  return { processedPaymentIds: new Set<string>() };
}

export function makePaymentId(
  kind: 'dividend' | 'coupon' | 'maturity',
  ticker: string,
  epochMs: number
): string {
  return `${kind}:${ticker.toUpperCase()}:${epochMs}`;
}
