import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDate } from 'date-fns-tz';
import {
  loadInflationSchedule,
  resetInflationScheduleCacheForTests,
  resolveCumulativeCpiMultiplier,
  resolveMomIndex,
  resolveRolling12mInflationPct,
} from '../inflationSchedule';

describe('inflationSchedule', () => {
  it('parseInflationScheduleText: апрель 2026 = 100.14', () => {
    resetInflationScheduleCacheForTests();
    const schedule = loadInflationSchedule();
    assert.equal(schedule.momByYyyymm['202604'], 100.14);
    assert.equal(schedule.lastAvailableYyyymm, '202604');
  });

  it('rolling 12m на 12×101 → ~12.68%, не 1212%', () => {
    const schedule = {
      momByYyyymm: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => {
          const m = String(i + 1).padStart(2, '0');
          return [`2025${m}`, 101];
        })
      ),
      lastAvailableYyyymm: '202512',
    };
    const epoch = toDate('2025-12-15T12:00:00', {
      timeZone: 'Europe/Moscow',
    }).getTime();
    const pct = resolveRolling12mInflationPct(epoch, schedule);
    assert.ok(pct !== null);
    assert.ok(Math.abs(pct! - 12.6825) < 0.01);
  });

  it('forward-fill после 202604', () => {
    resetInflationScheduleCacheForTests();
    const schedule = loadInflationSchedule();
    assert.equal(resolveMomIndex('202605', schedule), 100.14);
    assert.equal(resolveMomIndex('202701', schedule), 100.14);
  });

  it('май 2026 не в JSON (конец ряда — апрель)', () => {
    resetInflationScheduleCacheForTests();
    const schedule = loadInflationSchedule();
    assert.equal(schedule.lastAvailableYyyymm, '202604');
    assert.equal(schedule.momByYyyymm['202605'], undefined);
  });

  it('resolveCumulativeCpiMultiplier: два месяца 102 и 101 → 1.0302', () => {
    const schedule = {
      momByYyyymm: { '202501': 102, '202502': 101 },
      lastAvailableYyyymm: '202502',
    };
    const mult = resolveCumulativeCpiMultiplier('202501', '202502', schedule);
    assert.ok(Math.abs(mult - 1.0302) < 1e-9);
  });
});
