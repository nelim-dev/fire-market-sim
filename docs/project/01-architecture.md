# Архитектура проекта FIRE Market Sim

Этот документ описывает фактическое устройство кодовой базы.
Цель — быстро ориентироваться в коде, не открывая каждый файл.

---

## 1. Слои и их ответственность

Проект построен по трёхслойной схеме:

| Слой | Где | Что делает |
|---|---|---|
| **Presentation** | `src/app/*`, `src/components/*`, `src/hooks/*` | React/Next.js страницы, компоненты, селекторы UI |
| **Logic** | `src/logic/*` | Игровой цикл, оркестратор, модули предметной области, EventBus |
| **Data** | `src/data/*`, `scripts/*`, `electron/*`, `resources/ml/*` | Сборка БД, JSON-каталоги, IPC к Electron, ML-воркер |

Архитектурные правила: модули общаются только через **типизированные события** и
**команды**; UI пассивен; бизнес-логика никогда не живёт в компонентах.

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
| `eurRubSeriesDisplay.ts` | Отображение серий EUR/RUB (форматирование, округление). |

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
| `finamMinuteBars.ts` | Парсинг Finam-формата минутных свечей. |
| `instrumentDetails.ts` | Загрузка `marketInstrumentDetailsCatalog.json` (lot, мета, дивиденды, купоны, погашения). |
| `instrumentLifecycle.ts` | Жизненный цикл инструмента: доступность по дате, исключения (INFL, KS). |
| `instrumentCopy.ts` | Копирование/переопределение метаданных инструментов (`instrumentCopyOverrides.ts`). |
| `catalogSort.ts`, `selectors.ts` | Сортировка по виду + тикеру, селекторы (по символу, по виду, секциями). |
| `priceSeries.ts` | Типы `MarketPriceBar` (OHLCV), `lastBarIndexAtOrBefore`, `sliceTailAtOrBeforeEpoch` (хвост ряда до epoch без копии всего префикса). |
| `minuteBarAggregation.ts` | Агрегация минутных баров в 5m/30m/1h/1d/1w. |
| `chartTimeframes.ts` | ID таймфреймов и константы числа слотов (1d=530, 1w=530, 1m=380, 6m=1125, 1y=250). |
| `chartWindows.ts` | Сборка окна графика по таймфрейму + forward-fill для редких серий. |
| `chartBundleLimits.ts` | Lookback при **импорте** в SQLite (`CHART_BUNDLE_PRE_SESSION_MS` ≈ 370 дней до первой сессии). |
| `chartSeriesRetention.ts` | **Runtime:** после hydrate обрезает `chartSeries` intraday-ряды до объёма, достаточного для окон графика; daily/weekly без count-cap (вкладка `all`). |
| `quoteApply.ts` | Применение котировок на текущий `simulationEpochMs` (цена, daily-change, окно графика, НКД для бондов). |
| `marketElectronBridge.ts` | Клиент IPC к Electron main (`market:get-slices`, `prefetch-day`, `prefetch-next-day`). |
| `pseudoOrderBook.ts` | Псевдостакан: генерация уровней bid/ask вокруг текущей цены. |
| `orderBookConsume.ts` | Потребление ликвидности стакана при исполнении ордеров. |
| `compositeIndex.ts` | Составной индекс FIREIDX (агрегация по корзине инструментов). |
| `fireidxSeries.ts`, `fireidxPrebaked.ts`, `fireidxOfflineReplay.ts`, `fireidxComparison.ts` | Серия FIREIDX: генерация, офлайн-реплей, сравнение с реальными данными. |
| `inflationSchedule.ts`, `inflationScheduleParse.ts`, `inflationIndexSeries.ts` | Инфляция: расписание MoM из `assets/инфляция.txt`, индекс INFL, rolling 12m. |
| `moneyMarketNav.ts`, `moneyMarketRateSchedule.ts` | Фонд денежного рынка DN-R: NAV и расписание ставок. |
| `macro.ts` | Контракт `MarketMacroSnapshot` (Brent, USD/RUB, ключевая ставка, инфляция). |
| `macroSymbols.ts` | Символы макро-рядов: `BR`, `USD000UTSTOM`; stem `KS` исключён из каталога. |
| `macroResolve.ts` | Резолв макро по `simulationEpochMs` (close минутных баров + step-function KS). |
| `keyRateSchedule.ts` | Парсинг/загрузка расписания ставки ЦБ из `keyRateSchedule.json`. |
| `catalogExclusions.ts` | Исключение `KS.txt` из сканера каталога. |
| `corporateActions/state.ts` | `CorporateActionsState` с set уже эмитированных платежей (dedup). |
| `corporateActions/scheduleScanner.ts` | Сканер расписания в окне `(prev, current]` → `ScannedDeclaration[]` (dividend/coupon/maturity). |
| `corporateActions/dividendEligibility.ts` | Правило biz-cut-off для дивидендов: T+0/T+2/T+1 по эре подобно Мосбиржи. |
| `corporateActions/emitter.ts` | Эмит типизированных событий `MARKET_DIVIDEND_DECLARED` / `MARKET_COUPON_DECLARED` / `MARKET_BOND_MATURED`. |

