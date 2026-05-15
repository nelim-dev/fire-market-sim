# FIRE Market Sim — Симулятор начинающего инвестора

Десктоп-приложение (Next.js + React + Electron + SQLite) для обучения новичков
азам инвестиций на исторических данных Московской биржи (2013–2026).

> Полная UI/UX-спецификация — `docs/TZ_MARKET.txt`. Этот README — краткий вход
> для разработчика. Подробная документация — в [`docs/project/`](docs/project/).

---

## Документация проекта

| Файл | О чём |
|---|---|
| [`docs/project/01-architecture.md`](docs/project/01-architecture.md) | Текущее устройство кодовой базы: слои, модули, подмодули, ключевые файлы и их назначение. |
| [`docs/project/02-commands.md`](docs/project/02-commands.md) | Все команды: запуск, релизная сборка, добавление активов, генерация каталогов и SQLite, тесты. |
| [`docs/project/03-status-vs-tz.md`](docs/project/03-status-vs-tz.md) | Что реализовано, что — нет: статус каждого пункта ТЗ + словесный итог «что осталось до полноценного симулятора». |

---

## Быстрый старт

```powershell
# 1. Зависимости
npm install
npm --prefix downloadStockData install

# 2. Запуск (Electron + Next + SQLite)
npm run electron:dev

# 3. Тесты
npm run test:all
```

> Полноценный режим — только через **Electron** (`electron:dev`).
> Чистый `npm run dev` в браузере не видит SQLite и рынок останется пустым.

---

## Стек

- **Frontend:** TypeScript, React 19, Next.js 16, Tailwind CSS 4
- **Desktop:** Electron 40 (NSIS-инсталлятор под Windows)
- **БД:** SQLite — `better-sqlite3` для сборки, `sql.js` (WASM) в окне
- **Время / даты:** `date-fns`, `date-fns-tz` (всё в Europe/Moscow)
- **Тесты:** свой консольный runner (`tests/console/`) на `tsx`
- **Загрузчик:** отдельный пакет `downloadStockData/` к MOEX ISS API

---

## Структура верхнего уровня

```
fire-market-sim/
├── src/
│   ├── app/          ← Next.js страницы (game / learn / achievements / settings)
│   ├── components/   ← React-компоненты (header, portfolio, market)
│   ├── hooks/        ← useGameState (подписка на LogicManager)
│   ├── logic/        ← ядро: GameLoop, LogicManager, EventBus, модули
│   └── data/         ← модели данных, сгенерированные каталоги
├── scripts/          ← gen:catalog, gen:details, gen:calendar, build:market-db
├── electron/         ← main.js, IPC к SQLite
├── downloadStockData/← пакет-загрузчик MOEX ISS
├── tickers/, bonds/, fonds/, indexes/   ← Finam-формат .txt свечей
├── data/             ← market.sqlite, tradingCalendar.json (артефакты сборки)
├── tests/console/    ← M1–M4 + arch-инварианты
└── docs/             ← TZ_MARKET.txt + docs/project/* (этот README ссылается сюда)
```

---

## Что уже работает

- Симуляция исторических минутных котировок MOEX с детерминированным циклом (20 UPS).
- Покупка/продажа акций, облигаций (с НКД), фондов — комиссии, лотность, FIFO.
- НДФЛ 13% на дивиденды, купоны, реализованную прибыль и погашение бондов.
- Cut-off для участия в реестре дивидендов по реальному правилу Мосбиржи (T+0/T+2/T+1).
- Единый финансовый журнал (`LedgerEntry`) с фильтром по типу операций.
- Графики цены в **торговом времени** (без растягивания на ночь/выходные) + forward-fill для редких серий.
- 60+ автотестов (`test:m1..m4` + `arch-invariants`).

## Чего пока нет

- Вкладки «Обучение», «Достижения», «Настройки» — только заглушки.
- Локальное сохранение прогресса.
- Тепловая карта рынка, статистика портфеля (волатильность, Шарп, α).
- Свечные кэндлы (есть только линейный график).
- Туториал и модальные окна из ТЗ §10–§11.
- Светлая тема.

Полный разбор — в [`docs/project/03-status-vs-tz.md`](docs/project/03-status-vs-tz.md).
