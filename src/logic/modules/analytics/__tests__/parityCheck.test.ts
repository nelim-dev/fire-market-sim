import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyticsFeatureIndex } from '../modelConstants';
import {
  buildAnalyticsParityReport,
  buildParityStatsForSymbol,
} from '../parityCheck';
import type { ModelDayTensor } from '../modelDayTensor';
import { ANALYTICS_BARS_PER_SESSION, ANALYTICS_FEAT_DIM } from '../modelConstants';

function blankTensor(): ModelDayTensor {
  return Array.from({ length: ANALYTICS_BARS_PER_SESSION }, () =>
    Array.from({ length: ANALYTICS_FEAT_DIM }, () => 0)
  );
}

function setClose(tensor: ModelDayTensor, symbolIdx: number, slot: number, close: number): void {
  tensor[slot][analyticsFeatureIndex(symbolIdx, 'CLOSE')] = close;
}

describe('parityCheck', () => {
  it('computes MAE between pred and real close', () => {
    const prev = blankTensor();
    const pred = blankTensor();
    const real = blankTensor();
    const gazpIdx = 0;
    for (let t = 0; t < ANALYTICS_BARS_PER_SESSION; t++) {
      setClose(prev, gazpIdx, t, 100);
      setClose(pred, gazpIdx, t, 110);
      setClose(real, gazpIdx, t, 100);
    }
    const stats = buildParityStatsForSymbol('GAZP', prev, pred, real);
    assert.equal(stats.maeClose, 10);
    assert.equal(stats.rmseClose, 10);
  });

  it('all-zero unlisted ticker reports 0 not NaN in prev/real close', () => {
    const prev = blankTensor();
    const pred = blankTensor();
    const real = blankTensor();
    const ydexIdx = 13;
    for (let t = 0; t < 5; t++) {
      setClose(pred, ydexIdx, t, 100 + t);
    }
    const stats = buildParityStatsForSymbol('YDEX', prev, pred, real);
    assert.equal(stats.prevClose.min, 0);
    assert.equal(stats.prevClose.max, 0);
    assert.equal(stats.prevClose.mean, 0);
    assert.equal(stats.realClose.min, 0);
    assert.ok(Number.isFinite(stats.prevClose.mean));
  });

  it('builds report for multiple symbols', () => {
    const prev = blankTensor();
    const pred = blankTensor();
    const real = blankTensor();
    setClose(prev, 0, 0, 150);
    setClose(pred, 0, 0, 151);
    setClose(real, 0, 0, 152);
    const report = buildAnalyticsParityReport('20191230', '20200103', prev, pred, real, [
      'GAZP',
    ]);
    assert.equal(report.stats.length, 1);
    assert.equal(report.sourceDayMsk, '20191230');
  });
});