#### TradingModule (`trading/`) — брокер: ордера, комиссии, налоги
| Файл | Содержит |
|---|---|
| `service.ts` | `TradingModuleService` — валидация и исполнение market/limit-ордеров, комиссия 0.1%, FIFO-расчёт капитал-гейн, НКД на buy/sell. |
| `orderBookMatch.ts` | Матчинг лимитных ордеров против псевдостакана (частичное исполнение). |
| `state.ts` | `TradingModuleState`: `pendingOrders`, `lastExecution`, `lastRejection`. |
| `tax/taxCalculator.ts` | Базовый расчёт НДФЛ 13%. |
| `tax/capitalGainHandler.ts` | FIFO `calcCapitalGainFifo` — реализованная прибыль и стоимость потреблённых лотов. |
| `tax/corporateActionHandler.ts` | `TaxSubservice` — слушает `MARKET_*_DECLARED`, начисляет дивиденды/купоны/погашения, удерживает НДФЛ, диспатчит `portfolio/credit-cash` / `append-ledger` / `clear-lot-nkd-at-buy` / `close-position`, эмитит слой B. |

#### PortfolioModule (`portfolio/`) — состояние портфеля
| Файл | Содержит |
|---|---|
| `service.ts` | `PortfolioModuleService` — пассивный модуль, меняется только командами: применение сделок, credit/debit-cash, append-ledger, close-position, clear-lot-nkd-at-buy, record-nav-snapshot. Считает NAV-snapshot на смену торгового дня. |
| `state.ts` | Перевыставляет `PortfolioState` из `domain/portfolio.ts`. |
| `selectors.ts` | Производные: `positionTotalQuantity`, `positionAvgPriceRub`, `computePortfolioNavRub`, `selectPortfolioProfitForPeriod` (1н/1м/1г/all), `selectUpcomingPayments` (62-дневный горизонт). |
| `statsSelectors.ts` | Статистика портфеля: волатильность, коэффициент Шарпа, альфа vs FIREIDX, сравнение с инфляцией. |

#### EducationModule (`education/`) — обучение
| Файл | Содержит |
|---|---|
| `service.ts` | `EducationModuleService` — навигация по лекциям/тестам, проверка ответов, `passedTestIds` (единственный источник unlock), планировщик контекстных подсказок. |
| `state.ts` | `EducationModuleState` (browseMode, selectedLesson/Test, hintQueue, lastTestResult). |
| `commands.ts`, `events.ts` | Команды `education/*` и события `EDUCATION_TEST_SUBMITTED` / `EDUCATION_TEST_PASSED`. |
| `selectors.ts` | `selectEducationIsSymbolUnlocked`, `selectEducationMissingTestsForSymbol` и др. |
| `unlockResolver.ts` | Правила доступа к инструментам (`INSTRUMENT_UNLOCK_RULES`), `resolveBondTier`, `shuffleWithSeed`. |
| `hintSchedule.ts` | Тайминги авто-подсказок (3–6 минут, задержка показа на графике). |

