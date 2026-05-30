import { EventBus } from '../systems/EventBus';
import type { TradingDayRecord } from '@/data/domain/TradingDaySession';
import tradingCalendarJson from '@/data/generated/tradingCalendar.json';
import {
  type SimulationStepPreset,
  type TimeScalePreset,
} from '@/logic/simulation/simulationConfig';
import {
  TRADING_DAY_CHANGED,
  TRADE_REJECTED,
  type LogicEventMap,
  type TradingDayChangedPayload,
} from '../logicEvents';
import { SessionTimelineController } from '../time/SessionTimelineController';
import { TradingCalendar } from '../time/TradingCalendar';
import type { PortfolioState } from '@/logic/domain/portfolio';
import type { TimeModuleState } from '@/logic/modules/time/state';
import { TimeModuleService } from '@/logic/modules/time/service';
import { PortfolioModuleService } from '@/logic/modules/portfolio/service';
import { type MarketModuleState } from '@/logic/modules/market/state';
import { MarketModuleService } from '@/logic/modules/market/service';
import type { TradingModuleState } from '@/logic/modules/trading/state';
import { TradingModuleService } from '@/logic/modules/trading/service';
import type { EducationModuleState } from '@/logic/modules/education/state';
import { EducationModuleService } from '@/logic/modules/education/service';
import type { UiStateModuleState } from '@/logic/modules/uiState/state';
import { UiStateModuleService } from '@/logic/modules/uiState/service';
import type {
  LogicCommand,
  LogicModule,
  ModuleAttachContext,
  ModuleContext,
} from '@/logic/modules/contracts';

/**
 * Селектор — функция которая выбирает часть состояния
 * Например: state => state.gameTime
 */
type Selector<T> = (state: GameState) => T;

/**
 * Подписчик на изменения (получает только выбранное значение)
 * Например: (gameTime) => setState(gameTime)
 */
type StateSubscriber<T> = (value: T) => void;
type EqualityFn<T> = (a: T, b: T) => boolean;

/**
 * Интерфейс состояния приложения
 * Пока минимальный, будем расширять по мере разработки
 */
export interface GameState extends TimeModuleState {
  // Текущий пользователь (null если не залогинен)
  currentUser: string | null;

  /** Портфель (M2+): демо-сид, позже сделки и рыночные цены */
  portfolio: PortfolioState;

  /** Рынок (M3+): каталог инструментов, котировки, стакан — модуль MarketSimulator. */
  market: MarketModuleState;
  trading: TradingModuleState;

  /** Обучение (M8+): разблокировка инструментов после тестов. */
  education: EducationModuleState;

  /** UI-навигация: режим левой панели, выбранный инструмент, фильтры обзора рынка. */
  uiState: UiStateModuleState;
}

/**
 * LogicManager — главный оркестратор логики приложения
 * 
 * Обязанности:
 * - Создаёт и управляет EventBus
 * - Хранит полное состояние приложения в памяти
 * - Координирует обновление всех модулей
 * - Обрабатывает очередь событий
 * - Уведомляет UI об изменениях (через селекторы)
 */
export class LogicManager {
  /**
   * Система событий для связи между модулями
   */
  private eventBus: EventBus<LogicEventMap>;

  /**
   * Текущее состояние приложения (хранится в памяти)
   */
  private state: GameState;

  /**
   * Wrapper'ы подписчиков с селекторами
   * Каждый wrapper проверяет изменилась ли его часть состояния
   * и вызывает subscriber только при реальном изменении
   */
  private stateSubscribers: Array<(state: GameState) => void> = [];

  /**
   * Здесь будут модули:
   * private marketSimulator: MarketSimulator;
   * private tradingModule: TradingModule;
   * private educationModule: EducationModule;
   * и т.д.
   * 
   * Пока оставим пустым, добавим позже
   */

  private readonly sessionTimeline: SessionTimelineController;
  private readonly timeModule: TimeModuleService;
  private readonly marketModule: MarketModuleService;
  private readonly portfolioModule: PortfolioModuleService;
  private readonly tradingModule: TradingModuleService;
  private readonly educationModule: EducationModuleService;
  private readonly uiStateModule: UiStateModuleService;
  private readonly modules: Array<LogicModule<GameState>>;
  private readonly commandAwareModules: Array<LogicModule<GameState>>;
  private readonly moduleContext: ModuleContext;
  /** Глубина вложенной диспетчеризации: notifySubscribers — только на нулевой глубине. */
  private commandDepth = 0;
  private lastHydrateScheduleEpochMs: number | null = null;
  /** Последний wall-clock момент вызова notifySubscribers — для троттлинга. */
  private lastNotifyWallMs = 0;
  /** Минимальный реальный интервал между notifySubscribers: ~60fps. */
  private static readonly NOTIFY_MIN_INTERVAL_WALL_MS = 16;

