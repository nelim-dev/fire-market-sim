/**
 * Консольные тесты M2 (портфель в state + сид + производные). Запуск: npm run test:m2
 */
import { buildDemoPortfolio } from '../../src/data/portfolio/buildDemoPortfolio';
import {
  DEMO_INITIAL_CASH_RUB,
  DEMO_INITIAL_DEPOSIT_RUB,
} from '../../src/data/portfolio/demoPortfolioConstants';
import { LogicManager } from '../../src/logic/managers/LogicManager';
import {
  categoryMarketTotalRub,
  portfolioProfitPct,
  portfolioProfitRub,
  positionMarketValueRub,
  positionsByKind,
  securitiesMarketTotalRub,
  totalNavRub,
} from '../../src/logic/portfolio/portfolioDerived';
import {
  computePortfolioNavRub,
  selectPortfolioProfitForPeriod,
  selectUpcomingPayments,
} from '../../src/logic/modules/portfolio/selectors';
import type {
  PortfolioPosition,
  PortfolioState,
} from '../../src/logic/domain/portfolio';
import type {
  CouponDetail,
  DividendDetail,
  InstrumentDetailsCatalog,
} from '../../src/logic/modules/market/instrumentDetails';
import type { MarketInstrumentCatalogItem } from '../../src/logic/modules/market/contracts';
import { exitCode, printResult } from './runner';

const M = 'M2';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

