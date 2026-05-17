# Архитектура проекта FIRE Market Sim

Этот документ описывает фактическое устройство кодовой базы на момент написания.
Цель — быстро ориентироваться в коде, не открывая каждый файл.

> Не путать с `docs/TZ_MARKET.txt` — это целевое ТЗ. Здесь же — «что есть».

---

## 1. Слои и их ответственность

Проект построен по трёхслойной схеме (как в ТЗ, §2):

| Слой | Где | Что делает |
|---|---|---|
| **Presentation** | `src/app/*`, `src/components/*`, `src/hooks/*` | React/Next.js страницы, компоненты, селекторы UI |
| **Logic** | `src/logic/*` | Игровой цикл, оркестратор, модули предметной области, EventBus |
| **Data** | `src/data/*`, `scripts/*`, `electron/*`, `downloadStockData/*` | Сборка БД, JSON-каталоги, IPC к Electron, загрузчик MOEX ISS |

Жёсткие архитектурные правила собраны в `.cursor/rules/modular-architecture.mdc` — модули
общаются только через **типизированные события** и **команды**; UI пассивен;
бизнес-логика никогда не живёт в компонентах.

---

## 2. Слой логики (`src/logic/`)

### 2.1. Корневые файлы

| Файл | Назначение |
|---|---|
| `logicEvents.ts` | Все типизированные события: торговые, рыночные декларации (слой A), брокерские подтверждения (слой B). |
| `runtimeCommands.ts` | Команды управления симуляцией: pause / resume / time-scale / step. |
| `stateSelectors.ts` | Общие селекторы `GameState` (cash, simulationEpochMs, portfolio, isPaused…). |

### 2.2. Системы (`src/logic/systems/`)

| Файл | Назначение |
|---|---|
| `EventBus.ts` | Типизированная шина: `emit(event, payload)`, `on(event, handler)`, `processQueue()`. Только транспорт — никакой бизнес-логики. |

### 2.3. Раннер (`src/logic/runners/`)

| Файл | Назначение |
|---|---|
| `GameLoop.ts` | Fixed-timestep 20 UPS, вызывает `LogicManager.update()`. Singleton-экземпляр `gameLoop`. |

### 2.4. Оркестратор (`src/logic/managers/`)

| Файл | Назначение |
|---|---|
| `LogicManager.ts` | Создаёт модули, держит единый `GameState`, гоняет update-цикл, маршрутизирует команды, рассылает события и нотификации UI. Не содержит бизнес-логики модулей. |

### 2.5. Время и календарь (`src/logic/time/`, `src/logic/simulation/`)

| Файл | Назначение |
|---|---|
| `time/TradingCalendar.ts` | Read-only календарь торговых сессий (загружается из `tradingCalendar.json`). |
| `time/SessionTimelineController.ts` | Управляет «текущим днём» и переходом ночь/выходные → следующая сессия. |
| `time/tradingTimeSlots.ts` | Утилиты сетки слотов в торговом времени (back-walk, forward-fill для графиков, поиск сессии по эпохе). |
| `simulation/simulationConfig.ts` | Пресеты скорости (1x/10x/100x/1000x), шаг симуляции (1m/5m), отладочная стартовая дата. |
| `simulation/formatSimulationTime.ts` | Форматирование симуляционного времени в MSK. |

### 2.6. Доменные типы (`src/logic/domain/`)

| Файл | Назначение |
|---|---|
| `portfolio.ts` | `PositionLot`, `PortfolioPosition`, `LedgerEntry` (discriminated union по `kind`), `NavSnapshot`, `PortfolioState`. FIFO-партии, единый финансовый журнал. |

### 2.7. Модули предметной области (`src/logic/modules/`)

Базовый интерфейс — `LogicModule<TState>` в `contracts.ts`:
- `update(state, dt, ctx)` — обязательный метод тика;
- `handleCommand(state, cmd, ctx)` — опционально, возвращает `true` если команда обработана;
- `onTradingDayChanged(...)` — опциональный хук на смену торгового дня;
- `attach(ctx)` — опциональный хук подписки на события после старта.

