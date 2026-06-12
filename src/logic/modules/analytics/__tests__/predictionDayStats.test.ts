import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computePredictedCloseRange } from '../predictionDayStats';

describe('computePredictedCloseRange', () => {
  it('returns min/max close over bars', () => {
    const range = computePredictedCloseRange([
      { t: 1, o: 100, h: 101, l: 99, c: 100, v: 1 },
      { t: 2, o: 100, h: 105, l: 98, c: 103, v: 1 },
      { t: 3, o: 103, h: 104, l: 95, c: 96, v: 1 },
    ]);
    assert.deepEqual(range, { minClose: 96, maxClose: 103 });
  });

  it('ignores non-positive closes', () => {
    const range = computePredictedCloseRange([
      { t: 1, o: 0, h: 0, l: 0, c: 0, v: 0 },
      { t: 2, o: 50, h: 51, l: 49, c: 50, v: 1 },
    ]);
    assert.deepEqual(range, { minClose: 50, maxClose: 50 });
  });

  it('returns null for empty input', () => {
    assert.equal(computePredictedCloseRange([]), null);
  });
});
