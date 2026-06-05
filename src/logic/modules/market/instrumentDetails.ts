/**
 * Типы и загрузчик каталога не-ценовой информации инструментов
 * (см. `scripts/build-instrument-details-catalog.ts`).
 */
import detailsJson from '@/data/generated/marketInstrumentDetailsCatalog.json';

export interface InstrumentMetaDetail {
  isBond: boolean;
  initialFaceValueRub: number | null;
  faceUnit: string | null;
  maturityEpochMs: number | null;
  /** Первая минутная котировка в файле ряда (Europe/Moscow), из gen:instrument-details. */
  firstTradeEpochMs?: number | null;
  isin: string | null;
  groupRaw: string | null;
}

export interface DividendDetail {
  recordCloseDateEpochMs: number;
  perShareRub: number;
  currency: string;
}

export interface CouponDetail {
  startDateEpochMs: number;
  payDateEpochMs: number;
  recordDateEpochMs: number | null;
  perBondRub: number;
  faceValueAtTime: number;
}

export interface AmortizationDetail {
  amortDateEpochMs: number;
  faceValueRub: number;
  initialFaceValueRub: number;
  amortRubPerBond: number;
  /** 'maturity' — финальное погашение; иначе — промежуточная амортизация. */
  dataSource: string;
}

export interface RedemptionDetail {
  maturityEpochMs: number;
  faceValueRub: number;
}

export interface InstrumentDetailsCatalog {
  generatedAt?: string;
  lotSizeBySymbol: Record<string, number>;
  /** Количество акций в обращении (MOEX ISSUESIZE), шт. */
  sharesOutstandingBySymbol?: Record<string, number>;
  instrumentMetaBySymbol: Record<string, InstrumentMetaDetail>;
  dividendsBySymbol: Record<string, DividendDetail[]>;
  couponsBySymbol: Record<string, CouponDetail[]>;
  amortizationsBySymbol: Record<string, AmortizationDetail[]>;
  redemptionBySymbol: Record<string, RedemptionDetail>;
  /** Символы с бесконечной ликвидностью: фиксированный qty bid/ask по текущей цене. */
  staticOrderBookLotsBySymbol?: Record<string, number>;
}

const EMPTY_CATALOG: InstrumentDetailsCatalog = {
  lotSizeBySymbol: {},
  instrumentMetaBySymbol: {},
  dividendsBySymbol: {},
  couponsBySymbol: {},
  amortizationsBySymbol: {},
  redemptionBySymbol: {},
};

let cachedCatalog: InstrumentDetailsCatalog | null = null;

export function loadInstrumentDetailsCatalog(): InstrumentDetailsCatalog {
  if (cachedCatalog) return cachedCatalog;
  const raw = detailsJson as Partial<InstrumentDetailsCatalog> | null;
  if (!raw || typeof raw !== 'object') {
    cachedCatalog = EMPTY_CATALOG;
    return cachedCatalog;
  }
  cachedCatalog = {
    generatedAt: raw.generatedAt,
    lotSizeBySymbol: raw.lotSizeBySymbol ?? {},
    sharesOutstandingBySymbol: raw.sharesOutstandingBySymbol ?? {},
    instrumentMetaBySymbol: raw.instrumentMetaBySymbol ?? {},
    dividendsBySymbol: raw.dividendsBySymbol ?? {},
    couponsBySymbol: raw.couponsBySymbol ?? {},
    amortizationsBySymbol: raw.amortizationsBySymbol ?? {},
    redemptionBySymbol: raw.redemptionBySymbol ?? {},
    staticOrderBookLotsBySymbol: raw.staticOrderBookLotsBySymbol ?? {},
  };
  return cachedCatalog;
}

/**
 * Текущий номинал облигации на момент `t` (₽).
 * Учитывает все амортизации с `amortDateEpochMs ≤ t`, выбирая последнюю фактическую `faceValueRub`.
 *
 * TODO(amortization): сейчас в данных у нас амортизации присутствуют только в виде
 *  финального погашения (`dataSource: 'maturity'`). Когда появятся промежуточные
 *  амортизации (несколько строк до maturity), эта функция автоматически их учтёт.
 *  Дополнительно потребуется поддержка пропорционального уменьшения `faceValueRub`
 *  внутри купонного периода — см. план §12.
 */
export function faceValueAtTime(
  symbol: string,
  t: number,
  catalog: InstrumentDetailsCatalog
): number | null {
  const initial = catalog.instrumentMetaBySymbol[symbol.toUpperCase()]?.initialFaceValueRub ?? null;
  const amorts = catalog.amortizationsBySymbol[symbol.toUpperCase()] ?? [];
  if (amorts.length === 0) return initial;
  let active = initial;
  for (const a of amorts) {
    if (a.amortDateEpochMs > t) break;
    active = a.faceValueRub;
  }
  return active;
}

/**
 * Линейный НКД на момент `t`, ₽ за облигацию.
 * Формула:
 *   nkd(t) = perBondRub × (t - startDate) / (payDate - startDate), если startDate ≤ t < payDate.
 * На дату выплаты и после maturity — 0.
 * Соответствует плану §2.1 и §5.2.
 */
export function nkdPerBondRubAt(
  symbol: string,
  t: number,
  catalog: InstrumentDetailsCatalog
): number {
  const coupons = catalog.couponsBySymbol[symbol.toUpperCase()] ?? [];
  if (coupons.length === 0) return 0;
  for (const c of coupons) {
    if (t < c.startDateEpochMs) return 0;
    if (t >= c.startDateEpochMs && t < c.payDateEpochMs) {
      const span = c.payDateEpochMs - c.startDateEpochMs;
      if (span <= 0) return 0;
      const elapsed = t - c.startDateEpochMs;
      const ratio = Math.min(1, Math.max(0, elapsed / span));
      return Math.round(c.perBondRub * ratio * 100) / 100;
    }
  }
  return 0;
}
