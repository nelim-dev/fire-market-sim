/** Имя события: сменился торговый день симуляции (после пропуска ночи или перерасхода сессии) */
export const TRADING_DAY_CHANGED = 'TRADING_DAY_CHANGED';

export type TradingDayChangedPayload = {
  mskDateYyyymmdd: string;
  dayIndex: number;
};

export interface LogicEventMap {
  [TRADING_DAY_CHANGED]: TradingDayChangedPayload;
}
