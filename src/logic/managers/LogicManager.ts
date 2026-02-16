import { EventBus } from '../systems/EventBus';

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

/**
 * Интерфейс состояния приложения
 * Пока минимальный, будем расширять по мере разработки
 */
export interface GameState {
  // Игровое время (в секундах с начала игры)
  gameTime: number;
  
  // Скорость симуляции (1.0 = нормальная, 2.0 = двойная, 0.5 = половинная)
  timeScale: number;
  
  // Игра на паузе?
  isPaused: boolean;
  
  // Текущий пользователь (null если не залогинен)
  currentUser: string | null;
  
  // Здесь будут данные модулей:
  // market: { prices: {...}, ... }
  // portfolio: { cash: 10000, stocks: {...}, ... }
  // education: { completedLessons: [...], ... }
  // и т.д.
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
  private eventBus: EventBus;

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

  constructor() {
    console.log('[LogicManager] Инициализация...');

    // Создаём EventBus
    this.eventBus = new EventBus();

    // Инициализируем начальное состояние
    this.state = this.createInitialState();

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
    return {
      gameTime: 0,
      timeScale: 1.0,
      isPaused: false,
      currentUser: null,
    };
  }

  /**
   * Главный метод обновления логики
   * Вызывается GameLoopRunner каждый кадр
   * 
   * @param deltaTime - Время с прошлого кадра в секундах (например, 0.1 для 100мс)
   */
  update(deltaTime: number): void {
    // Если игра на паузе — ничего не обновляем
    if (this.state.isPaused) {
      return;
    }

    // Применяем масштаб времени
    // Если timeScale = 2.0, то игровое время идёт в 2 раза быстрее
    const scaledDeltaTime = deltaTime * this.state.timeScale;

    // ШАГ 1: Обработать все события из очереди
    // Здесь обрабатываются команды пользователя и события от модулей
    this.eventBus.processQueue();

    // ШАГ 2: Обновить игровое время
    this.state.gameTime += scaledDeltaTime;

    // ШАГ 3: Обновить все модули
    // Здесь позже будем вызывать update() у всех модулей:
    // this.marketSimulator.update(scaledDeltaTime);
    // this.tradingModule.update(scaledDeltaTime);
    // this.educationModule.update(scaledDeltaTime);
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
   * Компонент перерисуется ТОЛЬКО если его данные изменились
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
    subscriber: StateSubscriber<T>
  ): () => void {
    // Получаем начальное значение выбранной части состояния
    let previousValue = selector(this.state);
    
    // Отправляем начальное значение новому подписчику сразу
    // Это нужно чтобы компонент не показывал "Загрузка..." до первого update()
    subscriber(previousValue);
    
    // Создаём wrapper который будет проверять изменения
    const wrapper = (state: GameState) => {
      // Выбираем нужную часть состояния
      const newValue = selector(state);
      
      // Сравниваем с предыдущим значением
      // Вызываем subscriber ТОЛЬКО если значение изменилось
      if (newValue !== previousValue) {
        previousValue = newValue;
        subscriber(newValue);
      }
      
      // Если значение не изменилось — ничего не делаем
      // React компонент НЕ перерисуется
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
   * Каждый wrapper проверит изменилось ли его значение
   * и вызовет subscriber только при реальном изменении
   */
  private notifySubscribers(): void {
    // Передаём текущее состояние каждому wrapper'у
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
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Поставить игру на паузу
   * update() не будет обновлять логику, но UI останется отзывчивым
   */
  pause(): void {
    this.state.isPaused = true;
    console.log('[LogicManager] Пауза');
    this.notifySubscribers(); // Уведомляем UI об изменении isPaused
  }

  /**
   * Снять игру с паузы
   */
  resume(): void {
    this.state.isPaused = false;
    console.log('[LogicManager] Возобновление');
    this.notifySubscribers(); // Уведомляем UI об изменении isPaused
  }

  /**
   * Изменить скорость симуляции
   * 
   * @param scale - Множитель скорости:
   *   0.5 = половинная скорость
   *   1.0 = нормальная скорость
   *   2.0 = двойная скорость
   *   5.0 = пятикратная скорость
   */
  setTimeScale(scale: number): void {
    if (scale < 0) {
      console.warn('[LogicManager] TimeScale не может быть отрицательным');
      return;
    }
    
    this.state.timeScale = scale;
    console.log(`[LogicManager] TimeScale изменён на ${scale}x`);
    this.notifySubscribers(); // Уведомляем UI об изменении timeScale
  }

  /**
   * Полный сброс состояния
   * Используется для начала новой игры
   */
  reset(): void {
    console.log('[LogicManager] Сброс состояния');
    
    // Сбрасываем состояние на начальное
    this.state = this.createInitialState();
    
    // Очищаем очередь событий
    this.eventBus.clear();
    
    // Уведомляем UI о новом состоянии
    this.notifySubscribers();
  }
}