/**
 * Консольные тесты M2 (портфель в state + сид + производные). Запуск: npm run test:m2
 */
import { buildDemoPortfolio } from '../../src/data/portfolio/buildDemoPortfolio';
import { DEMO_INITIAL_CASH_RUB } from '../../src/data/portfolio/demoPortfolioConstants';
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

run('buildDemoPortfolio: кэш и количество позиций / выплат', () => {
  const p = buildDemoPortfolio();
  if (p.cashRub !== DEMO_INITIAL_CASH_RUB) {
    throw new Error(`cashRub: ожидали ${DEMO_INITIAL_CASH_RUB}, ${p.cashRub}`);
  }
  if (p.positions.length !== 8) {
    throw new Error(`ожидали 8 позиций, ${p.positions.length}`);
  }
  if (p.upcomingPayments.length !== 3) {
    throw new Error(`ожидали 3 выплаты, ${p.upcomingPayments.length}`);
  }
});

run('buildDemoPortfolio: по одному виду stock, index, bond, fund', () => {
  const p = buildDemoPortfolio();
  const kinds = new Set(p.positions.map((x) => x.kind));
  for (const k of ['stock', 'index', 'bond', 'fund'] as const) {
    if (!kinds.has(k)) throw new Error(`нет позиций kind=${k}`);
  }
  if (positionsByKind(p, 'stock').length !== 3) {
    throw new Error('акций должно быть 3');
  }
  if (positionsByKind(p, 'index').length !== 2) {
    throw new Error('индексов должно быть 2');
  }
  if (positionsByKind(p, 'bond').length !== 2) {
    throw new Error('облигаций должно быть 2');
  }
  if (positionsByKind(p, 'fund').length !== 1) {
    throw new Error('фондов должна быть 1 позиция');
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

run('portfolioDerived: сумма бумаг + кэш = NAV (~450k)', () => {
  const p = buildDemoPortfolio();
  const sec = securitiesMarketTotalRub(p);
  assertApprox(sec, 300_000, 1, 'securities');
  const nav = totalNavRub(p);
  assertApprox(nav, 450_000, 2, 'NAV');
});

run('portfolioDerived: прибыль портфеля ~+50k и ~12.5% к взносу', () => {
  const p = buildDemoPortfolio();
  assertApprox(portfolioProfitRub(p), 50_000, 2, 'profitRub');
  assertApprox(portfolioProfitPct(p), 12.5, 0.02, 'profitPct');
});

run('portfolioDerived: категория акций = 100005 ₽ по сиду', () => {
  const p = buildDemoPortfolio();
  const st = categoryMarketTotalRub(p, 'stock');
  assertApprox(st, 100_005, 0.5, 'stocks market total');
});

run('LogicManager: в начальном state есть portfolio', () => {
  const lm = new LogicManager();
  const port = lm.getState().portfolio;
  if (!port) throw new Error('portfolio отсутствует');
  if (port.positions.length !== 8) {
    throw new Error(`ожидали 8 позиций в state, ${port.positions.length}`);
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
  if (lm.getState().portfolio.positions.length !== 8) {
    throw new Error('после reset число позиций не 8');
  }
});

run('portfolioDerived: рыночная стоимость строки = qty × last', () => {
  const p = buildDemoPortfolio();
  const sber = p.positions.find((x) => x.id === 'pos-sber');
  if (!sber) throw new Error('нет pos-sber');
  const expected = 100 * 213.05;
  assertApprox(positionMarketValueRub(sber), expected, 1e-6, 'SBER mkt');
});

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
