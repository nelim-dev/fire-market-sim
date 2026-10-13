# Команды и процедуры — FIRE Market Sim

Все команды запускаются из корня репозитория, если не указано иное.
Платформа разработки — Windows + PowerShell.

> Совет PowerShell: оператор `&&` поддерживается **только** в PowerShell 7+.
> В Windows PowerShell 5.1 запускайте команды последовательно или используйте
> `;` с проверкой `$LASTEXITCODE`.

---

## 1. Установка

```powershell
# 1. Зависимости основного проекта
npm install

# 2. Зависимости загрузчика (отдельный пакет, НЕ входит в репозиторий)
npm --prefix downloadStockData install
```

`better-sqlite3` — нативный модуль с **двумя ABI**: системный Node (тесты,
`build:market-db`) и Node внутри Electron (`electron:dev`). После `npm install`
выполните `npm run rebuild:electron`. Если запускали `npm run test:a1` или
`npm run rebuild:node` — **снова** `npm run rebuild:electron` перед
`npm run electron:dev`, иначе `market:get-day-slices` падает и симуляция может
зависнуть на границе торгового дня.

> `downloadStockData/` — **локальный инструмент** (скачивание данных),
> **не входит в репозиторий** и не нужен для сборки/запуска. Все скрипты
> `download:*` работают только при наличии этого пакета на диске.

---

## 2. Запуск приложения

### 2.1. Полноценный режим (Electron + Next + SQLite)

```powershell
npm run electron:dev
```

Делает:
1. Запускает Next.js dev-сервер (`npm run dev`) на `http://localhost:3000`.
2. Ждёт его готовности (`wait-on`).
3. Запускает Electron, который грузит этот URL и поднимает IPC-хендлеры
   (`market:get-slices`, `market:prefetch-day`, `market:prefetch-next-day`)
   к `data/market.sqlite`.

> Только в Electron-режиме реально работают графики и котировки — `npm run dev` в браузере не имеет доступа к SQLite и оставит карточку инструмента пустой до гидратации.

### 2.2. Только Next.js dev (для UI-стилей и быстрых правок верстки)

```powershell
npm run dev
```

### 2.3. Релизная сборка для Windows (NSIS)

```powershell
npm run electron:build
```

Сценарий:
1. `next build` → статика в `out/`.
2. `npm run build:market-db` → актуальная `data/market.sqlite`.
3. `electron-builder` пакует:
   - `electron/**/*` и `out/**/*` (основное);
   - `data/market.sqlite` и `data/tradingCalendar.json` через `extraResources`.

Артефакт — `dist/FIRE Market Simulator Setup *.exe` (см. `package.json` → `build.win`).
Исходные `.txt`-свечи в установщик не включаются.

### 2.4. Локальный запуск уже собранной версии

```powershell
npm run electron:start
```

---

## 3. Добавление новых активов

Полный конвейер: *скачать* → *положить в нужную папку* → *перегенерировать каталоги* → *пересобрать БД*.

### 3.1. Скачать данные (опционально — если данных ещё нет)

> Требует локальный пакет `downloadStockData/` (не в репозитории).

```powershell
# Полная история выбранного типа
npm run download:moex-bonds
npm run download:moex-stocks
npm run download:moex-funds

# Smoke (быстрая проверка одного-двух активов)
npm run download:moex-bonds:smoke
npm run download:moex-stocks:smoke
npm run download:moex-funds:smoke

# Инкрементальная докачка (дополнить недостающие даты)
npm run download:moex-bonds:incremental
npm run download:moex-stocks:incremental
npm run download:moex-funds:incremental
```

Результат окажется в `downloadStockData/output/`:
- `candles/<SECID>.txt` — минутные свечи;
- `meta/<SECID>.instrument.txt` — поля биржевой карточки (LOTSIZE, FACEVALUE, MATDATE, ISIN…).

### 3.2. Положить файл свечей в папку рынка

Файл свечей `*.txt` нужно вручную скопировать (или перенести) в правильную папку
в корне проекта — она и определяет, как актив будет классифицирован:

| Тип актива | Папка | Можно ли торговать |
|---|---|---|
| Акции | `tickers/` | Да |
| Облигации | `bonds/` | Да |
| Фонды | `fonds/` | Да |
| Индексы | `indexes/` | **Нет** (только просмотр графика) |

Имя файла = тикер/SECID без расширения (`SBER.txt`, `SU26227RMFS7.txt`).
Метаданные `*.instrument.txt` остаются в `downloadStockData/output/meta/` — каталог
деталей читает их оттуда напрямую.

