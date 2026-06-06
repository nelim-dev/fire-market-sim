import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDate } from 'date-fns-tz';
import {
  parseKeyRateScheduleText,
  resolveKeyRatePct,
} from '../keyRateSchedule';
import { resolveMacroSnapshot } from '../macroResolve';
import { MACRO_BRENT_SYMBOL, MACRO_USD_RUB_SYMBOL } from '../macroSymbols';
import { emptyChartSeriesBundle } from '../chartWindows';

function mskEpoch(y: number, m: number, d: number): number {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return toDate(`${y}-${mm}-${dd}T12:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

describe('keyRateSchedule', () => {
  const sample = parseKeyRateScheduleText(
    '16.09.2013\t5,50\n03.03.2014\t7,00\n'
  );

  it('parseKeyRateScheduleText reads DD.MM.YYYY and comma decimals', () => {
    assert.equal(sample.events.length, 2);
    assert.equal(sample.events[0].ratePct, 5.5);
    assert.equal(sample.events[1].ratePct, 7);
  });

  it('resolveKeyRatePct returns null before first effective date', () => {
    const before = mskEpoch(2013, 9, 15);
    assert.equal(resolveKeyRatePct(before, sample), null);
  });

  it('resolveKeyRatePct step-function uses last event on or before epoch', () => {
    const onFirst = mskEpoch(2013, 9, 16);
    assert.equal(resolveKeyRatePct(onFirst, sample), 5.5);
    const between = mskEpoch(2014, 1, 1);
    assert.equal(resolveKeyRatePct(between, sample), 5.5);
    const onSecond = mskEpoch(2014, 3, 3);
    assert.equal(resolveKeyRatePct(onSecond, sample), 7);
  });
});

describe('resolveMacroSnapshot', () => {
  it('reads BR and USD close from minute bars', () => {
    const t0 = mskEpoch(2020, 1, 1);
    const t1 = mskEpoch(2020, 1, 2);
    const bundle = emptyChartSeriesBundle();
    bundle.minute[MACRO_BRENT_SYMBOL] = [
      { t: t0, o: 60, h: 61, l: 59, c: 60.5, v: 1 },
      { t: t1, o: 62, h: 63, l: 61, c: 62.25, v: 1 },
    ];
    bundle.minute[MACRO_USD_RUB_SYMBOL] = [
      { t: t0, o: 70, h: 71, l: 69, c: 70.5, v: 1 },
      { t: t1, o: 72, h: 73, l: 71, c: 72.1, v: 1 },
    ];
    const schedule = parseKeyRateScheduleText('16.09.2013\t5,50\n');
    const snap = resolveMacroSnapshot(t1, bundle, schedule);
    assert.equal(snap.brentUsd, 62.25);
    assert.equal(snap.usdRub, 72.1);
    assert.equal(snap.keyRatePct, 5.5);
    assert.ok(
      snap.inflation12mPct === null || Number.isFinite(snap.inflation12mPct)
    );
  });

  it('includes inflation12mPct from schedule', () => {
    const t = mskEpoch(2025, 12, 15);
    const snap = resolveMacroSnapshot(t, emptyChartSeriesBundle());
    assert.ok(snap.inflation12mPct !== null);
    assert.ok(snap.inflation12mPct! > 0);
  });
});
