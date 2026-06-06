/**
 * Модель портфеля.
 *
 * - Позиции хранятся партиями (FIFO): `PortfolioPosition.lots[]`. Производные
 *   значения `quantity` и `avgPriceRub` доступны через селекторы
 *   `positionTotalQuantity` / `positionAvgPriceRub` (см. `modules/portfolio/selectors.ts`).
 *   Это нужно для корректного расчёта реализованной прибыли и капитал-гейн налога
 *   (см. план M4 §5).
 * - История финансовых операций — единый журнал `ledger` с discriminated union
 *   по `kind`. Старая структура `TradeLedgerEntry` заменена.
 */

export type PortfolioAssetKind = 'stock' | 'index' | 'fund' | 'bond';

export type UpcomingPaymentKind = 'dividend' | 'coupon';
export type TradeAction = 'buy' | 'sell';

/**
 * Партия (lot) — единичная покупка одного и того же тикера.
 * Списывается в FIFO-порядке при продаже / погашении.
 */
export interface PositionLot {
  id: string;
  purchaseEpochMs: number;
  quantity: number;
  /** Цена за единицу с учётом размазанной комиссии buy-side, ₽. Для бондов — чистая цена в ₽ (без НКД). */
  pricePerUnitRub: number;
  /**
   * Для бондов — НКД, уплаченный за единицу при покупке.
   * Используется в расчёте налоговой базы (см. план §5.3):
   *  - уменьшает базу следующего купона по этой партии;
   *  - входит в cost basis при продаже/погашении (если ещё не скомпенсирован).
   * После выплаты купона для тикера обнуляется командой `portfolio/clear-lot-nkd-at-buy`.
   * Для не-бондов всегда 0.
   */
  nkdPaidAtBuyPerUnit: number;
}

export interface PortfolioPosition {
  id: string;
  kind: PortfolioAssetKind;
  /** Краткий тикер (акции, индексы, фонды) */
  ticker: string;
  displayName: string;
  /** Для облигаций — ISIN или внутренний код; для акций дублирует ticker или пусто */
  secondaryId?: string;
  /** Партии в порядке FIFO (старые в начале). */
  lots: PositionLot[];
  /** «Текущая» цена в M2 — из сида; позже подставляет рынок. */
  lastPriceRub: number;
}

export interface UpcomingPayment {
  id: string;
  kind: UpcomingPaymentKind;
  assetName: string;
  amountRub: number;
  /** Дата выплаты для отображения (симуляция); в M2 может совпадать с календарём. */
  dueSimulationEpochMs: number;
}

/**
 * Категории записей в едином финансовом журнале.
 * Любой денежный/налоговый/комиссионный/корпоративный effect — отдельная запись с этим `kind`.
 */
export type LedgerEntryKind =
  | 'trade-buy'
  | 'trade-sell'
  | 'commission'
  | 'accrued-coupon-paid'
  | 'accrued-coupon-received'
  | 'dividend-gross'
  | 'dividend-tax'
  | 'coupon-gross'
  | 'coupon-tax'
  | 'capital-gain-tax'
  | 'redemption';

/**
 * Запись финансового журнала.
 * `amountRub` знаковая: `+` — поступление на cash, `-` — списание.
 * `taxBaseRub` заполняется для записей `*-tax` и хранит базу, с которой удержан налог.
 */
export interface LedgerEntry {
  id: string;
  simulationEpochMs: number;
  kind: LedgerEntryKind;
  ticker: string;
  amountRub: number;
  quantity?: number;
  priceRub?: number;
  taxBaseRub?: number;
  relatedTradeId?: string;
  notes?: string;
}

/**
 * Снимок суммарной стоимости портфеля (NAV = cash + Σ qty × price)
 * на конкретный момент симуляционного времени.
 * Записывается раз в торговый день (по событию `TRADING_DAY_CHANGED`) и
 * используется селектором изменения стоимости за период (неделя/месяц/год).
 */
export interface NavSnapshot {
  readonly simulationEpochMs: number;
  readonly navRub: number;
}

export type CompositionSlice = {
  readonly id: string;
  /** Тикер или «Кэш». */
  readonly ticker: string;
  /** Отображаемое название актива. */
  readonly label: string;
  readonly valueRub: number;
  readonly pct: number;
};

export type PortfolioCompositionSnapshot = {
  readonly simulationEpochMs: number;
  readonly slices: readonly CompositionSlice[];
};

export type VsFireidxSnapshotMode = 'earliest-available' | 'rolling-1y';

export type VsFireidxSnapshot = {
  readonly recordedAtEpochMs: number;
  readonly baselineEpochMs: number;
  readonly navBaselineRub: number;
  readonly indexBaselineLevel: number;
  readonly mode: VsFireidxSnapshotMode;
};

export interface PortfolioState {
  cashRub: number;
  /** Зарезервировано под открытые buy-заявки. */
  cashReservedRub: number;
  /** Зарезервировано под открытые sell-заявки (по тикеру). */
  reservedQtyBySymbol: Record<string, number>;
  positions: PortfolioPosition[];
  /**
   * @deprecated Не заполняется и не используется в UI. «Ближайшие выплаты»
   * проецируются селектором `selectUpcomingPayments(portfolio, details, ...)`
   * на основе `market.details` и текущих позиций — см.
   * `src/logic/modules/portfolio/selectors.ts`.
   * Оставлено для совместимости с тестами/сидом до следующего рефактора.
   */
  upcomingPayments: UpcomingPayment[];
  /** Единый финансовый журнал (был `tradeLedger`, оставлен как `ledger`). */
  ledger: LedgerEntry[];
  /**
   * Дневные снимки NAV, упорядочены по `simulationEpochMs` по возрастанию.
   * Используются для расчёта изменения стоимости портфеля за период (1н/1м/1г).
   */
  navHistory: NavSnapshot[];
  /** Кэш состава портфеля для диаграммы (обновляется раз в торговый день). */
  compositionSnapshot: PortfolioCompositionSnapshot | null;
  /** Якорь сравнения с FIRE INDEX (обновляется раз в торговый день). */
  vsFireidxSnapshot: VsFireidxSnapshot | null;
}
