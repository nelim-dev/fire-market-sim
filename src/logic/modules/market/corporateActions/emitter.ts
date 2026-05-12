import {
  MARKET_BOND_MATURED,
  MARKET_COUPON_DECLARED,
  MARKET_DIVIDEND_DECLARED,
} from '@/logic/logicEvents';
import type { ModuleContext } from '@/logic/modules/contracts';
import type { CorporateActionsState } from './state';
import { makePaymentId } from './state';
import type { ScannedDeclaration } from './scheduleScanner';

/**
 * Эмитит typed-события рыночных деклараций (слой A).
 * Гарантирует, что для одной (kind, ticker, epochMs) событие отправлено не более одного раза.
 */
export function emitDeclarations(
  state: CorporateActionsState,
  declarations: readonly ScannedDeclaration[],
  context: ModuleContext
): void {
  for (const d of declarations) {
    const id = makePaymentId(d.kind, d.ticker, d.epochMs);
    if (state.processedPaymentIds.has(id)) continue;
    state.processedPaymentIds.add(id);
    switch (d.kind) {
      case 'dividend':
        context.emit(MARKET_DIVIDEND_DECLARED, {
          ticker: d.ticker,
          perShareRub: d.perShareRub,
          simulationEpochMs: d.epochMs,
        });
        break;
      case 'coupon':
        context.emit(MARKET_COUPON_DECLARED, {
          ticker: d.ticker,
          perBondRub: d.perBondRub,
          simulationEpochMs: d.epochMs,
        });
        break;
      case 'maturity':
        context.emit(MARKET_BOND_MATURED, {
          ticker: d.ticker,
          faceValueRub: d.faceValueRub,
          simulationEpochMs: d.epochMs,
        });
        break;
      default: {
        const exhaustive: never = d;
        void exhaustive;
      }
    }
  }
}
