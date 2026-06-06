import type {
  LedgerEntry,
  LedgerEntryKind,
  PortfolioPosition,
  UpcomingPayment,
} from '@/logic/domain/portfolio';
import { DEMO_INITIAL_DEPOSIT_RUB } from '@/data/portfolio/demoPortfolioConstants';
import type { MarketInstrumentCatalogItem } from '@/logic/modules/market/contracts';
import type { InstrumentDetailsCatalog } from '@/logic/modules/market/instrumentDetails';
import type { PortfolioState } from './state';

/** Идентификаторы периодов для UI/селекторов изменения стоимости портфеля. */
export type PortfolioPeriodId = 'week' | 'month' | 'year' | 'all';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Горизонт периода в мс для week/month/year. Для `all` используется специальный baseline. */
const PERIOD_HORIZON_MS: Record<Exclude<PortfolioPeriodId, 'all'>, number> = {
  week: 7 * MS_PER_DAY,
  month: 30 * MS_PER_DAY,
  year: 365 * MS_PER_DAY,
};

export const selectPortfolioCashRub = (state: PortfolioState): number =>
  state.cashRub;

export const selectPortfolioLedger = (state: PortfolioState) => state.ledger;

/**
 * @deprecated используйте `selectPortfolioLedger`; оставлено для обратной совместимости в UI/тестах.
 */
export const selectPortfolioTradeLedger = (state: PortfolioState) =>
  state.ledger;

/**
 * Суммарное количество единиц в позиции, агрегированное по партиям.
 * Замена устаревшему полю `position.quantity` (см. план §2.2).
 */
export function positionTotalQuantity(position: PortfolioPosition): number {
  let total = 0;
  for (const lot of position.lots) {
    total += lot.quantity;
  }
  return total;
}

/**
 * Средневзвешенная цена входа по партиям (с учётом размазанной buy-side комиссии),
 * в ₽ за единицу. Если позиция пуста — возвращает 0.
 * Замена устаревшему полю `position.avgPriceRub`.
 */
export function positionAvgPriceRub(position: PortfolioPosition): number {
  let totalQty = 0;
  let totalCost = 0;
  for (const lot of position.lots) {
    totalQty += lot.quantity;
    totalCost += lot.quantity * lot.pricePerUnitRub;
  }
  if (totalQty <= 0) return 0;
  return totalCost / totalQty;
}

/**
 * Фильтр журнала по типам записей.
 * Удобен для UI/тестов: `selectLedgerByKind(state, ['trade-buy', 'trade-sell'])`.
 */
export function selectLedgerByKind(
  state: PortfolioState,
  kinds: readonly LedgerEntryKind[]
): LedgerEntry[] {
  const allowed = new Set<LedgerEntryKind>(kinds);
  return state.ledger.filter((entry) => allowed.has(entry.kind));
}

/**
 * Текущий NAV портфеля: cash + Σ (qty × lastPriceRub) по позициям.
 * Используется и в селекторах прибыли, и в PortfolioModule для дневных snapshot'ов.
 */
export function computePortfolioNavRub(state: PortfolioState): number {
  let nav = state.cashRub;
  for (const p of state.positions) {
    nav += positionTotalQuantity(p) * p.lastPriceRub;
  }
  return nav;
}

/**
 * Найти baseline NAV для расчёта изменения стоимости за период.
 *
 * Идея: ищем snapshot, ближайший по времени к «началу периода» (now − horizon).
 * Если история ещё короче периода (самый старый snapshot моложе threshold),
 * возвращаем null — селектор сделает fallback на депозит, чтобы UI не врал.
 *
 * NB: `navHistory` отсортирован по возрастанию `simulationEpochMs` (см. service.ts),
 * поэтому `navHistory[0]` — самый старый.
 */
