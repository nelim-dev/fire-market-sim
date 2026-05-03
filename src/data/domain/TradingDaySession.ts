/**
 * Слой данных — доменная модель одного торгового дня (календарный день МСК).
 * Сериализуется в generated/tradingCalendar.json.
 */
export type TradingDayRecord = {
  mskDateYyyymmdd: string;
  sessionStartEpochMs: number;
  sessionEndEpochMs: number;
  tickersWithData: string[];
};

export class TradingDaySession {
  constructor(
    readonly mskDateYyyymmdd: string,
    readonly sessionStartEpochMs: number,
    readonly sessionEndEpochMs: number,
    readonly tickersWithData: readonly string[]
  ) {}

  static fromRecord(r: TradingDayRecord): TradingDaySession {
    return new TradingDaySession(
      r.mskDateYyyymmdd,
      r.sessionStartEpochMs,
      r.sessionEndEpochMs,
      r.tickersWithData
    );
  }

  contains(epochMs: number): boolean {
    return (
      epochMs >= this.sessionStartEpochMs &&
      epochMs <= this.sessionEndEpochMs
    );
  }
}
