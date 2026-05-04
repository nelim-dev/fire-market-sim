/**
 * EventBus — система событий для связи между модулями
 * 
 * Принцип работы:
 * 1. Модули подписываются на события через on()
 * 2. Модули генерируют события через emit()
 * 3. События попадают в очередь
 * 4. LogicManager вызывает processQueue() каждый update()
 * 5. Все callback функции подписчиков вызываются по порядку
 * 
 * Преимущества:
 * - Модули не знают друг о друге (слабая связанность)
 * - Легко добавлять новые модули без изменения старых
 * - События обрабатываются по порядку (детерминированность)
 */

type EventKey<T> = Extract<keyof T, string>;

export class EventBus<TEventMap extends object = Record<string, unknown>> {
  /**
   * Хранилище всех подписчиков
   * Ключ: название события (например, 'PRICE_CHANGED')
   * Значение: массив callback функций, подписанных на это событие
   */
  private events: Map<
    EventKey<TEventMap>,
    Array<(data: TEventMap[EventKey<TEventMap>]) => void>
  > = new Map();

  /**
   * Очередь событий (FIFO — первым пришёл, первым вышел)
   * Все события сначала попадают сюда, потом обрабатываются в processQueue()
   */
  private eventQueue: Array<{
    event: EventKey<TEventMap>;
    data: TEventMap[EventKey<TEventMap>];
  }> = [];

  /**
   * Подписаться на событие
   * 
   * @param event - Название события (например, 'PRICE_CHANGED')
   * @param callback - Функция, которая вызовется когда событие произойдёт
   * @returns Функция для отписки (можно вызвать чтобы отписаться)
   * 
   * Пример:
   *   const unsubscribe = eventBus.on('PRICE_CHANGED', (data) => {
   *     console.log('Цена изменилась:', data.price);
   *   });
   *   
   *   // Позже можно отписаться:
   *   unsubscribe();
   */
  on<K extends EventKey<TEventMap>>(
    event: K,
    callback: (data: TEventMap[K]) => void
  ): () => void {
    // Если для этого события ещё нет массива подписчиков — создаём пустой массив
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    
    // Добавляем callback в массив подписчиков
    // "!" говорит TypeScript: "я уверен что массив существует (мы только что создали)"
    this.events
      .get(event)!
      .push(callback as (data: TEventMap[EventKey<TEventMap>]) => void);

    // Возвращаем функцию для отписки (удобно для React useEffect cleanup)
    return () => this.off(event, callback);
  }

  /**
   * Отписаться от события
   * 
   * @param event - Название события
   * @param callback - Функция-подписчик, которую нужно удалить
   * 
   * Пример:
   *   eventBus.off('PRICE_CHANGED', myCallback);
   */
  off<K extends EventKey<TEventMap>>(
    event: K,
    callback: (data: TEventMap[K]) => void
  ): void {
    // Получаем массив подписчиков этого события
    const callbacks = this.events.get(event);
    
    // Если подписчиков нет — ничего не делаем
    if (!callbacks) return;

    // Находим позицию callback в массиве
    const index = callbacks.indexOf(
      callback as (data: TEventMap[EventKey<TEventMap>]) => void
    );
    
    // Если нашли — удаляем из массива
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Сгенерировать событие (добавить в очередь)
   * 
   * Важно: событие НЕ выполняется сразу!
   * Оно попадает в очередь и будет обработано в следующем update()
   * 
   * @param event - Название события
   * @param data - Данные события (любой объект)
   * 
   * Пример:
   *   // Пользователь нажал кнопку "Купить"
   *   eventBus.emit('BUY_STOCK', { ticker: 'AAPL', amount: 10 });
   *   
   *   // Цена изменилась
   *   eventBus.emit('PRICE_CHANGED', { AAPL: 151.5, TSLA: 201.2 });
   */
  emit<K extends EventKey<TEventMap>>(event: K, data: TEventMap[K]): void {
    // Добавляем событие в конец очереди
    this.eventQueue.push({ event, data });
  }

  /**
   * Обработать все события из очереди
   * 
   * Вызывается в LogicManager.update() каждый кадр логики
   * Обрабатывает события по порядку (FIFO)
   * 
   * Пример:
   *   logicManager.update() {
   *     eventBus.processQueue(); // ← Здесь обрабатываются все события
   *   }
   */
  processQueue(): void {
    // Обрабатываем события пока очередь не опустеет
    while (this.eventQueue.length > 0) {
      // Берём первое событие из очереди (shift удаляет из начала массива)
      // "!" — мы уверены что элемент есть (проверили length > 0)
      const { event, data } = this.eventQueue.shift()!;
      
      // Вызываем trigger для немедленного выполнения события
      this.trigger(event, data);
    }
  }

  /**
   * Немедленно выполнить событие (вызвать все callback)
   * 
   * Это ПРИВАТНЫЙ метод, вызывается только внутри processQueue()
   * Модули НЕ могут вызвать trigger напрямую — только через emit()
   * 
   * @param event - Название события
   * @param data - Данные для передачи в callback
   */
  private trigger<K extends EventKey<TEventMap>>(
    event: K,
    data: TEventMap[K]
  ): void {
    // Получаем всех подписчиков этого события
    const callbacks = this.events.get(event);
    
    // Если подписчиков нет — ничего не делаем
    if (!callbacks) return;

    // Вызываем КАЖДЫЙ callback с данными события
    // Пример: если на 'PRICE_CHANGED' подписано 3 модуля — вызовутся все 3 callback
    callbacks.forEach((callback) => callback(data));
  }

  /**
   * Очистить все подписки и очередь
   * 
   * Используется для тестов или при полном сбросе приложения
   */
  clear(): void {
    this.events.clear();
    this.eventQueue = [];
  }

  /**
   * Получить количество событий в очереди (для отладки)
   */
  getQueueSize(): number {
    return this.eventQueue.length;
  }

  /**
   * Получить количество подписчиков на событие (для отладки)
   */
  getSubscriberCount(event: EventKey<TEventMap>): number {
    return this.events.get(event)?.length || 0;
  }
}