#### PersistenceModule (`persistence/`) — сохранение прогресса
| Файл | Содержит |
|---|---|
| `service.ts` | `PersistenceModuleService` — слоты сохранения: save/load/delete, валидация снапшотов. |
| `snapshot.ts` | `PersistedGameSnapshot`, `validateSnapshot`, `buildSaveSlotMeta`. |
| `storage.ts` | Адаптер хранилища (по умолчанию — IPC к Electron `persistence:*`). |
| `host.ts` | Хост-интерфейс для интеграции с Electron main. |
| `commands.ts`, `events.ts`, `selectors.ts` | Команды `persistence/*`, события `PERSISTENCE_*`, селекторы слотов. |

#### SettingsModule (`settings/`) — настройки
| Файл | Содержит |
|---|---|
| `service.ts` | `SettingsModuleService` — звук, музыка, громкость, полноэкранный режим. |
| `state.ts` | `SettingsModuleState` + `WindowDisplayMode`. |
| `displayHost.ts` | Хост для управления окном (Electron `window:*` IPC). |
| `commands.ts`, `selectors.ts` | Команды `settings/*` и селекторы. |

#### UiStateModule (`uiState/`) — состояние UI
| Файл | Содержит |
|---|---|
| `service.ts` | `UiStateModuleService` — навигация: leftPanelMode, portfolioMainTab, selectedSymbol, фильтры обзора рынка. |
| `state.ts` | `UiStateModuleState` + `DEFAULT_MARKET_OVERVIEW_FILTERS`. |
| `commands.ts`, `selectors.ts` | Команды `uiState/*` и селекторы. |

#### AnalyticsModule (`analytics/`) — ML-аналитика
| Файл | Содержит |
|---|---|
| `service.ts` | `AnalyticsModuleService` — сборка тензора дня, вызов predict через Electron, хранение предсказаний. |
| `modelDayTensor.ts` | Построение входного тензора модели из минутных баров дня. |
| `predictionToBars.ts` | Конвертация предсказания модели в 5-минутные бары. |
| `parityCheck.ts` | Parity-проверка: сравнение предсказания с реальным следующим днём. |
| `predictionDayStats.ts` | Статистика по предсказанному дню. |
| `crossDayLastKnown.ts` | Перенос «последнего известного» состояния между днями. |
| `ohlcFormatNormalize.ts` | Нормализация формата OHLC между источниками. |
| `displayPrice.ts` | Форматирование цен предсказания для UI. |
| `modelConstants.ts` | Константы модели (тикеры, комиссия за предсказание). |
| `analyticsElectronBridge.ts` | Клиент IPC к ML-воркеру (`analytics:*`). |
| `selectors.ts`, `commands.ts`, `state.ts` | Селекторы, команды `analytics/*`, состояние. |

#### AudioModule (`audio/`) — звук
| Файл | Содержит |
|---|---|
| `contracts.ts` | Контракты звукового движка. |
| `noopEngine.ts` | Заглушка движка (для тестов/не-Electron). |

#### Модули-плейсхолдеры (контракты есть, реализация stub)
| Папка | Статус |
|---|---|
| `achievements/` | `ready: false` — каркас |
| `notifications/` | `ready: false` — каркас |

---

## 3. Слой представления (`src/`)

### 3.1. Next.js страницы (`src/app/`)

| Файл | Что рендерит |
|---|---|
| `app/layout.tsx` | Корневой layout, шрифты, провайдер `GameStateContext`. |
| `app/(game)/layout.tsx` | Игровой layout: `AppHeader` + провайдеры (Audio, Settings, Menu), старт `gameLoop`, гидратация рынка. |
| `app/(game)/page.tsx` | Главная: `LeftTradingPanel` слева + `TradingRightPanel` справа. |
| `app/(game)/learn/page.tsx` | Вкладка «Обучение»: `EducationLeftPanel` + `EducationRightPanel` (лекции, тесты, подсказки). |
| `app/(game)/achievements/page.tsx` | Вкладка «Достижения» — заглушка. |
| `app/(game)/analytics/page.tsx` | Редирект на главную с `uiState/set-left-panel-mode: analytics`. |

### 3.2. Хуки (`src/hooks/`)

