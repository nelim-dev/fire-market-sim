import type { PortfolioPosition } from '@/logic/domain/portfolio';
import type { ConsumedLot } from '@/logic/logicEvents';

export interface CapitalGainContext {
  /** Сколько единиц задействовано в реализации. */
  quantity: number;
  /** Цена реализации за единицу (для sell — `priceRub`, для maturity — `faceValueRub`). */
  proceedsPerUnitRub: number;
  /** Дополнительные доходы (НКД при продаже). Для maturity — 0. */
  extraProceedsRub: number;
  /** Комиссия sell-side (для maturity — 0). */
  commissionRub: number;
}

export interface CapitalGainResult {
  consumedLots: ConsumedLot[];
  /** Σ (lot.pricePerUnitRub + lot.nkdPaidAtBuyPerUnit) × consumedQty */
  costBasisFromLotsRub: number;
  /** Полный cost basis: from-lots + commissionRub. */
  costBasisRub: number;
  /** proceedsPerUnitRub × quantity + extraProceedsRub */
  grossProceedsRub: number;
  realizedGainRub: number;
}

/**
 * FIFO-расчёт реализованной прибыли и потреблённых партий по позиции.
 * Используется и для sell (trading/service), и для maturity (tax/corporateActionHandler):
 * формула единая (см. план §5.3).
 */
export function calcCapitalGainFifo(
  position: PortfolioPosition,
  ctx: CapitalGainContext
): CapitalGainResult {
  let remaining = ctx.quantity;
  const consumedLots: ConsumedLot[] = [];
  let costBasisFromLotsRub = 0;
  for (const lot of position.lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.quantity, remaining);
    if (take <= 0) continue;
    consumedLots.push({
      lotId: lot.id,
      consumedQty: take,
      pricePerUnitRub: lot.pricePerUnitRub,
      nkdPaidAtBuyPerUnit: lot.nkdPaidAtBuyPerUnit,
    });
    costBasisFromLotsRub += (lot.pricePerUnitRub + lot.nkdPaidAtBuyPerUnit) * take;
    remaining -= take;
  }
  const grossProceedsRub =
    ctx.proceedsPerUnitRub * ctx.quantity + ctx.extraProceedsRub;
  const costBasisRub = costBasisFromLotsRub + ctx.commissionRub;
  const realizedGainRub = grossProceedsRub - costBasisRub;
  return {
    consumedLots,
    costBasisFromLotsRub,
    costBasisRub,
    grossProceedsRub,
    realizedGainRub,
  };
}
