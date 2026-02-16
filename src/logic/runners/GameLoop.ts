import { LogicManager } from '../managers/LogicManager';

/**
 * GameLoop — запускает игровой цикл обновления логики
 * 
 * Реализует паттерн Game Loop из "Game Programming Patterns"
 * 
 * Обязанности:
 * - Создаёт и хранит LogicManager
 * - Запускает цикл обновления с фиксированной частотой (UPS)
 * - Вычисляет deltaTime между кадрами
 * - Вызывает logicManager.update(deltaTime) каждый кадр
 * 
 * UPS (Updates Per Second) — частота обновления ЛОГИКИ
 * НЕ путать с FPS (Frames Per Second) — частота обновления UI
 * 
 * Примеры:
 *   20 UPS = 50мс между обновлениями логики
 *   60 FPS = 16мс между обновлениями UI (React)
 */
class GameLoop {
  /**
   * Главный менеджер логики приложения
   */
  private logicManager: LogicManager;

  /**
   * Флаг запущен ли цикл
   */
  private isRunning: boolean = false;

  /**
   * Целевая частота обновлений логики (Updates Per Second)
   * По умолчанию 20 UPS = 50мс между обновлениями
   */
  private targetUPS: number = 20;

  /**
   * Целевое время одного кадра в миллисекундах
   * Вычисляется как 1000 / targetUPS
   */
  private targetFrameTime: number = 1000 / this.targetUPS;

  /**
   * Время последнего обновления (в миллисекундах)
   * Используется для вычисления deltaTime
   */
  private lastUpdateTime: number = 0;

  /**
   * ID текущего requestAnimationFrame
   * Нужен для отмены цикла при stop()
   */
  private animationFrameId: number | null = null;

  /**
   * Счётчик кадров для отладки
   */
  private frameCount: number = 0;

  /**
   * Приватный конструктор (Singleton паттерн)
   * Создаёт LogicManager при инициализации
   */
  private constructor() {
    console.log('[GameLoop] Инициализация...');
    
    // Создаём главный менеджер логики
    this.logicManager = new LogicManager();
    
    console.log(`[GameLoop] Целевая частота: ${this.targetUPS} UPS (${this.targetFrameTime}мс)`);
    console.log('[GameLoop] Инициализация завершена');
  }

  /**
   * Запустить игровой цикл
   * 
   * Использует requestAnimationFrame для синхронизации с браузером
   * Автоматически останавливается когда вкладка неактивна (экономия ресурсов)
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[GameLoop] Цикл уже запущен');
      return;
    }

    console.log('[GameLoop] Запуск игрового цикла...');
    this.isRunning = true;
    this.lastUpdateTime = performance.now();
    this.frameCount = 0;

    // Запускаем первую итерацию цикла
    this.loop(this.lastUpdateTime);
  }

  /**
   * Остановить игровой цикл
   * 
   * Отменяет текущий requestAnimationFrame
   * Логика перестаёт обновляться, но состояние сохраняется
   */
  stop(): void {
    if (!this.isRunning) {
      console.warn('[GameLoop] Цикл уже остановлен');
      return;
    }

    console.log('[GameLoop] Остановка игрового цикла...');
    this.isRunning = false;

    // Отменяем следующий кадр
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    console.log(`[GameLoop] Цикл остановлен (выполнено кадров: ${this.frameCount})`);
  }

  /**
   * Главный игровой цикл
   * 
   * Вызывается браузером через requestAnimationFrame (~60 раз в секунду)
   * Но update() вызывается только когда прошло достаточно времени (targetFrameTime)
   * 
   * Использует Fixed Timestep подход:
   * - Всегда передаёт фиксированный deltaTime в логику
   * - Гарантирует детерминированность симуляции
   * - Если ПК медленный — игра тормозит, но не ломается
   * 
   * @param currentTime - Текущее время в миллисекундах (от performance.now())
   */
  private loop = (currentTime: number): void => {
    // Если цикл остановлен — не планируем следующий кадр
    if (!this.isRunning) {
      return;
    }

    // Вычисляем сколько времени прошло с последнего обновления
    const deltaTime = currentTime - this.lastUpdateTime;

    // Обновляем логику только если прошло достаточно времени
    if (deltaTime >= this.targetFrameTime) {
      // Увеличиваем счётчик кадров
      this.frameCount++;

      // Вызываем обновление логики с ФИКСИРОВАННЫМ deltaTime
      // Это гарантирует детерминированность (одинаковые результаты при повторе)
      const fixedDeltaTime = this.targetFrameTime / 1000; // Переводим в секунды
      
      // Главное обновление логики
      this.logicManager.update(fixedDeltaTime);

      // Обновляем время последнего обновления
      this.lastUpdateTime = currentTime;

      // Логируем каждые 100 кадров (для отладки)
      if (this.frameCount % 100 === 0) {
        console.log(`[GameLoop] Кадр ${this.frameCount}, deltaTime: ${deltaTime.toFixed(2)}мс`);
      }
    }

    // Планируем следующую итерацию цикла
    // requestAnimationFrame вызовет loop() когда браузер готов к следующему кадру
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  /**
   * Получить LogicManager
   * 
   * UI использует это для подписки на состояние:
   *   const logicManager = gameLoop.getLogicManager();
   *   logicManager.subscribe(state => state.gameTime, setGameTime);
   * 
   * @returns Экземпляр LogicManager
   */
  getLogicManager(): LogicManager {
    return this.logicManager;
  }

  /**
   * Изменить целевую частоту обновлений
   * 
   * Можно использовать для настроек производительности
   * Например, на слабых ПК снизить до 10 UPS
   * 
   * @param ups - Новая частота (Updates Per Second)
   * 
   * Примеры:
   *   setTargetUPS(10)  // 10 обновлений в секунду (100мс)
   *   setTargetUPS(20)  // 20 обновлений в секунду (50мс)
   *   setTargetUPS(60)  // 60 обновлений в секунду (16мс)
   */
  setTargetUPS(ups: number): void {
    if (ups <= 0) {
      console.warn('[GameLoop] UPS должен быть больше 0');
      return;
    }

    this.targetUPS = ups;
    this.targetFrameTime = 1000 / ups;
    
    console.log(`[GameLoop] UPS изменён: ${ups} (${this.targetFrameTime.toFixed(2)}мс между кадрами)`);
  }

  /**
   * Получить текущую частоту обновлений
   * 
   * @returns Текущий UPS
   */
  getTargetUPS(): number {
    return this.targetUPS;
  }

  /**
   * Проверить запущен ли цикл
   * 
   * @returns true если цикл работает
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Получить количество выполненных кадров логики
   * 
   * Полезно для отладки и статистики
   * 
   * @returns Количество кадров с момента start()
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  // ========================================
  // Singleton паттерн
  // ========================================

  /**
   * Единственный экземпляр GameLoop
   */
  private static instance: GameLoop | null = null;

  /**
   * Получить экземпляр GameLoop (Singleton)
   * 
   * Создаёт экземпляр при первом вызове,
   * при повторных вызовах возвращает тот же экземпляр
   * 
   * @returns Единственный экземпляр GameLoop
   */
  static getInstance(): GameLoop {
    if (!this.instance) {
      this.instance = new GameLoop();
    }
    return this.instance;
  }
}

/**
 * Экспортируем единственный экземпляр
 * Использование:
 *   import { gameLoop } from '@/logic/runners/GameLoop';
 *   gameLoop.start();
 */
export const gameLoop = GameLoop.getInstance();

/**
 * Также экспортируем класс (для типов)
 */
export type { GameLoop };