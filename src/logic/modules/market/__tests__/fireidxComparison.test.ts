import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeExcessReturnPct,
  computeReturnPct,
  FIREIDX_COMPARISON_HORIZON_MS,
  resolveFireidxComparisonBaseline,
} from '../fireidxComparison';
import type { MarketPriceBar } from '../priceSeries';

function bar(t: number, c: number): MarketPriceBar {
  return { t, o: c, h: c, l: c, c, v: 0 };
}

describe('fireidxComparison', () => {
  it('computeReturnPct: 1050/1000 → 5%', () => {
    assert.ok(Math.abs(computeReturnPct(1050, 1000) - 5) < 1e-9);
  });

  it('computeExcessReturnPct: portfolio +6%, index +5% → +1%', () => {
    assert.ok(
      Math.abs(computeExcessReturnPct(106, 100, 105, 100) - 1) < 1e-9
    );
  });

  it('< 365d history → earliest bar baseline', () => {
    const t0 = 1_000_000;
    const t30 = t0 + 30 * 86_400_000;
    const bars = [bar(t0, 1000), bar(t30, 1030)];
    const resolved = resolveFireidxComparisonBaseline(bars, t30);
    assert.ok(resolved);
    assert.equal(resolved!.mode, 'earliest-available');
    assert.equal(resolved!.baselineEpochMs, t0);
    assert.equal(resolved!.indexBaseline, 1000);
    assert.equal(resolved!.indexNow, 1030);
  });

  it('≥ 365d history → rolling 1y baseline', () => {
    const t0 = 0;
    const t400 = 400 * 86_400_000;
    const target = t400 - FIREIDX_COMPARISON_HORIZON_MS;
    const bars = [bar(t0, 1000), bar(target, 1020), bar(t400, 1060)];
    const resolved = resolveFireidxComparisonBaseline(bars, t400);
    assert.ok(resolved);
    assert.equal(resolved!.mode, 'rolling-1y');
    assert.equal(resolved!.baselineEpochMs, target);
    assert.equal(resolved!.indexBaseline, 1020);
    assert.equal(resolved!.indexNow, 1060);
  });

  it('empty bars → null', () => {
    assert.equal(resolveFireidxComparisonBaseline([], 1000), null);
  });
});
