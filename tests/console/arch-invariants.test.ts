import { toDate } from 'date-fns-tz';
import type { TradingDayRecord } from '../../src/data/domain/TradingDaySession';
import type { LogicEventMap } from '../../src/logic/logicEvents';
import { TRADING_DAY_CHANGED } from '../../src/logic/logicEvents';
import { PortfolioModuleService } from '../../src/logic/modules/portfolio/service';
import { TimeModuleService } from '../../src/logic/modules/time/service';
import type { ModuleContext } from '../../src/logic/modules/contracts';
import { TradingCalendar } from '../../src/logic/time/TradingCalendar';
import { SessionTimelineController } from '../../src/logic/time/SessionTimelineController';
import { EventBus } from '../../src/logic/systems/EventBus';
import { exitCode, printResult } from './runner';

const M = 'ARCH';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

const d0s = toDate('2020-01-02T10:05:00', { timeZone: 'Europe/Moscow' }).getTime();
const d0e = toDate('2020-01-02T18:49:00', { timeZone: 'Europe/Moscow' }).getTime();
const d1s = toDate('2020-01-03T10:01:00', { timeZone: 'Europe/Moscow' }).getTime();
const d1e = toDate('2020-01-03T18:50:00', { timeZone: 'Europe/Moscow' }).getTime();

const twoDays: TradingDayRecord[] = [
  {
    mskDateYyyymmdd: '20200102',
    sessionStartEpochMs: d0s,
    sessionEndEpochMs: d0e,
    tickersWithData: ['T'],
  },
  {
    mskDateYyyymmdd: '20200103',
    sessionStartEpochMs: d1s,
    sessionEndEpochMs: d1e,
    tickersWithData: ['T'],
  },
];

run('TimeModuleService: одинаковый delta даёт детерминированный результат', () => {
  const calendar = TradingCalendar.fromRecords(twoDays);
  const timelineA = new SessionTimelineController(calendar);
  const timelineB = new SessionTimelineController(calendar);
  const serviceA = new TimeModuleService(timelineA);
  const serviceB = new TimeModuleService(timelineB);
  const stateA = serviceA.createInitialState();
  const stateB = serviceB.createInitialState();
  const eventBusA = new EventBus<LogicEventMap>();
  const eventBusB = new EventBus<LogicEventMap>();
  const contextA: ModuleContext = {
    emit: (event, payload) => eventBusA.emit(event, payload),
  };
  const contextB: ModuleContext = {
    emit: (event, payload) => eventBusB.emit(event, payload),
  };

  serviceA.update(stateA, 0.05, contextA);
  serviceB.update(stateB, 0.05, contextB);

  if (stateA.simulationEpochMs !== stateB.simulationEpochMs) {
    throw new Error(`ожидали одинаковый epochMs, получили ${stateA.simulationEpochMs} и ${stateB.simulationEpochMs}`);
  }
});

run('PortfolioModuleService: инициализация сохраняет текущий объём демо-позиций', () => {
  const service = new PortfolioModuleService();
  const portfolio = service.createInitialState();
  if (portfolio.positions.length !== 8) {
    throw new Error(`ожидали 8 позиций, получили ${portfolio.positions.length}`);
  }
});

run('EventBus<LogicEventMap>: принимает типизированный payload событий', () => {
  const bus = new EventBus<LogicEventMap>();
  let observedDayIndex = -1;
  bus.on(TRADING_DAY_CHANGED, (payload) => {
    observedDayIndex = payload.dayIndex;
  });
  bus.emit(TRADING_DAY_CHANGED, {
    mskDateYyyymmdd: '20200102',
    dayIndex: 7,
  });
  bus.processQueue();
  if (observedDayIndex !== 7) {
    throw new Error(`ожидали dayIndex=7, получили ${observedDayIndex}`);
  }
});

exitCode(failures);

