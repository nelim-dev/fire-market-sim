/**
 * M2: smoke-тест селекторов статистики портфеля.
 */
import assert from 'node:assert/strict';
import { buildDemoPortfolio } from '../../src/data/portfolio/buildDemoPortfolio';
import { DEMO_INITIAL_DEPOSIT_RUB } from '../../src/data/portfolio/demoPortfolioConstants';
import {
  computeExcessReturnPct,
  resolveFireidxComparisonBaseline,
} from '../../src/logic/modules/market/fireidxComparison';
import type { MarketPriceBar } from '../../src/logic/modules/market/priceSeries';
import {
  buildPortfolioStatsViewModel,
  computePortfolioNavRubWithNkd,
} from '../../src/logic/modules/portfolio/statsSelectors';
import { exitCode, printResult } from './runner';

const M = 'M2-STATS';
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

function bar(t: number, c: number): MarketPriceBar {
  return { t, o: c, h: c, l: c, c, v: 0 };
}

run('nominal profit = NAV − deposit', () => {
  const portfolio = buildDemoPortfolio();
  const nav = computePortfolioNavRubWithNkd(portfolio, {});
  const vm = buildPortfolioStatsViewModel({
    portfolio,
    simulationEpochMs: Date.UTC(2020, 0, 10),
    nkdBySymbol: {},
    indexNow: null,
  });
  assert.equal(vm.nominalProfitRub, nav - DEMO_INITIAL_DEPOSIT_RUB);
});

run('FIREIDX excess integration', () => {
  const t0 = 1_700_000_000_000;
  const dayMs = 86_400_000;
  const t400 = t0 + 400 * dayMs;
  const t35 = t0 + 35 * dayMs;
  const daily = [bar(t0, 1000), bar(t35, 1000), bar(t400, 1050)];
  const baseline = resolveFireidxComparisonBaseline(daily, t400);
  assert.ok(baseline);
  assert.equal(baseline!.mode, 'rolling-1y');
  assert.equal(baseline!.indexBaseline, 1000);

  const navBaseline = DEMO_INITIAL_DEPOSIT_RUB;
  const navNow = navBaseline * 1.06;
  const excess = computeExcessReturnPct(
    navNow,
    navBaseline,
    baseline!.indexNow,
    baseline!.indexBaseline
  );
  assert.ok(Math.abs(excess - 1) < 0.05);

  const portfolio = buildDemoPortfolio();
  portfolio.cashRub = navNow;
  portfolio.positions = [];
  portfolio.vsFireidxSnapshot = {
    recordedAtEpochMs: t400,
    baselineEpochMs: baseline!.baselineEpochMs,
    navBaselineRub: navBaseline,
    indexBaselineLevel: baseline!.indexBaseline,
    mode: baseline!.mode,
  };
  const vm = buildPortfolioStatsViewModel({
    portfolio,
    simulationEpochMs: t400,
    nkdBySymbol: {},
    indexNow: baseline!.indexNow,
  });
  assert.ok(vm.vsFireidx);
  assert.ok(Math.abs(vm.vsFireidx!.excessReturnPct - excess) < 0.05);
});

run('composition slices include cash', () => {
  const portfolio = buildDemoPortfolio();
  const vm = buildPortfolioStatsViewModel({
    portfolio,
    simulationEpochMs: Date.UTC(2020, 0, 10),
    nkdBySymbol: {},
    indexNow: null,
  });
  const cash = vm.compositionSlices.find((s) => s.id === 'cash');
  assert.ok(cash);
  assert.ok(cash!.valueRub > 0);
});

process.exit(exitCode(failures));
