'use client';

/**
 * ВРЕМЕННАЯ ТЕСТОВАЯ СТРАНИЦА
 * 
 * Используется для проверки работы GameLoop, LogicManager, селекторов
 * Позже будет заменена на настоящий UI приложения
 * 
 * Функции:
 * - Отображение игрового времени
 * - Пауза/возобновление
 * - Ускорение/замедление симуляции
 * - Счётчик перерисовок (для проверки селекторов)
 */

import { useEffect, useState, useRef } from 'react';
import { gameLoop } from '@/logic/runners/GameLoop';

export default function Home() {
  const [gameTime, setGameTime] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  
  // Счётчик перерисовок
  const renderCount = useRef(0);
  
  // Увеличиваем счётчик при каждой перерисовке
  renderCount.current += 1;
  console.log(`[Page] 🎨 RENDER #${renderCount.current}`);

  // Запускаем GameLoop при монтировании компонента
  useEffect(() => {
    console.log('[Page] Монтирование компонента');
    
    // Запускаем игровой цикл
    gameLoop.start();
    setIsRunning(true);

    // Подписываемся на изменения gameTime
    const logicManager = gameLoop.getLogicManager();
    const unsubscribe = logicManager.subscribe(
      state => state.gameTime,  // Селектор — берём только gameTime
      (time) => {
        console.log('[Page] ✅ gameTime изменился:', time, '→ вызываем setGameTime');
        setGameTime(time);
      }
    );

    // Cleanup при размонтировании
    return () => {
      console.log('[Page] Размонтирование компонента');
      unsubscribe();
      gameLoop.stop();
    };
  }, []);

  const handlePause = () => {
    console.log('[Page] 🔴 Нажата кнопка ПАУЗА (изменится isPaused)');
    gameLoop.getLogicManager().pause();
  };

  const handleResume = () => {
    console.log('[Page] 🟢 Нажата кнопка ВОЗОБНОВИТЬ (изменится isPaused)');
    gameLoop.getLogicManager().resume();
  };

  const handleSpeedUp = () => {
    console.log('[Page] 🚀 Нажата кнопка УСКОРИТЬ (изменится timeScale)');
    const currentScale = gameLoop.getLogicManager().getState().timeScale;
    gameLoop.getLogicManager().setTimeScale(currentScale * 2);
  };

  const handleSlowDown = () => {
    console.log('[Page] 🐌 Нажата кнопка ЗАМЕДЛИТЬ (изменится timeScale)');
    const currentScale = gameLoop.getLogicManager().getState().timeScale;
    gameLoop.getLogicManager().setTimeScale(currentScale / 2);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gray-900 text-white">
      <div className="max-w-2xl w-full space-y-8">
        <h1 className="text-4xl font-bold text-center">
          FIRE Market Simulator
        </h1>

        <div className="bg-gray-800 rounded-lg p-8 space-y-6">
          {/* Счётчик перерисовок */}
          <div className="text-center border-b border-gray-700 pb-4">
            <div className="text-sm text-gray-400 mb-2">Перерисовок компонента</div>
            <div className="text-3xl font-bold text-pink-400">
              🎨 {renderCount.current}
            </div>
          </div>

          {/* Статус игрового цикла */}
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-2">Статус цикла</div>
            <div className={`text-2xl font-bold ${isRunning ? 'text-green-400' : 'text-red-400'}`}>
              {isRunning ? '🟢 Запущен' : '🔴 Остановлен'}
            </div>
          </div>

          {/* Игровое время */}
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-2">Игровое время</div>
            <div className="text-5xl font-bold text-blue-400">
              {gameTime.toFixed(2)}с
            </div>
          </div>

          {/* Кадры */}
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-2">Кадров выполнено</div>
            <div className="text-2xl font-bold text-purple-400">
              {gameLoop.getFrameCount()}
            </div>
          </div>

          {/* UPS */}
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-2">Частота обновлений</div>
            <div className="text-xl font-bold text-yellow-400">
              {gameLoop.getTargetUPS()} UPS
            </div>
          </div>

          {/* Управление */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handlePause}
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-6 rounded-lg transition"
            >
              ⏸ Пауза
            </button>

            <button
              onClick={handleResume}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition"
            >
              ▶️ Возобновить
            </button>

            <button
              onClick={handleSlowDown}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition"
            >
              🐌 Замедлить
            </button>

            <button
              onClick={handleSpeedUp}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition"
            >
              🚀 Ускорить
            </button>
          </div>
        </div>

        <div className="text-center text-sm text-gray-500">
          Откройте консоль браузера чтобы увидеть логи GameLoop и перерисовок
        </div>
      </div>
    </div>
  );
}