function assertApprox(
  actual: number,
  expected: number,
  eps: number,
  label: string
): void {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: ожидали ~${expected}, получили ${actual}`);
  }
}

run('buildDemoPortfolio: кэш и количество позиций / выплат (3 реальных актива)', () => {
  const p = buildDemoPortfolio();
  if (p.cashRub !== DEMO_INITIAL_CASH_RUB) {
    throw new Error(`cashRub: ожидали ${DEMO_INITIAL_CASH_RUB}, ${p.cashRub}`);
  }
  if (p.positions.length !== 3) {
    throw new Error(`ожидали 3 позиции, ${p.positions.length}`);
  }
  if (p.upcomingPayments.length !== 0) {
    throw new Error(
      `ожидали 0 выплат (заполняются MARKET_*_DECLARED), ${p.upcomingPayments.length}`
    );
  }
});

run('buildDemoPortfolio: по одной позиции stock/bond/fund; индексов в портфеле нет', () => {
  const p = buildDemoPortfolio();
  const kinds = new Set(p.positions.map((x) => x.kind));
  for (const k of ['stock', 'bond', 'fund'] as const) {
    if (!kinds.has(k)) throw new Error(`нет позиций kind=${k}`);
  }
  if (kinds.has('index')) {
    throw new Error('индексов в портфеле быть не должно (непокупаемы)');
  }
  if (positionsByKind(p, 'stock').length !== 1) {
    throw new Error('акций должно быть 1 (SBER)');
  }
  if (positionsByKind(p, 'bond').length !== 1) {
    throw new Error('облигаций должно быть 1 (SU26227RMFS7)');
  }
  if (positionsByKind(p, 'fund').length !== 1) {
    throw new Error('фондов должно быть 1 (SBMM)');
  }
});

run('buildDemoPortfolio: у облигаций есть secondaryId (ISIN/код)', () => {
  const p = buildDemoPortfolio();
  for (const pos of positionsByKind(p, 'bond')) {
    if (!pos.secondaryId?.trim()) {
      throw new Error(`облигация ${pos.id} без secondaryId`);
    }
  }
});

run('portfolioDerived: сумма бумаг = 4 840 ₽, NAV = 154 840 ₽', () => {
  const p = buildDemoPortfolio();
  const sec = securitiesMarketTotalRub(p);
  assertApprox(sec, 4_840, 1, 'securities');
  const nav = totalNavRub(p);
  assertApprox(nav, 154_840, 2, 'NAV');
});

run('portfolioDerived: прибыль портфеля ~+910 ₽ к взносу 153 930 ₽', () => {
  const p = buildDemoPortfolio();
  assertApprox(portfolioProfitRub(p), 910, 2, 'profitRub');
  assertApprox(portfolioProfitPct(p), 0.5912, 0.01, 'profitPct');
});

run('portfolioDerived: категория акций = 2 800 ₽ (SBER 10×280)', () => {
  const p = buildDemoPortfolio();
  const st = categoryMarketTotalRub(p, 'stock');
  assertApprox(st, 2_800, 0.5, 'stocks market total');
});

run('LogicManager: в начальном state есть portfolio (3 позиции)', () => {
  const lm = new LogicManager();
  const port = lm.getState().portfolio;
  if (!port) throw new Error('portfolio отсутствует');
  if (port.positions.length !== 3) {
    throw new Error(`ожидали 3 позиции в state, ${port.positions.length}`);
  }
});

run('LogicManager: reset() восстанавливает тот же объём портфеля', () => {
  const lm = new LogicManager();
  const navBefore = totalNavRub(lm.getState().portfolio);
  lm.setTimeScalePreset(1000);
  lm.update(0.2);
  lm.reset();
  const navAfter = totalNavRub(lm.getState().portfolio);
  assertApprox(navAfter, navBefore, 0.01, 'NAV после reset');
  if (lm.getState().portfolio.positions.length !== 3) {
    throw new Error('после reset число позиций не 3');
  }
});

run('portfolioDerived: рыночная стоимость строки = qty × last', () => {
  const p = buildDemoPortfolio();
  const sber = p.positions.find((x) => x.id === 'pos-sber');
  if (!sber) throw new Error('нет pos-sber');
  const expected = 10 * 280;
  assertApprox(positionMarketValueRub(sber), expected, 1e-6, 'SBER mkt');
});

run(
  'selectPortfolioProfitForPeriod (all): profit = NAV − DEMO_INITIAL_DEPOSIT_RUB',
  () => {
    const p = buildDemoPortfolio();
    const now = Date.UTC(2020, 0, 10);
    const r = selectPortfolioProfitForPeriod(p, 'all', now);
    const navNow = computePortfolioNavRub(p);
    assertApprox(r.baselineRub, DEMO_INITIAL_DEPOSIT_RUB, 0.001, 'baseline=all');
    assertApprox(
      r.profitRub,
      navNow - DEMO_INITIAL_DEPOSIT_RUB,
      0.001,
      'profitRub(all)'
    );
  }
);

run(
  'selectPortfolioProfitForPeriod (week, без navHistory): fallback на депозит',
  () => {
    const p = buildDemoPortfolio();
    const now = Date.UTC(2020, 0, 10);
    const week = selectPortfolioProfitForPeriod(p, 'week', now);
    const all = selectPortfolioProfitForPeriod(p, 'all', now);
    assertApprox(
      week.baselineRub,
      DEMO_INITIAL_DEPOSIT_RUB,
      0.001,
      'baseline(week, нет истории) = депозит'
    );
    assertApprox(week.profitRub, all.profitRub, 0.001, 'profit week == all');
  }
);

run(
  'selectPortfolioProfitForPeriod: baseline = ближайший к границе периода snapshot',
  () => {
    const base = buildDemoPortfolio();
    const navNow = computePortfolioNavRub(base);
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2020, 6, 1);
    // По одному «эталонному» snapshot ровно на границе каждого периода + один глубже истории.
    const p = {
      ...base,
      navHistory: [
        { simulationEpochMs: now - 400 * dayMs, navRub: 100_000 },
        { simulationEpochMs: now - 365 * dayMs, navRub: 120_000 },
        { simulationEpochMs: now - 30 * dayMs, navRub: 140_000 },
        { simulationEpochMs: now - 7 * dayMs, navRub: 150_000 },
      ],
    };
    const week = selectPortfolioProfitForPeriod(p, 'week', now);
    const month = selectPortfolioProfitForPeriod(p, 'month', now);
    const year = selectPortfolioProfitForPeriod(p, 'year', now);
    assertApprox(week.baselineRub, 150_000, 0.001, 'week baseline (~7d ago)');
    assertApprox(month.baselineRub, 140_000, 0.001, 'month baseline (~30d ago)');
    assertApprox(year.baselineRub, 120_000, 0.001, 'year baseline (~365d ago)');
    assertApprox(week.profitRub, navNow - 150_000, 0.001, 'week profit');
    assertApprox(month.profitRub, navNow - 140_000, 0.001, 'month profit');
    assertApprox(year.profitRub, navNow - 120_000, 0.001, 'year profit');
  }
);

run(
  'selectPortfolioProfitForPeriod: история короче периода → fallback на депозит',
  () => {
    const base = buildDemoPortfolio();
    const now = Date.UTC(2020, 6, 1);
    const dayMs = 24 * 60 * 60 * 1000;
    // Только snapshot за 3 дня до now — для year(365d) истории не хватает.
    const p = {
      ...base,
      navHistory: [
        { simulationEpochMs: now - 3 * dayMs, navRub: 999_999 },
      ],
    };
    const year = selectPortfolioProfitForPeriod(p, 'year', now);
    assertApprox(
      year.baselineRub,
      DEMO_INITIAL_DEPOSIT_RUB,
      0.001,
      'year baseline (история моложе горизонта) = депозит'
    );
  }
);

run('PortfolioModule: команда portfolio/record-nav-snapshot пополняет navHistory', () => {
  const lm = new LogicManager();
  const t0 = lm.getState().simulationEpochMs;
  if (lm.getState().portfolio.navHistory.length !== 0) {
    throw new Error('navHistory в начальном state должно быть пустым');
  }
  lm.dispatchCommand({
    type: 'portfolio/record-nav-snapshot',
    simulationEpochMs: t0,
    navRub: 111_111,
  });
  lm.dispatchCommand({
    type: 'portfolio/record-nav-snapshot',
    simulationEpochMs: t0 + 86_400_000,
    navRub: 222_222,
  });
  lm.dispatchCommand({
    type: 'portfolio/record-nav-snapshot',
    simulationEpochMs: t0 + 86_400_000,
    navRub: 333_333,
  });
  lm.dispatchCommand({
    type: 'portfolio/record-nav-snapshot',
    simulationEpochMs: t0 - 1,
    navRub: 999_999,
  });
  const hist = lm.getState().portfolio.navHistory;
  if (hist.length !== 2) {
    throw new Error(`ожидали 2 снимка (dedup + idempot), ${hist.length}`);
  }
  if (hist[1].navRub !== 333_333) {
    throw new Error(`последний снимок должен быть обновлён до 333 333, получили ${hist[1].navRub}`);
  }
});

function makeUpcomingFixtures(now: number) {
  const DAY = 24 * 60 * 60_000;
  const stockPos: PortfolioPosition = {
    id: 'pos-x',
    kind: 'stock',
    ticker: 'XYZ',
    displayName: 'XYZ-name',
    lastPriceRub: 100,
    lots: [
      {
        id: 'lot-1',
        purchaseEpochMs: 0,
        quantity: 10,
        pricePerUnitRub: 100,
        nkdPaidAtBuyPerUnit: 0,
      },
    ],
  };
  const bondPos: PortfolioPosition = {
    id: 'pos-b',
    kind: 'bond',
    ticker: 'BND',
    displayName: 'BND-name',
    lastPriceRub: 900,
    lots: [
      {
        id: 'lot-1',
        purchaseEpochMs: 0,
        quantity: 5,
        pricePerUnitRub: 900,
        nkdPaidAtBuyPerUnit: 0,
      },
    ],
  };
  const portfolio: PortfolioState = {
    cashRub: 0,
    positions: [stockPos, bondPos],
    upcomingPayments: [],
    ledger: [],
    navHistory: [],
  };
  const dividends: DividendDetail[] = [
    { recordCloseDateEpochMs: now - 1 * DAY, perShareRub: 12, currency: 'RUB' }, // в прошлом
    { recordCloseDateEpochMs: now + 30 * DAY, perShareRub: 12, currency: 'RUB' }, // в окне
    { recordCloseDateEpochMs: now + 200 * DAY, perShareRub: 12, currency: 'RUB' }, // за горизонтом
  ];
  const coupons: CouponDetail[] = [
    {
      startDateEpochMs: now - 10 * DAY,
      payDateEpochMs: now + 7 * DAY,
      recordDateEpochMs: null,
      perBondRub: 50,
      faceValueAtTime: 1000,
    },
    {
      startDateEpochMs: now - 5 * DAY,
      payDateEpochMs: now + 90 * DAY,
      recordDateEpochMs: null,
      perBondRub: 50,
      faceValueAtTime: 1000,
    },
  ];
  const details: InstrumentDetailsCatalog = {
    lotSizeBySymbol: {},
    instrumentMetaBySymbol: {},
    dividendsBySymbol: { XYZ: dividends },
    couponsBySymbol: { BND: coupons },
    amortizationsBySymbol: {},
    redemptionBySymbol: {},
  };
  const catalog: MarketInstrumentCatalogItem[] = [
    {
      assetKind: 'stock',
      ticker: 'XYZ',
      symbol: 'XYZ',
      displayName: 'XYZ — Иванова',
      isin: '',
      sourceFilePath: '',
    },
    {
      assetKind: 'bond',
      ticker: 'BND',
      symbol: 'BND',
      displayName: 'BND — облигация',
      isin: '',
      sourceFilePath: '',
    },
  ];
  return { portfolio, details, catalog };
}

run(
  'selectUpcomingPayments: только выплаты в окне (по умолчанию 62 дня), отсортированы по дате',
  () => {
    const now = Date.UTC(2024, 5, 1);
    const { portfolio, details, catalog } = makeUpcomingFixtures(now);
    const out = selectUpcomingPayments(portfolio, details, catalog, now);
    if (out.length !== 2) {
      throw new Error(
        `ожидали 2 выплаты в 62-дневном окне (1 div через 30д + 1 coupon через 7д), получили ${out.length}`
      );
    }
    if (out[0].dueSimulationEpochMs > out[1].dueSimulationEpochMs) {
      throw new Error('должны быть отсортированы по дате по возрастанию');
    }
    if (out[0].kind !== 'coupon' || out[0].assetName !== 'BND — облигация') {
      throw new Error(`первая выплата: ожидали купон BND, получили ${out[0].kind}/${out[0].assetName}`);
    }
    if (out[0].amountRub !== 50 * 5) {
      throw new Error(`amount купона = perBond × qty = 50×5 = 250, получили ${out[0].amountRub}`);
    }
    if (out[1].kind !== 'dividend' || out[1].amountRub !== 12 * 10) {
      throw new Error(
        `вторая выплата: ожидали dividend amount=120 (12×10), получили ${out[1].kind}/${out[1].amountRub}`
      );
    }
  }
);

run(
  'selectUpcomingPayments: prev-выплаты и выплаты за горизонтом пропускаются',
  () => {
    const now = Date.UTC(2024, 5, 1);
    const { portfolio, details, catalog } = makeUpcomingFixtures(now);
    const out = selectUpcomingPayments(portfolio, details, catalog, now);
    for (const p of out) {
      if (p.dueSimulationEpochMs <= now) {
        throw new Error('прошедшие выплаты не должны попадать');
      }
      if (p.dueSimulationEpochMs > now + 62 * 24 * 60 * 60_000) {
        throw new Error('выплаты за горизонтом 62д не должны попадать');
      }
    }
  }
);

run(
  'selectUpcomingPayments: без позиций массив пуст',
  () => {
    const now = Date.UTC(2024, 5, 1);
    const { details, catalog } = makeUpcomingFixtures(now);
    const empty: PortfolioState = {
      cashRub: 0,
      positions: [],
      upcomingPayments: [],
      ledger: [],
      navHistory: [],
    };
    const out = selectUpcomingPayments(empty, details, catalog, now);
    if (out.length !== 0) {
      throw new Error(`без позиций ожидали 0, получили ${out.length}`);
    }
  }
);

run('buildDemoPortfolio: уникальные id позиций и выплат', () => {
  const p = buildDemoPortfolio();
  const ids = p.positions.map((x) => x.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('повтор id у позиций');
  }
  const payIds = p.upcomingPayments.map((x) => x.id);
  if (new Set(payIds).size !== payIds.length) {
    throw new Error('повтор id у выплат');
  }
});

exitCode(failures);