  constructor() {
    console.log('[LogicManager] Инициализация...');

    this.eventBus = new EventBus<LogicEventMap>();

    const raw = tradingCalendarJson as { days: TradingDayRecord[] };
    const calendar = TradingCalendar.fromRecords(raw.days ?? []);
    this.sessionTimeline = new SessionTimelineController(calendar);
    this.timeModule = new TimeModuleService(this.sessionTimeline);
    this.marketModule = new MarketModuleService(calendar);
    this.marketModule.setNotifyHook(() => this.notifySubscribers());
    this.portfolioModule = new PortfolioModuleService();
    this.tradingModule = new TradingModuleService();
    this.educationModule = new EducationModuleService();
    this.uiStateModule = new UiStateModuleService();
    this.modules = [
      this.timeModule,
      this.marketModule,
      this.tradingModule,
      this.portfolioModule,
      this.educationModule,
      this.uiStateModule,
    ];
    this.commandAwareModules = this.modules.filter((m) =>
      Boolean(m.handleCommand)
    );
    this.moduleContext = {
      emit: (event, payload) => this.eventBus.emit(event, payload),
      dispatchCommand: (command) => this.dispatchCommand(command),
    };

    this.state = this.createInitialState();
    this.bootstrapMarketUiState();
    this.eventBus.on(TRADING_DAY_CHANGED, (payload) =>
      this.broadcastTradingDayChanged(payload)
    );
    this.eventBus.on(TRADE_REJECTED, () => this.notifySubscribers());

    const attachContext: ModuleAttachContext = {
      emit: this.moduleContext.emit,
      dispatchCommand: this.moduleContext.dispatchCommand,
      subscribe: (event, handler) => this.eventBus.on(event, handler),
    };
    for (const module of this.modules) {
      module.attach?.(attachContext);
    }

    // Здесь позже будем создавать модули:
    // this.marketSimulator = new MarketSimulator(this.eventBus);
    // this.tradingModule = new TradingModule(this.eventBus);
    // и т.д.

    console.log('[LogicManager] Инициализация завершена');
  }

  /**
   * Создать начальное состояние приложения
   */
  private createInitialState(): GameState {
    const timeState = this.timeModule.createInitialState();
    return {
      ...timeState,
      currentUser: null,
      portfolio: this.portfolioModule.createInitialState(),
      market: this.marketModule.createInitialState(timeState.simulationEpochMs),
      trading: this.tradingModule.createInitialState(),
      education: this.educationModule.createInitialState(),
      uiState: this.uiStateModule.createInitialState(),
    };
  }

  /**
   * Синхронизировать unlock-набор и выбор инструмента после появления каталога.
   */
  private bootstrapMarketUiState(): void {
    const changedEducation = this.educationModule.syncUnlockedFromCatalog(
      this.state
    );
    const changedUi = this.uiStateModule.ensureDefaultSelectedSymbol(this.state);
    const sel = this.state.uiState.selectedSymbol;
    if (sel && (changedUi || changedEducation)) {
      this.marketModule.rebuildChartLinesForSymbol(this.state, sel);
    }
  }

  /**
   * Главный метод обновления логики
   * Вызывается GameLoopRunner каждый кадр
   * 
   * @param deltaTime - Время с прошлого кадра в секундах (например, 0.1 для 100мс)
   */
  update(deltaTime: number): void {
    if (this.state.isPaused) {
      return;
    }

    if (!this.state.tradingCalendarReady) {
      this.eventBus.processQueue();
      this.notifySubscribers();
      return;
    }

    if (this.marketModule.shouldHoldSimulationAtBoundary(this.state)) {
      this.eventBus.processQueue();
      this.notifySubscribers();
      return;
    }

    this.eventBus.processQueue();
    const epochBeforeModules = this.state.simulationEpochMs;
    this.modules.forEach((module) =>
      module.update(this.state, deltaTime, this.moduleContext)
    );
    this.eventBus.processQueue();

    this.syncPortfolioWithMarketPrices();

    if (this.state.simulationEpochMs !== epochBeforeModules) {
      this.scheduleMarketHydrateFromDatabase(epochBeforeModules);
    }

    // ШАГ 3: Обновить все модули
    // Здесь позже будем вызывать update() у всех модулей:
    // this.marketSimulator.update();
    // this.tradingModule.update();
    // this.educationModule.update();
    // и т.д.

    // ШАГ 4: Уведомить UI об изменениях
    // Каждый подписчик получит только свою часть состояния
    // и только если она изменилась
    this.notifySubscribers();
  }

