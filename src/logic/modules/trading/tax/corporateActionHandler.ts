/**
 * Сабсервис tax внутри TradingModule.
 *
 * Ответственность:
 *  - слушать рыночные декларации слой A (`MARKET_*_DECLARED`);
 *  - определять реальное количество в позиции пользователя;
 *  - рассчитывать налоговую базу и удерживать НДФЛ;
 *  - диспатчить в PortfolioModule команды `credit-cash`/`debit-cash`/`append-ledger`/
 *    `clear-lot-nkd-at-buy`/`close-position`;
 *  - публиковать события слой B (`DIVIDEND_PAID`, `COUPON_PAID`, `BOND_REDEEMED`,
 *    `CAPITAL_GAIN_TAX_WITHHELD`).
 *
 * Этот код владеет налоговой логикой целиком — MarketModule только декларирует,
 * а PortfolioModule только применяет команды (см. план §5.2 / §8 / §9).
 */
import type { GameState } from '@/logic/managers/LogicManager';
import type {
  CapitalGainTaxWithheldPayload,
  MarketBondMaturedPayload,
  MarketCouponDeclaredPayload,
  MarketDividendDeclaredPayload,
} from '@/logic/logicEvents';
import {
  BOND_REDEEMED,
  CAPITAL_GAIN_TAX_WITHHELD,
  COUPON_PAID,
  DIVIDEND_PAID,
} from '@/logic/logicEvents';
import type {
  LedgerEntry,
  PortfolioPosition,
} from '@/logic/domain/portfolio';
import type {
  ModuleAttachContext,
  ModuleContext,
} from '@/logic/modules/contracts';
import { positionTotalQuantity } from '@/logic/modules/portfolio/selectors';
import { applyNdfl } from './taxCalculator';
import { calcCapitalGainFifo } from './capitalGainHandler';

export class TaxSubservice {
  private getState: (() => GameState | null) | null = null;

  /**
   * Вызывается из TradingModuleService.attach(). Подписки и доступ к state
   * настраиваются после полной инициализации LogicManager.
   */
  attach(getState: () => GameState | null, context: ModuleAttachContext): void {
    this.getState = getState;
    context.subscribe('MARKET_DIVIDEND_DECLARED', (p) =>
      this.onDividendDeclared(p, context)
    );
    context.subscribe('MARKET_COUPON_DECLARED', (p) =>
      this.onCouponDeclared(p, context)
    );
    context.subscribe('MARKET_BOND_MATURED', (p) =>
      this.onBondMatured(p, context)
    );
  }

  private findPosition(ticker: string): PortfolioPosition | null {
    const state = this.getState?.();
    if (!state) return null;
    const sym = ticker.toUpperCase();
    return (
      state.portfolio.positions.find((p) => p.ticker.toUpperCase() === sym) ??
      null
    );
  }

  private onDividendDeclared(
    payload: MarketDividendDeclaredPayload,
    context: ModuleContext
  ): void {
    const position = this.findPosition(payload.ticker);
    if (!position) return;
    const qty = positionTotalQuantity(position);
    if (qty <= 0) return;
    const grossRub = Math.round(payload.perShareRub * qty * 100) / 100;
    if (grossRub <= 0) return;
    const { taxRub, netRub, taxBaseRub } = applyNdfl(grossRub, grossRub);
    const ts = payload.simulationEpochMs;
    const tag = `dividend-${payload.ticker.toUpperCase()}-${ts}`;
    const grossEntry: LedgerEntry = {
      id: `${tag}-gross`,
      simulationEpochMs: ts,
      kind: 'dividend-gross',
      ticker: payload.ticker,
      amountRub: grossRub,
      quantity: qty,
    };
    if (taxRub > 0) {
      const taxEntry: LedgerEntry = {
        id: `${tag}-tax`,
        simulationEpochMs: ts,
        kind: 'dividend-tax',
        ticker: payload.ticker,
        amountRub: -taxRub,
        taxBaseRub,
      };
      // Сначала gross (зачисление), затем tax (списание). В журнале gross идёт первым (вверху).
      context.dispatchCommand({
        type: 'portfolio/credit-cash',
        amountRub: netRub,
        ledgerEntry: grossEntry,
      });
      context.dispatchCommand({
        type: 'portfolio/append-ledger',
        entry: taxEntry,
      });
    } else {
      context.dispatchCommand({
        type: 'portfolio/credit-cash',
        amountRub: grossRub,
        ledgerEntry: grossEntry,
      });
    }
    context.emit(DIVIDEND_PAID, {
      ticker: payload.ticker,
      qty,
      grossRub,
      taxRub,
      netRub,
      simulationEpochMs: ts,
    });
  }