#### TimeModule (`time/`)
| Файл | Содержит |
|---|---|
| `service.ts` | `TimeModuleService` — двигает `simulationEpochMs`, эмитит `TRADING_DAY_CHANGED`, обрабатывает runtime-команды pause/resume/time-scale. |
| `state.ts` | `TimeModuleState` (epoch, sessions, paused, scale). |
| `selectors.ts`, `events.ts` | Селекторы и хелперы событий. |

#### MarketModule (`market/`) — рынок и корпоративные действия
| Файл | Содержит |
|---|---|
| `service.ts` | `MarketModuleService` — главный класс рынка: gates по календарю, гидратация рядов из SQLite через IPC, scan/emit корпоративных действий. |
| `state.ts` | `MarketModuleState` + `MarketAssetState` (per-symbol состояние: цена, окно графика, lotSize, isBond, faceValue, НКД). |
| `contracts.ts` | Каталог `MarketInstrumentCatalogItem`, `AssetKind`, `OrderBookSnapshot`, `AssetSourceDirectory`. |
| `assetSources.ts` | Перечень папок-источников по виду актива (`indexes/`, `bonds/`, `tickers/`, `fonds/`). |
| `fileScanner.ts` | Сканер `.txt`-файлов котировок → каталог инструментов. |
| `instrumentDetails.ts` | Загрузка `marketInstrumentDetailsCatalog.json` (lot, мета, дивиденды, купоны, погашения). |
| `catalogSort.ts`, `selectors.ts` | Сортировка по виду + тикеру, селекторы (по символу, по виду, секциями). |
| `priceSeries.ts` | Типы `MarketPriceBar` (OHLCV), `lastBarIndexAtOrBefore`, `sliceTailAtOrBeforeEpoch` (хвост ряда до epoch без копии всего префикса). |
| `minuteBarAggregation.ts` | Агрегация минутных баров в 5m/30m/1h/1d/1w. |
| `chartTimeframes.ts` | ID таймфреймов и константы числа слотов (1d=530, 1w=530, 1m=380, 6m=1125, 1y=250). |
| `chartWindows.ts` | Сборка окна графика по таймфрейму + forward-fill для редких серий. |
| `chartBundleLimits.ts` | Lookback при **импорте** в SQLite (`CHART_BUNDLE_PRE_SESSION_MS` ≈ 370 дней до первой сессии). |
| `chartSeriesRetention.ts` | **Runtime:** после hydrate обрезает `chartSeries` intraday-ряды до объёма, достаточного для окон графика (`CHART_SERIES_STORE_MAX_BARS`); daily/weekly без count-cap (вкладка `all`). |
| `quoteApply.ts` | Применение котировок на текущий `simulationEpochMs` (цена, daily-change, окно графика, НКД для бондов). |
| `marketElectronBridge.ts` | Клиент IPC к Electron main (`market:get-slices`, `prefetch-day`, `prefetch-next-day`). |
| `macro.ts` | Контракт `MarketMacroSnapshot` (Brent, USD/RUB, ключевая ставка). |
| `macroSymbols.ts` | Символы макро-рядов: `BR`, `USD000UTSTOM`; stem `KS` исключён из каталога. |
| `macroResolve.ts` | Резолв макро по `simulationEpochMs` (close минутных баров + step-function KS). |
| `keyRateSchedule.ts` | Парсинг/загрузка расписания ставки ЦБ из `keyRateSchedule.json`. |
| `catalogExclusions.ts` | Исключение `KS.txt` из сканера каталога. |
| `corporateActions/state.ts` | `CorporateActionsState` с set уже эмитированных платежей (dedup). |
| `corporateActions/scheduleScanner.ts` | Сканер расписания в окне `(prev, current]` → `ScannedDeclaration[]` (dividend/coupon/maturity). |
| `corporateActions/dividendEligibility.ts` | Правило biz-cut-off для дивидендов: T+0/T+2/T+1 по эре Мосбиржи (`< 02.09.2013` / `< 31.07.2023` / иначе). |
| `corporateActions/emitter.ts` | Эмит типизированных событий `MARKET_DIVIDEND_DECLARED` / `MARKET_COUPON_DECLARED` / `MARKET_BOND_MATURED`. |