| Файл | Что делает |
|---|---|
| `useGameState.ts` | Подписка React-компонента на селектор от `GameState` через `LogicManager.subscribeToState(...)`. UI rerender — только когда selected-часть реально поменялась. |

### 3.3. Компоненты (`src/components/`)

#### game/
| Файл | Что рендерит |
|---|---|
| `AppHeader.tsx` | Хедер: лого, время+пауза+скорость, баланс, макро-чипы (BR, USD/RUB, KS, инфляция), навигация (Портфель / Обучение), кнопка меню. |
| `GameWorkspace.tsx` | Двухколоночный лейаут (`left` + `right`). |
| `LeftTradingPanel.tsx` | Левая панель главной: портфель / обзор рынка / аналитика (переключение через uiState). |
| `RightPanelSection.tsx` | Секция правой панели. |
| `RightPanelPlaceholder.tsx` | Заглушка правой панели для незаконченных вкладок. |
| `GameMenu.tsx` | Меню: сохранение/загрузка, настройки, выход. |
| `GameSettings.tsx` | Настройки: звук, музыка, громкость, полноэкранный режим. |
| `GameOverlay.tsx` | Оверлей поверх игры (пауза и т.п.). |
| `overlayPause.ts` | Логика оверлея паузы. |
| `GameAudioProvider.tsx` | Провайдер звука (клики, фоновая музыка). |

#### market/
| Файл | Что рендерит |
|---|---|
| `TradingRightPanel.tsx` | Правая панель главной: карточка инструмента, график, buy/sell, стакан, лента активов. |
| `MarketAssetRightPanel.tsx` | Карточка инструмента: график + таймфреймы + «ваша позиция» + buy/sell. |
| `MarketCloseLineChart.tsx` | SVG-график close-линии. |
| `MarketOverviewPanel.tsx` | Обзор рынка: поиск, фильтры, доступность/заблокированность. |
| `LockedInstrumentPanel.tsx` | Панель «инструмент заблокирован» (нужен тест). |

#### portfolio/
| Файл | Что рендерит |
|---|---|
| `PortfolioScreen.tsx` | Корень портфельной вкладки. |
| `PortfolioSummaryBar.tsx` | Баланс / NAV / прибыль за период (1н/1м/1г/all). |
| `PortfolioCompositionTab.tsx` | Состав + ближайшие выплаты. |
| `PortfolioCompositionRightPanel.tsx` | Правая панель состава (детали позиции). |
| `PortfolioCompositionPieChart.tsx` | Круговая диаграмма распределения. |
| `PortfolioStatsTab.tsx` | Статистика портфеля (волатильность, Шарп, альфа). |
| `PortfolioPlaceholderTab.tsx` | Заглушка для будущих вкладок. |
| `AssetCategorySection.tsx` | Группа активов (Акции/Облигации/Фонды) с раскрытием. |
| `PositionRow.tsx` | Строка одной позиции. |
| `UpcomingPayments.tsx` | Список ближайших дивидендов/купонов (31 день). |
| `TradeHistoryTab.tsx` | Финансовый журнал — все `LedgerEntry` с фильтром. |
| `OpenOrdersTab.tsx` | Открытые лимитные ордера. |
| `formatRub.ts` | Формат «₽» по `ru-RU`. |

#### education/
| Файл | Что рендерит |
|---|---|
| `EducationLeftPanel.tsx` | Список лекций/тестов. |
| `EducationRightPanel.tsx` | Контент лекции/теста. |
| `LessonViewer.tsx` | Просмотр лекции (главы, блоки). |
| `TestViewer.tsx` | Прохождение теста (вопросы, результат). |
| `ChartHintToast.tsx` | Всплывающая подсказка на графике. |

#### analytics/
| Файл | Что рендерит |
|---|---|
| `AnalyticsLeftPanel.tsx` | Выбор актива и запуск предсказания. |
| `AnalyticsRightPanel.tsx` | Результат предсказания (график, статистика). |

### 3.4. Аудио (`src/audio/`)

