import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInflationIndexBars,
  buildInflationIndexChartLines,
  buildInflationIndexFinamText,
  buildInflationIndexMonthlyPriceBars,
  chartTimeframesForSymbol,
  chartUsesEvenIndexSpacing,
  INFLATION_INDEX_HISTORY_START_YYYYMM,
  INFLATION_INDEX_SYMBOL,
  isInflationIndexSymbol,
  momIndexToInflationPct,
  monthEndEpochMs,
  resolveInflationIndexPriceAtEpoch,
} from '../inflationIndexSeries';

describe('inflationIndexSeries', () => {
  it('isInflationIndexSymbol', () => {
    assert.equal(isInflationIndexSymbol('INFL'), true);
    assert.equal(isInflationIndexSymbol('BR'), false);
  });

  it('chartTimeframesForSymbol: INFL только 6m / 1y / all', () => {
    assert.deepEqual(chartTimeframesForSymbol('INFL'), ['6m', '1y', 'all']);
    assert.ok(chartTimeframesForSymbol('SBER').includes('1d'));
  });

  it('chartUsesEvenIndexSpacing: INFL 6m/1y — равномерный шаг', () => {
    assert.equal(chartUsesEvenIndexSpacing('INFL', '6m'), true);
    assert.equal(chartUsesEvenIndexSpacing('INFL', '1y'), true);
    assert.equal(chartUsesEvenIndexSpacing('INFL', 'all'), false);
    assert.equal(chartUsesEvenIndexSpacing('SBER', '6m'), false);
  });

  it('momIndexToInflationPct', () => {
    assert.ok(Math.abs(momIndexToInflationPct(100.5) - 0.5) < 1e-9);
    assert.ok(Math.abs(momIndexToInflationPct(101) - 1) < 1e-9);
  });

  it('buildInflationIndexBars не пустой на реальном schedule', () => {
    const bars = buildInflationIndexBars();
    assert.ok(bars.length > 100);
    assert.ok(Number.isFinite(bars[0]!.momInflationPct));
  });

  it('buildInflationIndexFinamText содержит заголовок и INFL', () => {
    const text = buildInflationIndexFinamText();
    assert.ok(text.startsWith('<TICKER>'));
    assert.ok(text.includes(`${INFLATION_INDEX_SYMBOL},1,`));
  });

  it('график с 201301: полная история даже при старте симуляции до 2013', () => {
    const earlySim = monthEndEpochMs('201001');
    const monthly = buildInflationIndexMonthlyPriceBars(earlySim);
    assert.ok(monthly.length > 100);
    assert.ok(monthly[0]!.t >= monthEndEpochMs(INFLATION_INDEX_HISTORY_START_YYYYMM) - 86_400_000);

    const lines = buildInflationIndexChartLines(earlySim);
    assert.equal(lines['6m'].length, 6);
    assert.equal(lines['1y'].length, 12);
    assert.ok(lines.all.length > 100);
    assert.equal(lines['1d'].length, 0);
  });

  it('resolveInflationIndexPriceAtEpoch на эпохе 2020-06', () => {
    const epoch = monthEndEpochMs('202006');
    const price = resolveInflationIndexPriceAtEpoch(epoch);
    assert.ok(price !== null && Number.isFinite(price));
  });
});
