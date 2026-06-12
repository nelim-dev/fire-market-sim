import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MarketPriceBar } from '@/logic/modules/market/priceSeries';
import {
  minutesUseIntegerOhlcOnly,
  normalizeAnalyticsMinuteBars,
  normalizeAnalyticsSeedClose,
  resolveAnalyticsOhlcScale,
} from '../ohlcFormatNormalize';

function bar(c: number): MarketPriceBar {
  return { t: 0, o: c, h: c, l: c, c, v: 100 };
}

describe('ohlcFormatNormalize', () => {
  it('EU integer OHLC is never scaled (npz uses 70455 as-is)', () => {
    const minutes = [bar(70455)];
    assert.equal(resolveAnalyticsOhlcScale('EU', minutes), 1);
    assert.equal(normalizeAnalyticsSeedClose('EU', 70455), 70455);
  });

  it('VTBR early integer kopecks (median ~3346) scale ÷100', () => {
    const minutes = [bar(3346), bar(3350), bar(3340)];
    assert.ok(minutesUseIntegerOhlcOnly(minutes));
    assert.equal(resolveAnalyticsOhlcScale('VTBR', minutes), 100);
    const out = normalizeAnalyticsMinuteBars('VTBR', minutes);
    assert.equal(out[0].c, 33.46);
  });

  it('VTBR decimal OHLC (258.85) is not scaled', () => {
    const minutes = [bar(258.85), bar(259.45)];
    assert.equal(resolveAnalyticsOhlcScale('VTBR', minutes), 1);
  });

  it('VTBR integer ~4673 (kopeck int) scales ÷100', () => {
    const minutes = [bar(4673), bar(4688), bar(4664)];
    assert.equal(resolveAnalyticsOhlcScale('VTBR', minutes), 100);
    assert.equal(normalizeAnalyticsMinuteBars('VTBR', minutes)[0].c, 46.73);
  });
});