  private onCouponDeclared(
    payload: MarketCouponDeclaredPayload,
    context: ModuleContext
  ): void {
    const position = this.findPosition(payload.ticker);
    if (!position) return;
    const qty = positionTotalQuantity(position);
    if (qty <= 0) return;
    const grossRub = Math.round(payload.perBondRub * qty * 100) / 100;
    if (grossRub <= 0) return;
    // База налога купона уменьшается на сумму НКД, уплаченного при покупке этих лотов.
    // См. план §5.3: `taxBase = grossRub - Σ(consumedQty × lot.nkdPaidAtBuyPerUnit)`.
    let nkdOffsetRub = 0;
    for (const lot of position.lots) {
      nkdOffsetRub += lot.quantity * lot.nkdPaidAtBuyPerUnit;
    }
    nkdOffsetRub = Math.min(nkdOffsetRub, grossRub);
    const taxBaseRub = grossRub - nkdOffsetRub;
    const { taxRub, netRub } = applyNdfl(grossRub, taxBaseRub);
    const ts = payload.simulationEpochMs;
    const tag = `coupon-${payload.ticker.toUpperCase()}-${ts}`;
    const grossEntry: LedgerEntry = {
      id: `${tag}-gross`,
      simulationEpochMs: ts,
      kind: 'coupon-gross',
      ticker: payload.ticker,
      amountRub: grossRub,
      quantity: qty,
    };
    if (taxRub > 0) {
      const taxEntry: LedgerEntry = {
        id: `${tag}-tax`,
        simulationEpochMs: ts,
        kind: 'coupon-tax',
        ticker: payload.ticker,
        amountRub: -taxRub,
        taxBaseRub,
      };
      context.dispatchCommand({
        type: 'portfolio/credit-cash',
        amountRub: netRub,
        ledgerEntry: grossEntry,
      });
      context.dispatchCommand({
        type: 'portfolio/append-ledger',
        entry: taxEntry,
      });
    } else {
      context.dispatchCommand({
        type: 'portfolio/credit-cash',
        amountRub: grossRub,
        ledgerEntry: grossEntry,
      });
    }
    // Сбрасываем NKD-at-buy у всех лотов тикера, чтобы не вычитать повторно
    // на следующих купонах (см. план §5.3).
    context.dispatchCommand({
      type: 'portfolio/clear-lot-nkd-at-buy',
      ticker: payload.ticker,
    });
    context.emit(COUPON_PAID, {
      ticker: payload.ticker,
      qty,
      grossRub,
      taxRub,
      netRub,
      taxBaseRub,
      simulationEpochMs: ts,
    });
  }

  private onBondMatured(
    payload: MarketBondMaturedPayload,
    context: ModuleContext
  ): void {
    const position = this.findPosition(payload.ticker);
    if (!position) return;
    const qty = positionTotalQuantity(position);
    if (qty <= 0) return;
    const gain = calcCapitalGainFifo(position, {
      quantity: qty,
      proceedsPerUnitRub: payload.faceValueRub,
      extraProceedsRub: 0,
      commissionRub: 0,
    });
    const taxOnGain =
      gain.realizedGainRub > 0
        ? applyNdfl(gain.realizedGainRub, gain.realizedGainRub).taxRub
        : 0;
    const grossRub = Math.round(payload.faceValueRub * qty * 100) / 100;
    const ts = payload.simulationEpochMs;
    const tag = `maturity-${payload.ticker.toUpperCase()}-${ts}`;
    const redemptionEntry: LedgerEntry = {
      id: `${tag}-redemption`,
      simulationEpochMs: ts,
      kind: 'redemption',
      ticker: payload.ticker,
      amountRub: grossRub,
      quantity: qty,
      priceRub: payload.faceValueRub,
    };
    if (taxOnGain > 0) {
      const taxEntry: LedgerEntry = {
        id: `${tag}-capital-gain-tax`,
        simulationEpochMs: ts,
        kind: 'capital-gain-tax',
        ticker: payload.ticker,
        amountRub: -taxOnGain,
        taxBaseRub: gain.realizedGainRub,
      };
      // Сначала зачисляем номинал (минус налог), затем фиксируем налог в журнале.
      context.dispatchCommand({
        type: 'portfolio/credit-cash',
        amountRub: grossRub - taxOnGain,
        ledgerEntry: redemptionEntry,
      });
      context.dispatchCommand({
        type: 'portfolio/append-ledger',
        entry: taxEntry,
      });
      const capPayload: CapitalGainTaxWithheldPayload = {
        tradeId: null,
        symbol: payload.ticker,
        gainRub: gain.realizedGainRub,
        taxRub: taxOnGain,
        simulationEpochMs: ts,
      };
      context.emit(CAPITAL_GAIN_TAX_WITHHELD, capPayload);
    } else {
      context.dispatchCommand({
        type: 'portfolio/credit-cash',
        amountRub: grossRub,
        ledgerEntry: redemptionEntry,
      });
    }
    context.dispatchCommand({
      type: 'portfolio/close-position',
      ticker: payload.ticker,
      reason: 'redemption',
    });
    context.emit(BOND_REDEEMED, {
      ticker: payload.ticker,
      qty,
      faceValueRub: payload.faceValueRub,
      simulationEpochMs: ts,
    });
  }
}