  /**
   * Подписаться на изменения ЧАСТИ состояния через селектор
   * 
   * Это профессиональный подход (используется в Redux, Zustand, Jotai)
   * React перерисует только если срез отличается от предыдущего (Object.is в setState)
   * 
   * @param selector - Функция выбирающая нужную часть состояния
   * @param subscriber - Callback который получит только выбранную часть
   * @returns Функция для отписки
   * 
   * Примеры использования:
   * 
   *   // Подписка на игровое время
   *   const unsubscribe = logicManager.subscribe(
   *     state => state.gameTime,
   *     (gameTime) => setState(gameTime)
   *   );
   * 
   *   // Подписка на цену акции
   *   const unsubscribe = logicManager.subscribe(
   *     state => state.market?.prices?.AAPL,
   *     (price) => setPrice(price)
   *   );
   * 
   *   // Подписка на весь портфель
   *   const unsubscribe = logicManager.subscribe(
   *     state => state.portfolio,
   *     (portfolio) => setPortfolio(portfolio)
   *   );
   */
  subscribe<T>(
    selector: Selector<T>,
    subscriber: StateSubscriber<T>,
    equalityFn: EqualityFn<T> = Object.is
  ): () => void {
    let previousValue = selector(this.state);
    subscriber(previousValue);

    const wrapper = (state: GameState) => {
      const nextValue = selector(state);
      if (equalityFn(previousValue, nextValue)) {
        return;
      }
      previousValue = nextValue;
      subscriber(nextValue);
    };
    
    // Добавляем wrapper в массив подписчиков
    this.stateSubscribers.push(wrapper);
    
    // Возвращаем функцию для отписки (для cleanup в useEffect)
    return () => {
      const index = this.stateSubscribers.indexOf(wrapper);
      if (index > -1) {
        this.stateSubscribers.splice(index, 1);
      }
    };
  }

  /**
   * Уведомить всех подписчиков об изменении состояния
   * Вызывается в конце каждого update()
   * 
   * Каждый wrapper передаёт текущий срез подписчику; лишние обновления отсекает React
   */
  private notifySubscribers(): void {
    // Троттлинг по реальному времени: не чаще ~60fps.
    // Предотвращает лишние React-диффы при высоких скоростях симуляции (100x/1000x),
    // когда update() вызывается гораздо чаще, чем браузер успевает рисовать.
    const now = performance.now();
    if (now - this.lastNotifyWallMs < LogicManager.NOTIFY_MIN_INTERVAL_WALL_MS) {
      return;
    }
    this.lastNotifyWallMs = now;
    this.stateSubscribers.forEach(wrapper => wrapper(this.state));
  }

  /**
   * Получить полное состояние приложения
   * 
   * ВАЖНО: В обычной работе используй subscribe() с селектором!
   * Этот метод нужен только для отладки или специальных случаев.
   * 
   * @returns Ссылка на состояние (не копия, для производительности)
   */
  getState(): Readonly<GameState> {
    return this.state;
  }

  /**
   * Получить доступ к EventBus
   * Модули получают EventBus через конструктор
   */
  getEventBus(): EventBus<LogicEventMap> {
    return this.eventBus;
  }

  /**
   * Единая командная точка для runtime-действий из UI.
   * Сохраняет текущее поведение, но фиксирует типизированную границу команд.
   */
  dispatchCommand(command: LogicCommand): void {
    this.commandDepth += 1;
    try {
      for (const module of this.commandAwareModules) {
        if (module.handleCommand?.(this.state, command, this.moduleContext)) {
          if (command.type === 'runtime/pause') {
            console.log('[LogicManager] Пауза');
          } else if (command.type === 'runtime/resume') {
            console.log('[LogicManager] Возобновление');
          } else if (command.type === 'runtime/set-time-scale') {
            console.log(`[LogicManager] TimeScale пресет: ${command.preset}x`);
          } else if (command.type === 'runtime/set-simulation-step') {
            console.log(`[LogicManager] Simulation step preset: ${command.preset}`);
          }
          return;
        }
      }
      console.warn(`[LogicManager] Команда не обработана: ${command.type}`);
    } finally {
      this.commandDepth -= 1;
      if (this.commandDepth === 0) {
        this.notifySubscribers();
      }
    }
  }

