import type { InstrumentDetailsCatalog } from '../instrumentDetails';
import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import { computeDividendEligibilityCutoffEpochMs } from './dividendEligibility';

/**
 * Объект декларации, найденный сканером для эмиссии.
 * Подписчики из TradingModule.tax уже знают как применить его к портфелю.
 */
export type ScannedDeclaration =
  | {
      kind: 'dividend';
      ticker: string;
      epochMs: number;
      perShareRub: number;
    }
  | {
      kind: 'coupon';
      ticker: string;
      epochMs: number;
      perBondRub: number;
    }
  | {
      kind: 'maturity';
      ticker: string;
      epochMs: number;
      faceValueRub: number;
    };

/**
 * Возвращает все декларации, попавшие в окно `(prevEpochMs, currentEpochMs]`.
 * - dividend: emit на «cut-off для участия в реестре» = `recordCloseDate - N торговых дней`,
 *   где N зависит от эры settlement-цикла Мосбиржи (T+0 / T+2 / T+1).
 *   См. `dividendEligibility.ts`. На этот момент TradingModule.tax проверит позиции
 *   игрока: купивший после cutoff дивиденд не получит, что воспроизводит реальное
 *   правило биржи. Если `calendar=null` (или дата попадает в эру T+0) — fallback
 *   на `recordCloseDateEpochMs` (поведение до правки).
 * - coupon:   emit на `payDateEpochMs` (в данных уже честная дата выплаты).
 * - maturity: emit на `maturityEpochMs` (берётся из redemptionBySymbol;
 *   промежуточные амортизации сейчас не эмитируются).
 *
 * TODO(amortization): добавить ScannedDeclaration kind='amortization' и emit на каждую промежуточную
 *   `amortizationsBySymbol[*].amortDateEpochMs` (когда `dataSource !== 'maturity'`).
 *   См. план §12.
 */
export function scanScheduleWindow(
  details: InstrumentDetailsCatalog,
  prevEpochMs: number,
  currentEpochMs: number,
  calendar: TradingCalendar | null = null
): ScannedDeclaration[] {
  if (currentEpochMs <= prevEpochMs) return [];
  const out: ScannedDeclaration[] = [];
  for (const [ticker, list] of Object.entries(details.dividendsBySymbol)) {
    for (const d of list) {
      const emitEpochMs = computeDividendEligibilityCutoffEpochMs(
        calendar,
        d.recordCloseDateEpochMs
      );
      if (emitEpochMs > prevEpochMs && emitEpochMs <= currentEpochMs) {
        out.push({
          kind: 'dividend',
          ticker,
          epochMs: emitEpochMs,
          perShareRub: d.perShareRub,
        });
      }
    }
  }
  for (const [ticker, list] of Object.entries(details.couponsBySymbol)) {
    for (const c of list) {
      if (c.payDateEpochMs > prevEpochMs && c.payDateEpochMs <= currentEpochMs) {
        out.push({
          kind: 'coupon',
          ticker,
          epochMs: c.payDateEpochMs,
          perBondRub: c.perBondRub,
        });
      }
    }
  }
  for (const [ticker, r] of Object.entries(details.redemptionBySymbol)) {
    if (r.maturityEpochMs > prevEpochMs && r.maturityEpochMs <= currentEpochMs) {
      out.push({
        kind: 'maturity',
        ticker,
        epochMs: r.maturityEpochMs,
        faceValueRub: r.faceValueRub,
      });
    }
  }
  out.sort((a, b) => a.epochMs - b.epochMs);
  return out;
}