### 3.3. Перегенерировать каталоги

```powershell
# Каталог инструментов рынка (из tickers/bonds/fonds/indexes)
npm run gen:market-catalog
# Каталог не-ценовой информации (из downloadStockData/output/meta/)
npm run gen:instrument-details
# Календарь торговых сессий (из .txt свечей)
npm run gen:calendar
```

Все три скрипта пишут результат в `src/data/generated/`:
- `marketInstrumentCatalog.json`
- `marketInstrumentDetailsCatalog.json`
- `tradingCalendar.json`

### 3.4. Пересобрать SQLite (минутные ряды)

```powershell
npm run build:market-db
```

Скрипт читает `.txt` из `tickers/`, `bonds/`, `fonds/`, `indexes/`, отфильтровывает
бары по диапазону календаря (см. `loadBarEpochFilter`) и пишет всё в
`data/market.sqlite`. БД может быть больше 2 GiB — чтение идёт через
`better-sqlite3` в main-процессе (не через загрузку всего файла в RAM).
После пересборки БД перезапустите `electron:dev`.

### 3.5. Если демо-портфель должен сразу видеть новый актив

Открыть `src/data/portfolio/buildDemoPortfolio.ts` и добавить позицию через
функцию `position(...)`. См. формат существующих позиций в демо-портфеле.

---

## 4. Тесты

```powershell
# Отдельные вехи
npm run test:m1     # TimeModule + основной цикл
npm run test:m2     # Портфель, селекторы (NAV, прибыль за период, upcoming)
npm run test:m3     # Рынок: каталог, котировки, графики, retention chartSeries, агрегации, дивиденды
npm run test:m4     # Трейдинг: ордера, НКД, FIFO, налоги, журнал
npm run test:m5     # Обучение: каталог, селекторы, unlock-правила
npm run test:m7     # Персистентность: слоты, снапшоты, IPC-контракт

# Все вехи M1–M10 подряд (M6, M8–M10 — stub)
npm run test:all

# ML-аналитика (требует python + pip install -r resources/ml/python/requirements.txt)
npm run test:a1     # Тензор дня, smoke predict
npm run test:a2     # Parity: cond_vae на интегрированном пайплайне

# Архитектурные инварианты (отдельным запуском, не в test:all)
npx tsx tests/console/arch-invariants.test.ts

# Проверка типов
npx tsc --noEmit
```

---

## 5. Полный перечень npm-скриптов

Источник истины — `package.json`. На момент написания:

| Скрипт | Что делает |
|---|---|
| `dev` | Next.js dev-сервер. |
| `build` | `next build`. |
| `start` | `next start`. |
| `electron:dev` | Next dev + Electron в DEV. |
| `electron:build` | `next build` + `build:market-db` + `electron-builder`. |
| `electron:start` | Запустить Electron на собранной версии. |
| `gen:calendar` | Сгенерировать `tradingCalendar.json`. |
| `gen:market-catalog` | Сгенерировать `marketInstrumentCatalog.json`. |
| `gen:instrument-details` | Сгенерировать `marketInstrumentDetailsCatalog.json`. |
| `gen:inflation-schedule` | Сгенерировать расписание инфляции. |
| `gen:inflation-index-data` | Сгенерировать индекс инфляции INFL. |
| `gen:fireidx-candles` | Сгенерировать свечи составного индекса FIREIDX. |
| `gen:dn-r-candles` | Сгенерировать свечи фонда DN-R. |
| `build:market-db` | Собрать `data/market.sqlite`. |
| `download:moex-bonds[:smoke\|:incremental]` | Облигации (**требует локальный пакет**). |
| `download:moex-stocks[:smoke\|:incremental]` | Акции (**требует локальный пакет**). |
| `download:moex-funds[:smoke\|:incremental]` | Фонды (**требует локальный пакет**). |
| `test:download-stock-data` | Тесты пакета загрузчика (**требует локальный пакет**). |
| `test:m1` … `test:m10` | Вехи тестов; `m6`, `m8..m10` — stub. |
| `test:a1` | ML-аналитика: тензор дня, smoke predict. |
| `test:a2` | Parity cond_vae на интегрированном пайплайне. |
| `test:all` | M1 → M10 + A1 подряд. |
| `setup:ml-python` | Embedded Python + TensorFlow в `resources/ml/` (перед `electron:build`). |