#### TradingModule (`trading/`) — брокер: ордера, комиссии, налоги
| Файл | Содержит |
|---|---|
| `service.ts` | `TradingModuleService` — валидация и исполнение market-ордеров, комиссия 0.1%, FIFO-расчёт капитал-гейн, НКД на buy/sell. |
| `state.ts` | `TradingModuleState`: `pendingOrders`, `lastExecution`, `lastRejection`. |
| `tax/taxCalculator.ts` | Базовый расчёт НДФЛ 13%. |
| `tax/capitalGainHandler.ts` | FIFO `calcCapitalGainFifo` — реализованная прибыль и стоимость потреблённых лотов. |
| `tax/corporateActionHandler.ts` | `TaxSubservice` — слушает `MARKET_*_DECLARED`, начисляет дивиденды/купоны/погашения, удерживает НДФЛ, диспатчит `portfolio/credit-cash` / `append-ledger` / `clear-lot-nkd-at-buy` / `close-position`, эмитит слой B (`DIVIDEND_PAID`, `COUPON_PAID`, `BOND_REDEEMED`, `CAPITAL_GAIN_TAX_WITHHELD`). |

#### PortfolioModule (`portfolio/`) — состояние портфеля
| Файл | Содержит |
|---|---|
| `service.ts` | `PortfolioModuleService` — пассивный модуль, меняется только командами: применение сделок, credit/debit-cash, append-ledger, close-position, clear-lot-nkd-at-buy, record-nav-snapshot. Считает NAV-snapshot на смену торгового дня. |
| `state.ts` | Перевыставляет `PortfolioState` из `domain/portfolio.ts`. |
| `selectors.ts` | Производные: `positionTotalQuantity`, `positionAvgPriceRub`, `computePortfolioNavRub`, `selectPortfolioProfitForPeriod` (1н/1м/1г/all), `selectUpcomingPayments` (62-дневный горизонт). |

#### Модули-плейсхолдеры (контракты есть, реализация stub)
| Папка | Статус |
|---|---|
| `education/` | `ready: false` — каркас |
| `achievements/` | `ready: false` — каркас |
| `notifications/` | `ready: false` — каркас |
| `persistence/` | `ready: false` — каркас |
| `settings/` | `ready: false` — каркас |
| `uiState/` | `ready: false` — каркас |

Эти модули созданы, чтобы зафиксировать архитектурные слоты и не размазывать
будущую логику по UI. Сейчас они не подключены к update-циклу `LogicManager`.

---

## 3. Слой представления (`src/`)

### 3.1. Next.js страницы (`src/app/`)

| Файл | Что рендерит |
|---|---|
| `app/layout.tsx` | Корневой layout, шрифты, провайдер `GameStateContext`. |
| `app/(game)/layout.tsx` | Игровой layout: `AppHeader` сверху + страницы. |
| `app/(game)/page.tsx` | Главная: `PortfolioScreen` слева + `MarketAssetRightPanel` справа. |
| `app/(game)/learn/page.tsx` | Вкладка «Обучение» — заглушка. |
| `app/(game)/achievements/page.tsx` | Вкладка «Достижения» — заглушка. |
| `app/(game)/settings/page.tsx` | Вкладка «Меню» (вместо «Настройки») — заглушка. |

### 3.2. Хуки (`src/hooks/`)

| Файл | Что делает |
|---|---|
| `useGameState.ts` | Подписка React-компонента на селектор от `GameState` через `LogicManager.subscribeToState(...)`. UI rerender — только когда selected-часть реально поменялась. |

### 3.3. Компоненты (`src/components/`)

| Файл | Что рендерит |
|---|---|
| `game/AppHeader.tsx` | Хедер: лого, время+пауза+скорость, баланс, макро-чипы, навигация. |
| `game/GameWorkspace.tsx` | Двухколоночный лейаут (`left` + `right`). |
| `game/RightPanelPlaceholder.tsx` | Заглушка правой панели для незаконченных вкладок. |
| `market/MarketAssetRightPanel.tsx` | Карточка инструмента: график + переключатель таймфреймов + «ваша позиция» + кнопки buy/sell + лента доступных активов. |
| `market/MarketCloseLineChart.tsx` | SVG-график close-линии. |
| `portfolio/PortfolioScreen.tsx` | Корень портфельной вкладки, поднимает данные для дочерних. |
| `portfolio/PortfolioSummaryBar.tsx` | Баланс / NAV / прибыль за период (1н/1м/1г/all). |
| `portfolio/PortfolioCompositionTab.tsx` | Состав + ближайшие выплаты. |
| `portfolio/PortfolioPlaceholderTab.tsx` | Заглушка для будущих вкладок (график/статистика). |
| `portfolio/AssetCategorySection.tsx` | Группа активов (Акции/Облигации/Фонды) с раскрытием. |
| `portfolio/PositionRow.tsx` | Строка одной позиции. |
| `portfolio/UpcomingPayments.tsx` | Список ближайших дивидендов/купонов (62 дня). |
| `portfolio/TradeHistoryTab.tsx` | Финансовый журнал — все `LedgerEntry` с фильтром. |
| `portfolio/formatRub.ts` | Формат «₽» по `ru-RU`. |