| Файл | Что делает |
|---|---|
| `soundCatalog.ts` | Каталог звуков: `ui.click` → `/audio/click_004.ogg`, фоновая музыка → `/audio/background-music.mp3`. |
| `browserAudioEngine.ts` | Реализация движка на Web Audio API. |
| `backgroundMusic.ts` | Управление фоновой музыкой. |

---

## 4. Слой данных (`src/data/`)

| Файл/папка | Назначение |
|---|---|
| `data/simulationTimeConfig.ts` | Сколько симуляционных мс приходится на реальную секунду (1 сек ≈ 1 минута биржи при 1x). |
| `data/tickerSessionBounds.ts` | Границы первой и последней сессии каждого тикера (для UI «когда впервые торгуется»). |
| `data/instrumentCopyOverrides.ts` | Переопределения метаданных инструментов (для копий/синтетики). |
| `data/domain/TradingDaySession.ts` | Модель торгового дня (start/end MSK, тикеры со свечами). |
| `data/portfolio/buildDemoPortfolio.ts` | Демо-портфель: SU26227RMFS7, SBMM + кэш. |
| `data/portfolio/demoPortfolioConstants.ts` | Константы — стартовый кэш, базовый депозит. |
| `data/services/tradingDaySessionMerge.ts` | Утилита слияния сессий разных тикеров. |
| `data/education/*` | Контент обучения: каталог лекций/тестов, тексты, правила unlock. |
| `data/generated/marketInstrumentCatalog.json` | Каталог тикеров (генерируется `gen:market-catalog`). |
| `data/generated/marketInstrumentDetailsCatalog.json` | Метаданные (генерируется `gen:instrument-details`). |
| `data/generated/tradingCalendar.json` | Календарь торговых сессий (генерируется `gen:calendar`). |
| `data/generated/inflationSchedule.json` | Расписание инфляции MoM (генерируется `gen:inflation-schedule`). |
| `data/generated/keyRateSchedule.json` | Расписание ключевой ставки ЦБ (пишется `build:market-db`). |

---

## 5. Pipeline данных (`scripts/`, `data/`, `electron/`)

