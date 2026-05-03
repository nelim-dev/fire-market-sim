import type { TradingDayRecord } from '@/data/domain/TradingDaySession';
import { TradingDaySession } from '@/data/domain/TradingDaySession';

/**
 * Слой логики — read-only календарь торговых дней (данные приходят из слоя данных / JSON).
 */
export class TradingCalendar {
  private readonly days: readonly TradingDaySession[];

  private constructor(days: readonly TradingDaySession[]) {
    this.days = days;
  }

  static fromRecords(records: readonly TradingDayRecord[]): TradingCalendar {
    return new TradingCalendar(records.map((r) => TradingDaySession.fromRecord(r)));
  }

  get dayCount(): number {
    return this.days.length;
  }

  getDay(index: number): TradingDaySession | undefined {
    return this.days[index];
  }

  getLastDay(): TradingDaySession | undefined {
    const n = this.days.length;
    return n === 0 ? undefined : this.days[n - 1];
  }

  get readonlyDays(): readonly TradingDaySession[] {
    return this.days;
  }
}
