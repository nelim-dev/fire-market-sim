/**
 * Модель портфеля (M2): демо-состояние без рынка и без сделок.
 * Расширение под фонды/облигации — через union kind.
 */

export type PortfolioAssetKind = 'stock' | 'index' | 'fund' | 'bond';

export type UpcomingPaymentKind = 'dividend' | 'coupon';

export interface PortfolioPosition {
  id: string;
  kind: PortfolioAssetKind;
  /** Краткий тикер (акции, индексы, фонды) */
  ticker: string;
  displayName: string;
  /** Для облигаций — ISIN или внутренний код; для акций дублирует ticker или пусто */
  secondaryId?: string;
  quantity: number;
  /** Средняя цена входа, ₽ */
  avgPriceRub: number;
  /** «Текущая» цена в M2 — из сида; позже подставит рынок */
  lastPriceRub: number;
}

export interface UpcomingPayment {
  id: string;
  kind: UpcomingPaymentKind;
  assetName: string;
  amountRub: number;
  /** Дата выплаты для отображения (симуляция); в M2 можно совпадать с календарём */
  dueSimulationEpochMs: number;
}

export interface PortfolioState {
  cashRub: number;
  positions: PortfolioPosition[];
  upcomingPayments: UpcomingPayment[];
}