> `src/presentation/*` — это исторический каркас под более крупный UI (контекст, валидаторы, handler-ы). Сейчас активно используется только `src/hooks/` и `src/components/`.

---

## 4. Слой данных (`src/data/`)

| Файл/папка | Назначение |
|---|---|
| `data/simulationTimeConfig.ts` | Сколько симуляционных мс приходится на реальную секунду (1 сек ≈ 1 минута биржи при 1x). |
| `data/tickerSessionBounds.ts` | Границы первой и последней сессии каждого тикера (для UI «когда впервые торгуется»). |
| `data/domain/TradingDaySession.ts` | Модель торгового дня (start/end MSK, тикеры со свечами). |
| `data/portfolio/buildDemoPortfolio.ts` | Демо-портфель: SBER (10×200₽), SU26227RMFS7 (2×900₽), SBMM (10×13₽) + кэш. |
| `data/portfolio/demoPortfolioConstants.ts` | Константы — стартовый кэш, базовый депозит для расчётов прибыли. |
| `data/services/tradingDaySessionMerge.ts` | Утилита слияния сессий разных тикеров. |
| `data/generated/marketInstrumentCatalog.json` | Каталог тикеров (генерируется `gen:market-catalog`). |
| `data/generated/marketInstrumentDetailsCatalog.json` | Метаданные (генерируется `gen:instrument-details`). |
| `data/generated/tradingCalendar.json` | Календарь торговых сессий (генерируется `gen:calendar`). |

---

## 5. Pipeline данных (`scripts/`, `data/`, `electron/`)

```
downloadStockData/                  ← локальный пакет: качает с MOEX ISS API
  output/candles/<SECID>.txt        ← минутные свечи в формате Finam
  output/meta/<SECID>.instrument.txt
  output/meta/<SECID>_dividens.txt
  output/meta/<SECID>.coupon-schedule.txt
  output/meta/<SECID>.cashflows-other.txt

       ↓  (пользователь руками переносит файлы свечей в соответствующую папку рынка)

tickers/<TICKER>.txt    индексы → indexes/
bonds/<SECID>.txt       фонды   → fonds/

       ↓  npm run gen:market-catalog
       ↓  npm run gen:instrument-details
       ↓  npm run gen:calendar

src/data/generated/marketInstrumentCatalog.json
src/data/generated/marketInstrumentDetailsCatalog.json
src/data/generated/tradingCalendar.json

       ↓  npm run build:market-db
       ↓  (читает tradingCalendar.json + .txt из tickers/bonds/fonds/indexes)

data/market.sqlite           ← минутные ряды OHLCV всех тикеров
data/tradingCalendar.json    ← копия из src/data/generated/

       ↓  electron:dev / electron:build

electron/main.js + market-db-slice.cjs:
  - открывает data/market.sqlite через better-sqlite3 (main process)
  - IPC market:get-slices / prefetch-day / prefetch-next-day

       ↓  IPC

src/logic/modules/market/marketElectronBridge.ts
  → MarketModuleService гидратирует ряды по мере движения времени
  → merge + trimChartSeriesBundleForStorage (intraday не копятся бесконечно в памяти)
  → quoteApply / chartWindows строят UI-окно из урезанного хранилища
```

### 5.1. Скрипты

| Скрипт | Что делает |
|---|---|
| `scripts/generate-market-instrument-catalog.ts` | Сканирует `tickers/`, `bonds/`, `indexes/`, `fonds/` → `marketInstrumentCatalog.json`. |
| `scripts/build-instrument-details-catalog.ts` | Парсит `downloadStockData/output/meta/*` → `marketInstrumentDetailsCatalog.json` (lot, дивиденды, купоны, погашения). |
| `scripts/build-trading-calendar.ts` | Из ряда `.txt` строит JSON календаря сессий. |
| `scripts/build-market-sqlite.ts` | Импортирует все `.txt` в `data/market.sqlite`. Использует `better-sqlite3`. |

