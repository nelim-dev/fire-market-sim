import type { TradingDaySession } from '@/data/domain/TradingDaySession';
import { TradingCalendar } from './TradingCalendar';

/** Снимок сессии для UI / селекторов (plain object) */
export type TradingSessionSnapshot = {
  mskDateYyyymmdd: string;
  sessionStartEpochMs: number;
  sessionEndEpochMs: number;
  tickersWithData: readonly string[];
};

export function toSessionSnapshot(
  d: TradingDaySession | undefined
): TradingSessionSnapshot | null {
  if (!d) return null;
  return {
    mskDateYyyymmdd: d.mskDateYyyymmdd,
    sessionStartEpochMs: d.sessionStartEpochMs,
    sessionEndEpochMs: d.sessionEndEpochMs,
    tickersWithData: d.tickersWithData,
  };
}

/**
 * Слой логики — продвижение игрового времени по торговым сессиям с пропуском ночи.
 * «Следующий день» из календаря доступен синхронно (O(1)); тяжёлая предзагрузка котировок
 * подключится позже в DataService без изменения контракта.
 */
export class SessionTimelineController {
  private dayIndex = 0;

  constructor(private readonly calendar: TradingCalendar) {}

  reset(): void {
    this.dayIndex = 0;
  }

  isReady(): boolean {
    return this.calendar.dayCount > 0;
  }

  getDayIndex(): number {
    return this.dayIndex;
  }

  getGlobalStartEpochMs(): number {
    const d = this.calendar.getDay(0);
    return d ? d.sessionStartEpochMs : 0;
  }

  getGlobalEndEpochMs(): number {
    const d = this.calendar.getLastDay();
    return d ? d.sessionEndEpochMs : 0;
  }

  getCurrentDay(): TradingDaySession | undefined {
    return this.calendar.getDay(this.dayIndex);
  }

  getNextDay(): TradingDaySession | undefined {
    return this.calendar.getDay(this.dayIndex + 1);
  }

  /**
   * Перенос перерасхода за конец сессии на следующий торговый день (без «ночи» на таймлайне).
   */
  advance(epochMs: number, deltaSimMs: number): { epochMs: number; dayChanged: boolean } {
    let e = epochMs + deltaSimMs;
    let dayChanged = false;
    const n = this.calendar.dayCount;

    for (;;) {
      const day = this.calendar.getDay(this.dayIndex);
      if (!day) {
        return { epochMs, dayChanged };
      }
      if (e < day.sessionStartEpochMs) {
        e = day.sessionStartEpochMs;
        break;
      }
      if (e <= day.sessionEndEpochMs) {
        break;
      }
      const spill = e - day.sessionEndEpochMs;
      if (this.dayIndex >= n - 1) {
        e = day.sessionEndEpochMs;
        break;
      }
      this.dayIndex++;
      dayChanged = true;
      const next = this.calendar.getDay(this.dayIndex);
      if (!next) {
        e = day.sessionEndEpochMs;
        break;
      }
      e = next.sessionStartEpochMs + spill;
    }

    const last = this.calendar.getLastDay();
    if (last && e > last.sessionEndEpochMs) {
      e = last.sessionEndEpochMs;
    }
    return { epochMs: e, dayChanged };
  }

  /**
   * Зарезервировано под фоновую подготовку котировок следующего дня (кэш, индексы в файлах).
   * Сейчас — no-op: сам календарь уже в памяти, UI не блокируется.
   */
  schedulePrefetchNextSession(): void {
    queueMicrotask(() => {
      void this.calendar.getDay(this.dayIndex + 1);
    });
  }
}
