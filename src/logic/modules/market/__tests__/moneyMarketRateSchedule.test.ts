import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDate } from 'date-fns-tz';
import {
  buildAccrualRateEvents,
  listCalendarDaysBetweenExclusive,
  netAnnualPctFromBase,
  nextTradingMskDateStrictlyAfter,
  REFINANCING_RATE_EVENTS,
  resolveBasePolicyRatePct,
  resolveNetAnnualPctForAccrualDay,
} from '../moneyMarketRateSchedule';
import {
  parseKeyRateScheduleText,
  resetKeyRateScheduleCacheForTests,
} from '../keyRateSchedule';

function mskEpoch(y: number, m: number, d: number): number {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return toDate(`${y}-${mm}-${dd}T12:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
}

const TRADING_SAMPLE = [
  '20090109',
  '20090112',
  '20090113',
  '20090424',
  '20090427',
  '20130913',
  '20130916',
  '20130917',
];

describe('moneyMarketRateSchedule', () => {
  it('REFINANCING_RATE_EVENTS содержит 19 периодов', () => {
    assert.equal(REFINANCING_RATE_EVENTS.length, 19);
  });

  it('netAnnualPctFromBase вычитает 0.6%', () => {
    assert.equal(netAnnualPctFromBase(13), 12.4);
    assert.equal(netAnnualPctFromBase(5.5), 4.9);
  });

  it('resolveBasePolicyRatePct: 11.01.2009 → 13% рефинансирование', () => {
    const rate = resolveBasePolicyRatePct(
      mskEpoch(2009, 1, 11),
      parseKeyRateScheduleText('')
    );
    assert.equal(rate, 13);
  });

  it('resolveBasePolicyRatePct: с 16.09.2013 → KS 5.5%', () => {
    const schedule = parseKeyRateScheduleText('16.09.2013\t5,50\n');
    assert.equal(resolveBasePolicyRatePct(mskEpoch(2013, 9, 16), schedule), 5.5);
  });

  it('nextTradingMskDateStrictlyAfter пропускает выходные', () => {
    assert.equal(
      nextTradingMskDateStrictlyAfter('20090109', TRADING_SAMPLE),
      '20090112'
    );
    assert.equal(
      nextTradingMskDateStrictlyAfter('20090424', TRADING_SAMPLE),
      '20090427'
    );
  });

  it('listCalendarDaysBetweenExclusive: четверг→понедельник = 3 дня', () => {
    const days = listCalendarDaysBetweenExclusive('20090108', '20090112');
    assert.deepEqual(days, ['20090109', '20090110', '20090111', '20090112']);
  });

  it('accrual: net 12.4% на 20090111 (первый торговый день фонда)', () => {
    resetKeyRateScheduleCacheForTests();
    const events = buildAccrualRateEvents(
      ['20090111', '20090112'],
      parseKeyRateScheduleText('')
    );
    assert.equal(resolveNetAnnualPctForAccrualDay('20090111', events), 12.4);
  });

  it('accrual: смена ставки с следующей торговой сессии после policy date', () => {
    const events = buildAccrualRateEvents(TRADING_SAMPLE, parseKeyRateScheduleText(''));
    const start20090427 = events.find((e) => e.accrualStartMskDate === '20090427');
    assert.ok(start20090427);
    assert.equal(start20090427.baseRatePct, 12.5);
    assert.equal(resolveNetAnnualPctForAccrualDay('20090424', events), 12.4);
    assert.equal(resolveNetAnnualPctForAccrualDay('20090427', events), 11.9);
  });

  it('accrual: KS с следующей торговой сессии после 16.09.2013', () => {
    const schedule = parseKeyRateScheduleText('16.09.2013\t5,50\n');
    const events = buildAccrualRateEvents(
      ['20130916', '20130917'],
      schedule
    );
    assert.equal(resolveNetAnnualPctForAccrualDay('20130916', events), 7.65);
    assert.equal(resolveNetAnnualPctForAccrualDay('20130917', events), 4.9);
  });
});