### 5.2. Electron (`electron/`)

| Файл | Назначение |
|---|---|
| `main.js` | Main-процесс: окно, IPC-хендлеры `market:*`. |
| `market-db-slice.cjs` | SQL-выборки по символам и эпохам, возвращает «срезы» минутных рядов. |
| `preload.js` | Безопасный мост `window.marketData` → IPC. |

### 5.3. Загрузчик MOEX ISS (`downloadStockData/`)

Отдельный npm-пакет (см. свой `package.json`).

| Файл | Назначение |
|---|---|
| `src/cli.ts` / `src/downloadAssets.ts` | CLI: `--kind=bond|stock|fund`, `--smoke`, `--incremental`. |
| `src/tickers.config.ts` | Списки `BOND_IDS`, `STOCK_IDS`, `FUND_IDS` для скачивания. |
| `src/moexIssClient.ts`, `src/moexIssTypes.ts` | Клиент MOEX ISS API. |
| `src/finamWriter.ts`, `src/finamFormatValidator.ts` | Запись/валидация Finam-формата `.txt`. |
| `src/metaWriters.ts` | Запись метаданных (`.instrument.txt`, `_dividens.txt`, `.coupon-schedule.txt`, `.cashflows-other.txt`). |
| `src/candleResume.ts` | Инкрементальная докачка (резюме с последней даты). |
| `__tests__/*.test.ts` | Юнит-тесты загрузчика. |

---

## 6. Тесты (`tests/console/`)

Тесты — обычные `.ts`-скрипты с собственным runner-ом (`runner.ts`). Запуск — `npx tsx <file>` или через npm-скрипты `test:m1`/`test:m2`/`test:m3`/`test:m4`/`test:all`.

| Файл | Что покрывает |
|---|---|
| `runner.ts` | Общий формат вывода (`✅ ПРОЙДЕН` / `❌ НЕ ПРОЙДЕН`) и `exitCode`. |
| `m1.test.ts` | TimeModule, LogicManager — основной цикл и timeScale. |
| `m2.test.ts` | Демо-портфель, селекторы (NAV, прибыль за период, upcoming-payments). |
| `m3-catalog-selectors.test.ts` | Сортировка каталога инструментов. |
| `m3-market-quote-clip.test.ts` | Обрезка котировок по `simulationEpochMs`. |
| `m3-minute-bar-aggregation.test.ts` | Агрегация минутных баров в старшие таймфреймы. |
| `m3-market-runtime-contract.test.ts` | Каталог рынка стабилен на тиках. |
| `m3-chart-windows.test.ts` | Forward-fill и сетка слотов торгового времени. |
| `m3-dividend-eligibility.test.ts` | Cut-off для участия в реестре дивидендов (T+0/T+2/T+1). |
| `m4-trading-and-ui-contract.test.ts` | Buy/sell, отказы, псевдостакан. |
| `m4-extended.test.ts` | НКД, лотность, комиссии, дивиденды, купоны, погашение, FIFO-capital-gain, журнал. |
| `arch-invariants.test.ts` | Архитектурные инварианты (определённость TimeModule, EventBus, размер демо-портфеля). |
| `stub-milestone.ts` | Универсальный stub для нереализованных вех `test:m5..test:m10`. |

---

## 7. Папки-источники активов в корне проекта

| Папка | Что лежит | Видимость в симуляции |
|---|---|---|
| `tickers/` | Акции (`SBER.txt`). | Видны в каталоге, торгуются. |
| `bonds/` | Облигации (`SU26227RMFS7.txt`). | Видны и торгуются; lot/дивиденды/купоны — из details-каталога. |
| `fonds/` | Фонды (`SBMM.txt`). | Видны и торгуются. |
| `indexes/` | Индексы (`RTSI.txt`, `RGBI.txt`). | Видны, **не торгуются** (`TradeRejectReason: NON_TRADABLE_INSTRUMENT`). |

Файл `.txt` — это Finam-формат минутных свечей (заголовок + строки `<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>`).