```
tickers/<TICKER>.txt   bonds/<SECID>.txt   fonds/<SECID>.txt   indexes/<SECID>.txt
(локальные .txt-свечи в Finam-формате; не входят в git)

       ↓  npm run gen:market-catalog
       ↓  npm run gen:instrument-details   (читает локальные метаданные)
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
| `scripts/build-instrument-details-catalog.ts` | Парсит локальные метаданные → `marketInstrumentDetailsCatalog.json` (lot, дивиденды, купоны, погашения). |
| `scripts/build-trading-calendar.ts` | Из ряда `.txt` строит JSON календаря сессий. |
| `scripts/build-market-sqlite.ts` | Импортирует все `.txt` в `data/market.sqlite` + пишет `keyRateSchedule.json`. |
| `scripts/build-inflation-schedule.ts` | Парсит `assets/инфляция.txt` → `inflationSchedule.json`. |
| `scripts/generate-inflation-index-data.ts` | Генерирует `indexes/INFL.txt` из расписания инфляции. |
| `scripts/build-fireidx-candles.ts` | Генерирует свечи составного индекса FIREIDX. |
| `scripts/generate-dn-r-candles.ts` | Генерирует свечи фонда денежного рынка DN-R. |
| `scripts/import-market-symbols.ts` | Точечный импорт отдельных символов в SQLite (без полной пересборки). |
| `scripts/setup-embedded-python.ts` | Устанавливает embedded Python + TensorFlow в `resources/ml/python-runtime/`. |
| `scripts/marketSqliteImport.ts` | Внутренний модуль импорта (используется build-market-sqlite). |
| `scripts/*.py` | Вспомогательные Python-скрипты для сравнения/инспекции данных (benchmark, diff, inspect). |

### 5.2. Electron (`electron/`)

| Файл | Назначение |
|---|---|
| `main.js` | Main-процесс: окно, IPC-хендлеры `market:*`, `persistence:*`, `analytics:*`, `window:*`. |
| `market-db-slice.cjs` | SQL-выборки по символам и эпохам, возвращает «срезы» минутных рядов. |
| `ml-bridge.cjs` | Мост к Python ML-воркеру: spawn `predict_worker.py`, JSON-RPC по stdin/stdout. |
| `preload.js` | Безопасный мост `window.marketData` / `window.persistence` / `window.analytics` → IPC. |

### 5.3. ML-часть (`resources/ml/`)

| Файл | Назначение |
|---|---|
| `python/predict_worker.py` | Python-воркер: загрузка модели, предсказание следующего дня. |
| `python/analytics_cond_parity.py` | Parity-проверка модели на данных приложения. |
| `python/build_reference_day_tensor.py` | Построение эталонного тензора дня. |
| `python/requirements.txt` | Зависимости: `tensorflow==2.16.1`, `numpy`, `joblib`. |
| `src/vae/conditional_timevae.py`, `conditional_vae_base.py` | Код модели TimeVAE. |
| `src/data_utils.py` | Утилиты данных для модели. |
| `model/` | **Веса модели (`.h5`, `.pkl`) — локально, не в git.** |

---

## 6. Тесты

### 6.1. Консольные тесты (`tests/console/`)

Тесты — обычные `.ts`-скрипты с собственным runner-ом (`runner.ts`). Запуск — `npx tsx <file>` или через npm-скрипты `test:m1`…`test:m10`, `test:a1`, `test:a2`, `test:all`.

| Файл | Что покрывает |
|---|---|
| `runner.ts` | Общий формат вывода (`✅ ПРОЙДЕН` / `❌ НЕ ПРОЙДЕН`) и `exitCode`. |
| `m1.test.ts` | TimeModule, LogicManager — основной цикл и timeScale. |
| `m2.test.ts`, `m2-portfolio-stats.test.ts` | Демо-портфель, селекторы (NAV, прибыль за период, upcoming-payments). |
| `m3-*.test.ts` | Рынок: каталог, котировки, графики, retention, агрегации, дивиденды, макро, lifecycle, DN-R. |
| `m4-*.test.ts` | Трейдинг: ордера, НКД, FIFO, налоги, журнал, псевдостакан, лимитные ордера, составной индекс. |
| `m5-market-overview-ui.test.ts` | Обзор рынка (UI-контракт). |
| `m7-persistence-and-menu.test.ts` | Сохранение прогресса и меню. |
| `a1-model-day-tensor.test.ts`, `a1-ml-predict-smoke.test.ts` | ML: тензор дня, smoke predict. |
| `a2-analytics-cond-parity.test.ts` | Parity cond_vae на интегрированном пайплайне. |
| `arch-invariants.test.ts` | Архитектурные инварианты. |
| `stub-milestone.ts` | Универсальный stub для нереализованных вех `test:m6`, `test:m8..m10`. |

### 6.2. Unit-тесты (`src/logic/modules/*/__tests__/`)

Запускаются через `node:test` (`npx tsx --test`), включены в `test:m3`/`test:a1`:

- `market/__tests__/` — macroResolve, inflationSchedule, inflationIndexSeries, fireidxComparison, instrumentCopy, moneyMarketRateSchedule, moneyMarketNav, eurRubSeriesDisplay.
- `portfolio/__tests__/` — statsSelectors.
- `analytics/__tests__/` — modelDayTensor, analyticsModule, ohlcFormatNormalize, parityCheck, predictionDayStats.
- `education/__tests__/` — education (unlockResolver, service).

---

## 7. Папки-источники активов (локальные, не в git)

| Папка | Что лежит | Видимость в симуляции |
|---|---|---|
| `tickers/` | Акции (`SBER.txt`). | Видны в каталоге, торгуются. |
| `bonds/` | Облигации (`SU26227RMFS7.txt`). | Видны и торгуются; lot/дивиденды/купоны — из details-каталога. |
| `fonds/` | Фонды (`SBMM.txt`). | Видны и торгуются. |
| `indexes/` | Индексы (`RTSI.txt`, `RGBI.txt`, `BR.txt`, `INFL.txt`, `KS.txt`). | Видны, **не торгуются** (`TradeRejectReason: NON_TRADABLE_INSTRUMENT`). |

Файл `.txt` — это Finam-формат минутных свечей (заголовок + строки `<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>`).
