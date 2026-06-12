import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_FEAT_DIM,
  ANALYTICS_VOL_SCALE,
  analyticsFeatureIndex,
} from '../modelConstants';
import { tensorToCloseChartPointsForSymbol } from '../predictionToBars';
import {
  bucketEndMsRightClosed,
  buildModelDayTensorFromDayBundle,
  buildSessionGridEndMs,
  sanitizeModelDayTensorFinite,
  sessionGridEndMs,
  sessionGridStartMs,
} from '../modelDayTensor';

describe('modelDayTensor', () => {
  const day = '20240603';

  it('builds 107 grid slots', () => {
    const grid = buildSessionGridEndMs(day);
    assert.equal(grid.length, ANALYTICS_BARS_PER_SESSION);
    assert.equal(grid[0], sessionGridStartMs(day));
    assert.equal(grid[grid.length - 1], sessionGridEndMs(day));
  });

  it('right-closed bucket maps 10:01 to 10:05', () => {
    const start = sessionGridStartMs(day);
    const t1001 = start + 60_000;
    const bucket = bucketEndMsRightClosed(t1001, day);
    assert.equal(bucket, start + 5 * 60_000);
  });

  it('sparse minutes still yield (107, 105) with ffill', () => {
    const start = sessionGridStartMs(day);
    const tensor = buildModelDayTensorFromDayBundle(
      {
        GAZP: [
          {
            t: start + 60_000,
            o: 150,
            h: 151,
            l: 149,
            c: 150.5,
            v: 10_000,
          },
        ],
      },
      day
    );
    assert.equal(tensor.length, ANALYTICS_BARS_PER_SESSION);
    assert.equal(tensor[0].length, ANALYTICS_FEAT_DIM);
    const gazpCloseCol = 3;
    assert.ok(tensor.every((row) => row[gazpCloseCol] >= 0));
    assert.ok(tensor.some((row) => row[gazpCloseCol] > 0));
  });

  it('close chart series reads CLOSE column only (not scaled VOL)', () => {
    const start = sessionGridStartMs(day);
    const tensor = buildModelDayTensorFromDayBundle(
      {
        GAZP: [
          {
            t: start + 60_000,
            o: 150,
            h: 151,
            l: 149,
            c: 150.5,
            v: 10_000,
          },
        ],
      },
      day
    );
    const points = tensorToCloseChartPointsForSymbol(tensor, 'GAZP', day);
    const closeIdx = analyticsFeatureIndex(0, 'CLOSE');
    const volIdx = analyticsFeatureIndex(0, 'VOL');
    assert.ok(points.length > 0);
    for (const [i, pt] of points.entries()) {
      assert.equal(pt.close, tensor[i][closeIdx]);
      assert.notEqual(pt.close, tensor[i][volIdx] * ANALYTICS_VOL_SCALE);
    }
  });

  it('empty day with last_known fills flat 107 bars at prev close', () => {
    const day = '20240603';
    const lastKnown = Array.from({ length: ANALYTICS_BARS_PER_SESSION }, (_, i) =>
      i === 0
        ? ([100, 102, 99, 101, 5000] as const)
        : ([101, 103, 100, 102, 3000] as const)
    );
    const tensor = buildModelDayTensorFromDayBundle(
      { GAZP: [] },
      day,
      { GAZP: lastKnown.map((r) => [...r]) }
    );
    const closeIdx = analyticsFeatureIndex(0, 'CLOSE');
    const volIdx = analyticsFeatureIndex(0, 'VOL');
    assert.equal(tensor.length, ANALYTICS_BARS_PER_SESSION);
    for (const row of tensor) {
      assert.equal(row[closeIdx], 102);
      assert.equal(row[volIdx], 0);
    }
  });

  it('unlisted ticker yields all-zero finite OHLCV (no NaN)', () => {
    const day = '20191230';
    const tensor = buildModelDayTensorFromDayBundle(
      {},
      day,
      {},
      { YDEX: '20240724' }
    );
    const ydexIdx = 13;
    const closeIdx = analyticsFeatureIndex(ydexIdx, 'CLOSE');
    const volIdx = analyticsFeatureIndex(ydexIdx, 'VOL');
    for (const row of tensor) {
      assert.equal(row[closeIdx], 0);
      assert.equal(row[volIdx], 0);
      assert.ok(Number.isFinite(row[closeIdx]));
    }
  });

  it('sanitizeModelDayTensorFinite replaces non-finite with 0', () => {
    const tensor = buildModelDayTensorFromDayBundle({}, '20240603');
    tensor[0][0] = Number.NaN;
    tensor[1][1] = Number.POSITIVE_INFINITY;
    sanitizeModelDayTensorFinite(tensor);
    assert.equal(tensor[0][0], 0);
    assert.equal(tensor[1][1], 0);
  });

  it('pandas ffill copies VOL into gap slots', () => {
    const day = '20240603';
    const start = sessionGridStartMs(day);
    const t2 = start + 15 * 60_000;
    const tensor = buildModelDayTensorFromDayBundle(
      {
        GAZP: [
          { t: start + 60_000, o: 100, h: 101, l: 99, c: 100, v: 10_000 },
          { t: t2 + 60_000, o: 105, h: 106, l: 104, c: 105, v: 20_000 },
        ],
      },
      day
    );
    const volIdx = analyticsFeatureIndex(0, 'VOL');
    const slot1Vol = tensor[1][volIdx];
    const slot2Vol = tensor[2][volIdx];
    assert.ok(slot1Vol > 0, 'ffill should propagate VOL to gap slot');
    assert.equal(slot1Vol, slot2Vol);
  });
});
