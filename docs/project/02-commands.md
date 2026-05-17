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

# 2. Зависимости загрузчика MOEX (отдельный пакет)
npm --prefix downloadStockData install
```

Зависимости разнесены, потому что `better-sqlite3` нужен только для сборки БД, а
`downloadStockData/` — самостоятельный пакет с другим набором зависимостей.

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

### 3.1. Скачать через MOEX ISS (опционально — если данных ещё нет)

1. Открыть `downloadStockData/src/tickers.config.ts` и дописать SECID/ISIN в нужный список:
   - `BOND_IDS` — для облигаций;
   - `STOCK_IDS` — для акций;
   - `FUND_IDS` — для БПИФ/ETF.
2. Запустить загрузчик:

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

# Валюта USD/RUB TOM (MOEX CETS)
npm run download:moex-currency
npm run download:moex-currency:smoke
npm run download:moex-currency:incremental
```

Результат окажется в `downloadStockData/output/`:
- `candles/<SECID>.txt` — Finam-формат минутных свечей;
- `meta/<SECID>.instrument.txt` — поля биржевой карточки (LOTSIZE, FACEVALUE, MATDATE, ISIN…);
- `meta/<SECID>_dividens.txt` — даты закрытия реестра и суммы (для акций);
- `meta/<SECID>.coupon-schedule.txt` — расписание купонов (для облигаций);
- `meta/<SECID>.cashflows-other.txt` — амортизации / погашение.

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
Метаданные (`*.instrument.txt`, `*_dividens.txt`, `*.coupon-schedule.txt`,
`*.cashflows-other.txt`) **остаются в** `downloadStockData/output/meta/` — каталог
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
`data/market.sqlite`. Также копирует `src/data/generated/tradingCalendar.json` →
`data/tradingCalendar.json` (это файл, который видит Electron main).

После пересборки БД достаточно перезапустить `electron:dev` — все новые тикеры
появятся в каталоге UI.

### 3.5. Если демо-портфель должен сразу видеть новый актив

Открыть `src/data/portfolio/buildDemoPortfolio.ts` и добавить позицию через
функцию `position(...)`. См. формат существующих SBER / SU26227RMFS7 / SBMM.

### 3.6. Макропоказатели шапки (BR, USD/RUB, ставка ЦБ)

| Показатель | Файл | Каталог / график |
|---|---|---|
| Нефть Brent | `indexes/BR.txt` (Finam) | Да, `assetKind: index` — график, без торговли |
| USD/RUB | `tickers/USD000UTSTOM.txt` | Да — график и котировки (`npm run download:moex-currency` → скопировать свечи в `tickers/`) |
| Ставка ЦБ | `indexes/KS.txt` (таб: `DD.MM.YYYY`, ставка %) | **Нет** — только шапка; в каталог не попадает |

После добавления файлов — как в §3.3–3.4 (`gen:market-catalog`, `gen:calendar`, `build:market-db`).
`build:market-db` также импортирует `KS.txt` в таблицу `key_rate_events` и пишет
`src/data/generated/keyRateSchedule.json` для логики без Electron.

Порядок чипов в шапке: **💰** → **🛢** → **💵** → **📈** (ставка ЦБ скрыта до 16.09.2013).

---

## 4. Тесты

```powershell
# Отдельные вехи
npm run test:m1     # TimeModule + основной цикл
npm run test:m2     # Портфель, селекторы (NAV, прибыль за период, upcoming)
npm run test:m3     # Рынок: каталог, котировки, графики, retention chartSeries, агрегации, дивиденды
npm run test:m4     # Трейдинг: ордера, НКД, FIFO, налоги, журнал

# Все вехи M1–M10 подряд (M5–M10 пока stub)
npm run test:all

# Тесты загрузчика MOEX
npm run test:download-stock-data

# Архитектурные инварианты (отдельным запуском, не в test:all)
npx tsx tests/console/arch-invariants.test.ts

# Проверка типов
npx tsc --noEmit
```

Все тесты выводят результат в формате `[<milestone>] Тест <N>: <описание> — ✅/❌`.

---

## 5. Быстрый чек-лист «добавил новый актив — что проверить»

1. `npm run gen:market-catalog` — актив появился в `marketInstrumentCatalog.json`?
2. `npm run gen:instrument-details` — есть запись в `lotSizeBySymbol`/`instrumentMetaBySymbol`?
3. `npm run build:market-db` — отработал без ошибок, размер `data/market.sqlite` вырос?
4. `npm run electron:dev` — актив виден в правой панели и его график рисуется?
5. `npm run test:m3` и `npm run test:m4` — зелёные?

---

## 6. Полный перечень npm-скриптов

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
| `build:market-db` | Собрать `data/market.sqlite`. |
| `download:moex-bonds[:smoke\|:incremental]` | MOEX ISS — облигации. |
| `download:moex-stocks[:smoke\|:incremental]` | MOEX ISS — акции. |
| `download:moex-funds[:smoke\|:incremental]` | MOEX ISS — фонды. |
| `test:download-stock-data` | Тесты пакета загрузчика. |
| `test:m1` … `test:m10` | Вехи тестов; `m5..m10` — stub. |
| `test:all` | M1 → M10 подряд. |