  /**
   * Поставить игру на паузу
   * update() не будет обновлять логику, но UI останется отзывчивым
   */
  pause(): void {
    this.dispatchCommand({ type: 'runtime/pause' });
  }

  /**
   * Снять игру с паузы
   */
  resume(): void {
    this.dispatchCommand({ type: 'runtime/resume' });
  }

  /**
   * Установить пресет скорости симуляции (только 1 | 10 | 100 | 1000).
   */
  setTimeScalePreset(preset: TimeScalePreset): void {
    this.dispatchCommand({ type: 'runtime/set-time-scale', preset });
  }

  /**
   * Установить шаг симуляции рыночного времени (1m или 5m).
   */
  setSimulationStepPreset(preset: SimulationStepPreset): void {
    this.dispatchCommand({ type: 'runtime/set-simulation-step', preset });
  }

  private syncPortfolioWithMarketPrices(): void {
    const pricesBySymbol: Record<string, number> = {};
    for (const p of this.state.portfolio.positions) {
      const price = this.state.market.assetsBySymbol[p.ticker.toUpperCase()]?.currentPriceRub;
      if (typeof price === 'number' && Number.isFinite(price)) {
        pricesBySymbol[p.ticker.toUpperCase()] = price;
      }
    }
    if (Object.keys(pricesBySymbol).length === 0) {
      return;
    }
    this.dispatchCommand({ type: 'market/sync-prices', pricesBySymbol });
  }

  /**
   * Полный сброс состояния
   * Используется для начала новой игры
   */
  reset(): void {
    console.log('[LogicManager] Сброс состояния');
    
    // Сбрасываем состояние на начальное
    this.state = this.createInitialState();
    this.bootstrapMarketUiState();

    // Очищаем очередь событий
    this.eventBus.clear();
    this.eventBus.on(TRADING_DAY_CHANGED, (payload) =>
      this.broadcastTradingDayChanged(payload)
    );
    this.eventBus.on(TRADE_REJECTED, () => this.notifySubscribers());

    const attachContext: ModuleAttachContext = {
      emit: this.moduleContext.emit,
      dispatchCommand: this.moduleContext.dispatchCommand,
      subscribe: (event, handler) => this.eventBus.on(event, handler),
    };
    for (const module of this.modules) {
      module.attach?.(attachContext);
    }

    this.notifySubscribers();
    void this.hydrateMarketFromDatabase();
  }

  private broadcastTradingDayChanged(payload: TradingDayChangedPayload): void {
    for (const module of this.modules) {
      module.onTradingDayChanged?.(this.state, payload, this.moduleContext);
    }
  }

  /**
   * Адаптивный интервал гидрации в симуляционном времени.
   * Формула 60_000 × max(1, timeScale / 10) обеспечивает ~10 гидраций/сек при
   * любой скорости, не перегружая главный поток на высоких скоростях:
   *   1x   → 60_000   (1 гидрация/сек)
   *   10x  → 60_000   (~10/сек)
   *   100x → 600_000  (~10/сек)
   *   1000x→ 6_000_000(~10/сек)
   */
  private getHydrateMinIntervalMs(): number {
    return Math.min(60_000 * Math.max(1, this.state.timeScale / 10), 6_000_000);
  }

  private scheduleMarketHydrateFromDatabase(previousEpochMs: number): void {
    const epoch = this.state.simulationEpochMs;
    if (
      this.lastHydrateScheduleEpochMs !== null &&
      epoch - this.lastHydrateScheduleEpochMs < this.getHydrateMinIntervalMs()
    ) {
      return;
    }
    this.lastHydrateScheduleEpochMs = epoch;
    void this.marketModule
      .hydrateFromDatabaseTick(this.state, previousEpochMs)
      .then((changed) => {
        if (changed) {
          this.notifySubscribers();
        }
      });
  }

  async hydrateMarketFromDatabase(previousEpochMs?: number): Promise<void> {
    const changed = await this.marketModule.hydrateFromDatabaseTick(
      this.state,
      previousEpochMs ?? this.state.simulationEpochMs - 1
    );
    if (changed) {
      this.notifySubscribers();
    }
  }
}