export function findBaselineNavRub(
  state: PortfolioState,
  thresholdEpochMs: number
): number | null {
  const hist = state.navHistory;
  if (hist.length === 0) return null;
  if (hist[0].simulationEpochMs > thresholdEpochMs) return null;
  let best = hist[0];
  let bestDist = Math.abs(best.simulationEpochMs - thresholdEpochMs);
  for (let i = 1; i < hist.length; i++) {
    const s = hist[i];
    const d = Math.abs(s.simulationEpochMs - thresholdEpochMs);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best.navRub;
}

/**
 * Горизонт «ближайших выплат» по умолчанию: 2 месяца (≈ 62 дня).
 * Используется UI-карточкой «Ближайшие выплаты» в портфеле.
 */
export const UPCOMING_PAYMENTS_DEFAULT_HORIZON_MS = 62 * 24 * 60 * 60_000;

/**
 * Спроецировать «ближайшие выплаты» по позициям пользователя на горизонт `horizonMs` от `nowEpochMs`.
 *
 * Источники (read-only):
 *  - `details.dividendsBySymbol` — расписание дивидендов (`recordCloseDateEpochMs`).
 *    NB: даты отсечки реестра используются как ориентир «дата получения»,
 *    т.к. отдельной payment date в исходных данных нет (см. план §2.1, §5.2).
 *  - `details.couponsBySymbol` — расписание купонов (`payDateEpochMs`).
 *  - `instruments` — для `displayName` тикера (fallback на `position.displayName`).
 *
 * Не модифицирует state. Возвращает массив `UpcomingPayment`, отсортированный
 * по дате выплаты по возрастанию. Это полностью производное представление —
 * `portfolio.upcomingPayments` в state не используется и оставлен для совместимости.
 */
export function selectUpcomingPayments(
  portfolio: PortfolioState,
  details: InstrumentDetailsCatalog,
  instruments: readonly MarketInstrumentCatalogItem[],
  nowEpochMs: number,
  horizonMs: number = UPCOMING_PAYMENTS_DEFAULT_HORIZON_MS
): UpcomingPayment[] {
  if (horizonMs <= 0 || portfolio.positions.length === 0) return [];
  const horizonEnd = nowEpochMs + horizonMs;
  const tickerToName = new Map<string, string>();
  for (const it of instruments) {
    tickerToName.set(it.symbol.toUpperCase(), it.displayName);
  }
  const out: UpcomingPayment[] = [];
  for (const pos of portfolio.positions) {
    const ticker = pos.ticker.toUpperCase();
    const qty = positionTotalQuantity(pos);
    if (qty <= 0) continue;
    const assetName = tickerToName.get(ticker) ?? pos.displayName;

    if (pos.kind === 'stock' || pos.kind === 'fund') {
      const divs = details.dividendsBySymbol[ticker] ?? [];
      for (const d of divs) {
        if (d.recordCloseDateEpochMs <= nowEpochMs) continue;
        if (d.recordCloseDateEpochMs > horizonEnd) continue;
        out.push({
          id: `upc-div-${ticker}-${d.recordCloseDateEpochMs}`,
          kind: 'dividend',
          assetName,
          amountRub: d.perShareRub * qty,
          dueSimulationEpochMs: d.recordCloseDateEpochMs,
        });
      }
    }

    if (pos.kind === 'bond') {
      const coupons = details.couponsBySymbol[ticker] ?? [];
      for (const c of coupons) {
        if (c.payDateEpochMs <= nowEpochMs) continue;
        if (c.payDateEpochMs > horizonEnd) continue;
        out.push({
          id: `upc-cpn-${ticker}-${c.payDateEpochMs}`,
          kind: 'coupon',
          assetName,
          amountRub: c.perBondRub * qty,
          dueSimulationEpochMs: c.payDateEpochMs,
        });
      }
    }
  }
  out.sort((a, b) => a.dueSimulationEpochMs - b.dueSimulationEpochMs);
  return out;
}

/**
 * Изменение стоимости портфеля за выбранный период.
 *
 * - `all`: baseline = `DEMO_INITIAL_DEPOSIT_RUB`, profit = NAV − депозит.
 * - `week/month/year`: baseline = первый дневной snapshot ≥ (now − horizon),
 *   fallback на депозит, если истории ещё нет (пользователь только что зашёл).
 *
 * `profitPct` нормализован к baseline (или к депозиту, если baseline = 0).
 */
export function selectPortfolioProfitForPeriod(
  state: PortfolioState,
  periodId: PortfolioPeriodId,
  nowEpochMs: number
): { profitRub: number; profitPct: number; baselineRub: number } {
  const navNow = computePortfolioNavRub(state);
  let baseline: number;
  if (periodId === 'all') {
    baseline = DEMO_INITIAL_DEPOSIT_RUB;
  } else {
    const horizonMs = PERIOD_HORIZON_MS[periodId];
    const threshold = nowEpochMs - horizonMs;
    baseline = findBaselineNavRub(state, threshold) ?? DEMO_INITIAL_DEPOSIT_RUB;
  }
  const profitRub = navNow - baseline;
  const denom = baseline !== 0 ? baseline : DEMO_INITIAL_DEPOSIT_RUB;
  const profitPct = denom !== 0 ? (profitRub / denom) * 100 : 0;
  return { profitRub, profitPct, baselineRub: baseline };
}
