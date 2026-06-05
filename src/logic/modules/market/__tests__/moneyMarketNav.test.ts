import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAccrualRateEvents,
  listCalendarDaysBetweenExclusive,
  resolveNetAnnualPctForAccrualDay,
} from '../moneyMarketRateSchedule';
import {
  computeNavSeries,
  dailyAccrualFactor,
  DN_R_INITIAL_NAV_RUB,
  roundNavRub,
} from '../moneyMarketNav';
import { parseKeyRateScheduleText } from '../keyRateSchedule';

describe('moneyMarketNav', () => {
  it('первый торговый день NAV = 10', () => {
    const events = buildAccrualRateEvents(['20090111'], parseKeyRateScheduleText(''));
    const nav = computeNavSeries([{ mskDateYyyymmdd: '20090111' }], events);
    assert.equal(nav.get('20090111'), 10);
  });

  it('между двумя торговыми днями — один календарный множитель', () => {
    const events = buildAccrualRateEvents(
      ['20090111', '20090112'],
      parseKeyRateScheduleText('')
    );
    const nav = computeNavSeries(
      [{ mskDateYyyymmdd: '20090111' }, { mskDateYyyymmdd: '20090112' }],
      events
    );
    const net = 12.4;
    const expected = roundNavRub(10 * dailyAccrualFactor(net));
    assert.equal(nav.get('20090112'), expected);
  });

  it('Thu→Mon: три календарных множителя', () => {
    const calendarDays = listCalendarDaysBetweenExclusive('20090108', '20090112');
    assert.equal(calendarDays.length, 4);
    const events = buildAccrualRateEvents(
      ['20090108', '20090112'],
      parseKeyRateScheduleText('')
    );
    const nav = computeNavSeries(
      [{ mskDateYyyymmdd: '20090108' }, { mskDateYyyymmdd: '20090112' }],
      events,
      DN_R_INITIAL_NAV_RUB
    );
    let expected = 10;
    for (const d of calendarDays) {
      const net = resolveNetAnnualPctForAccrualDay(d, events)!;
      expected *= dailyAccrualFactor(net);
    }
    assert.equal(nav.get('20090112'), roundNavRub(expected));
  });

  it('NAV монотонно растёт при положительной ставке', () => {
    const trading = ['20090111', '20090112', '20090113', '20090114'];
    const events = buildAccrualRateEvents(trading, parseKeyRateScheduleText(''));
    const nav = computeNavSeries(
      trading.map((mskDateYyyymmdd) => ({ mskDateYyyymmdd })),
      events
    );
    let prev = 0;
    for (const d of trading) {
      const v = nav.get(d)!;
      assert.ok(v > prev);
      prev = v;
    }
  });
});
