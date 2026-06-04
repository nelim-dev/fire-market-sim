import marketInstrumentCatalogJson from '@/data/generated/marketInstrumentCatalog.json';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
} from '@/logic/modules/contracts';
import type { TradingDayChangedPayload } from '@/logic/logicEvents';
import type { GameState } from '@/logic/managers/LogicManager';
import type { TradingCalendar } from '@/logic/time/TradingCalendar';
import { DEBUG_DISABLE_FIREIDX } from '@/logic/simulation/simulationConfig';
import { isFireidxPrebakedInCatalog } from './fireidxPrebaked';
import type { MarketInstrumentCatalogItem } from './contracts';
import { emptyChartSeriesBundle, type MarketChartSeriesBundle } from './chartWindows';
import {
  fetchDaySlicesFromElectron,
  fetchMarketSlicesFromElectron,
} from './marketElectronBridge';
import type { MarketPriceBar } from './priceSeries';
import {
  applyMarketQuotesForSimulationEpoch,
  refreshQuotesForSymbol,
} from './quoteApply';
import {
  FIREIDX_SYMBOL,
  stockSymbolsFromCatalog,
  syncFireidxAsset,
  updateCompositeIndex,
} from './compositeIndex';
import {
  advanceFireidxBatchUpToEpoch,
  applyFireidxBundlesToChartSeries,
  applyFireidxLongSeriesToChartSeries,
  needsFireidxLongSeriesBootstrap,
  rebuildFireidxLongSeriesFromConstituents,
  rebuildFireidxSeriesFromConstituents,
  shouldFullRebuildFireidx,
} from './fireidxSeries';
import { trimChartSeriesBundleForStorage } from './chartSeriesRetention';
import {
  applyChartSeriesBundleToMarket,
  createMarketModuleState,
  type MarketModuleState,
} from './state';
import {
  createCorporateActionsState,
  type CorporateActionsState,
} from './corporateActions/state';
import { scanScheduleWindow } from './corporateActions/scheduleScanner';
import { emitDeclarations } from './corporateActions/emitter';
import { applyOrderBookConsumption } from './orderBookConsume';

type CatalogFileShape = { items: MarketInstrumentCatalogItem[] };
type DayLoadState = 'idle' | 'preloadingCurrent' | 'readyCurrent' | 'rollingNext';

function readCatalogItems(): MarketInstrumentCatalogItem[] {
  const raw = marketInstrumentCatalogJson as CatalogFileShape;
  return Array.isArray(raw.items) ? raw.items : [];
}

export function pickHydrateSymbolsFromCatalog(
  catalog: readonly MarketInstrumentCatalogItem[]
): string[] {
  const fireidxPrebaked = isFireidxPrebakedInCatalog(catalog);
  return catalog
    .filter((item) => {
      const symbol = item.symbol.toUpperCase();
      if (symbol === FIREIDX_SYMBOL) {
        return fireidxPrebaked;
      }
      if (item.assetKind === 'index') {
        // BR/EU/RTSI/USD... нужны для динамики обзора и шапки.
        return item.sourceFilePath.length > 0;
      }
      return (
        item.assetKind === 'stock' ||
        item.assetKind === 'bond' ||
        (item.assetKind === 'fund' && item.sourceFilePath.length > 0)
      );
    })
    .map((item) => item.symbol.toUpperCase())
    .filter((symbol, index, arr) => arr.indexOf(symbol) === index);
}

export class MarketModuleService implements LogicModule<GameState> {
  private static fireidxDisableLogged = false;
  readonly id = 'market';

  /**
   * Торговый календарь для построения окна графика в торговом времени
   * (`buildChartLineByTimeframeFromBundle`). Опционально: при отсутствии
   * chart-провайдер делает безопасный fallback на «последние N баров».
   */
  constructor(private readonly tradingCalendar: TradingCalendar | null = null) {}

  /** Сабсервис corporateActions: сканер расписаний + дедуп processedPaymentIds. */
  private readonly corporateActions: CorporateActionsState = createCorporateActionsState();
  /** Прошлый `simulationEpochMs`, до которого мы уже сканировали корпоративные действия. */
  private lastScannedEpochMs: number | null = null;
  private lastQuotedSimulationEpochMs: number | null = null;
  private marketHydrateInFlight = false;
  private lastHydratedEpochMs: number | null = null;
  private pendingHydrateEpochMs: number | null = null;
  private hydrateProbe = {
    requested: 0,
    started: 0,
    coalesced: 0,
    applied: 0,
    skippedInFlight: 0,
    totalMs: 0,
    maxMs: 0,
    lastReportAtMs: 0,
  };
  private prefetchedDays = new Set<string>();
  /** Дни, для которых минутные ряды уже целиком загружены в renderer-state. */
  private rendererPreloadedDays = new Set<string>();
  private dayLoadState: DayLoadState = 'idle';
  private activeDayKey: string | null = null;
  private nextDayKey: string | null = null;
  private bufferReady = false;
  private nextDayPreloadInFlight = false;
  /** Стадированные day-bundles (обычно current/next), ещё не влиты в chartSeries. */
  private stagedDayBundles = new Map<string, MarketChartSeriesBundle>();
  private dayBufferProbe = {
    dayPreloads: 0,
    ramBufferSkips: 0,
    minuteFallbacks: 0,
    lastReportAtMs: 0,
  };
  private waitingDayForBoundary: string | null = null;
  /**
   * Промежуточный callback: вызывается после фазы 1 (смерж баров) внутри
   * гидрации, до выдержки setTimeout. Позволяет LogicManager уведомить
   * подписчиков до тяжёлой фазы 2 (пересчёт котировок), не создавая обратной
   * зависимости модуля от оркестратора.
   */
  private notifyHook: (() => void) | null = null;

  setNotifyHook(fn: () => void): void {
    this.notifyHook = fn;
  }

  private perfProbe = {
    lastReportAtMs: 0,
    quotesApplyMs: 0,
    catalogQuotesMs: 0,
    fireidxChainMs: 0,
    tickCount: 0,
    selectedDailyLenMax: 0,
    fireidxFullMs: 0,
    fireidxIncrementalCount: 0,
    fireidxFullCount: 0,
    fireidxBatchMinuteCount: 0,
    fireidxPrebaked: false,
  };

  shouldHoldSimulationAtBoundary(state: GameState): boolean {
    const currentDay = state.currentTradingSession?.mskDateYyyymmdd;
    if (!currentDay) {
      return false;
    }
    return this.waitingDayForBoundary === currentDay;
  }

  private reportPerfProbeIfNeeded(): void {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
      return;
    }
    const now = Date.now();
    if (now - this.perfProbe.lastReportAtMs < 5_000) {
      return;
    }
    console.debug('[market-perf-probe]', {
      fireidxDisabled: DEBUG_DISABLE_FIREIDX && !this.perfProbe.fireidxPrebaked,
      fireidxPrebaked: this.perfProbe.fireidxPrebaked,
      quotesApplyMs: Number(this.perfProbe.quotesApplyMs.toFixed(2)),
      catalogQuotesMs: Number(this.perfProbe.catalogQuotesMs.toFixed(2)),
      fireidxChainMs: Number(this.perfProbe.fireidxChainMs.toFixed(2)),
      tickCount: this.perfProbe.tickCount,
      avgMsPerTick:
        this.perfProbe.tickCount > 0
          ? Number(
              (this.perfProbe.quotesApplyMs / this.perfProbe.tickCount).toFixed(2)
            )
          : 0,
      avgCatalogMsPerTick:
        this.perfProbe.tickCount > 0
          ? Number(
              (this.perfProbe.catalogQuotesMs / this.perfProbe.tickCount).toFixed(2)
            )
          : 0,
      avgFireidxMsPerTick:
        this.perfProbe.tickCount > 0
          ? Number(
              (this.perfProbe.fireidxChainMs / this.perfProbe.tickCount).toFixed(2)
            )
          : 0,
      selectedDailyLenMax: this.perfProbe.selectedDailyLenMax,
      fireidxFullMs: Number(this.perfProbe.fireidxFullMs.toFixed(2)),
      fireidxIncrementalCount: this.perfProbe.fireidxIncrementalCount,
      fireidxFullCount: this.perfProbe.fireidxFullCount,
      fireidxBatchMinuteCount: this.perfProbe.fireidxBatchMinuteCount,
    });
    this.perfProbe.quotesApplyMs = 0;
    this.perfProbe.catalogQuotesMs = 0;
    this.perfProbe.fireidxChainMs = 0;
    this.perfProbe.tickCount = 0;
    this.perfProbe.selectedDailyLenMax = 0;
    this.perfProbe.fireidxFullMs = 0;
    this.perfProbe.fireidxIncrementalCount = 0;
    this.perfProbe.fireidxFullCount = 0;
    this.perfProbe.fireidxBatchMinuteCount = 0;
    this.perfProbe.lastReportAtMs = now;
  }

  private applyQuotesAndCompositeIndex(
    state: MarketModuleState,
    simulationEpochMs: number,
    options?: {
      forceFullFireidx?: boolean;
      stockBarsChanged?: boolean;
      currentMskDate?: string | null;
      chartDetailSymbol?: string | null;
    }
  ): void {
    const quotesStart = performance.now();
    const chartDetail = options?.chartDetailSymbol?.toUpperCase() ?? null;
    const fullChartLineSymbols = chartDetail ? [chartDetail] : [];
    const fireidxPrebaked = isFireidxPrebakedInCatalog(state.instrumentCatalog);
    const useRuntimeFireidx = !fireidxPrebaked && !DEBUG_DISABLE_FIREIDX;
    this.perfProbe.fireidxPrebaked = fireidxPrebaked;
    const catalogStart = performance.now();
    applyMarketQuotesForSimulationEpoch(
      state,
      simulationEpochMs,
      this.tradingCalendar,
      {
        excludeSymbols: useRuntimeFireidx ? [FIREIDX_SYMBOL] : [],
        fullChartLineSymbols,
      }
    );
    this.perfProbe.catalogQuotesMs += performance.now() - catalogStart;

    if (chartDetail) {
      const dailyLen = state.chartSeries.dailyClose[chartDetail]?.length ?? 0;
      this.perfProbe.selectedDailyLenMax = Math.max(
        this.perfProbe.selectedDailyLenMax,
        dailyLen
      );
    }

    const fireidxChainStart = performance.now();
    if (DEBUG_DISABLE_FIREIDX && !fireidxPrebaked) {
      if (!MarketModuleService.fireidxDisableLogged) {
        console.warn(
          '[MarketModule] DEBUG_DISABLE_FIREIDX=true — расчёт FIREIDX отключён (simulationConfig.ts)'
        );
        MarketModuleService.fireidxDisableLogged = true;
      }
    } else if (useRuntimeFireidx) {
    const fireidxMinute = state.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
    const needsFull = shouldFullRebuildFireidx({
      forceFull: options?.forceFullFireidx,
      fireidxMinuteEmpty: fireidxMinute.length === 0,
    });

    if (needsFull) {
      const fireidxStart = performance.now();
      const rebuilt = rebuildFireidxSeriesFromConstituents({
        catalog: state.instrumentCatalog,
        chartSeries: state.chartSeries,
        details: state.details,
        simulationEpochMs,
        calendar: this.tradingCalendar,
      });
      applyFireidxBundlesToChartSeries(
        state.chartSeries,
        rebuilt,
        this.tradingCalendar
      );
      state.fireidxRuntime.lastFullRebuildEpochMs = simulationEpochMs;
      state.fireidxRuntime.lastProcessedFireidxEpochMs = simulationEpochMs;
      const baseIndex =
        rebuilt.compositeIndex.constituents.length > 0
          ? rebuilt.compositeIndex
          : state.compositeIndex;
      state.compositeIndex = updateCompositeIndex(
        baseIndex,
        state.instrumentCatalog,
        state.assetsBySymbol,
        state.details,
        simulationEpochMs,
        this.tradingCalendar
      );
      this.perfProbe.fireidxFullMs += performance.now() - fireidxStart;
      this.perfProbe.fireidxFullCount += 1;
      state.fireidxRuntime.longSeriesBootstrapped = true;
    } else {
      if (
        needsFireidxLongSeriesBootstrap(
          state.chartSeries,
          state.instrumentCatalog,
          state.fireidxRuntime
        )
      ) {
        const long = rebuildFireidxLongSeriesFromConstituents({
          catalog: state.instrumentCatalog,
          chartSeries: state.chartSeries,
          details: state.details,
          simulationEpochMs,
          calendar: this.tradingCalendar,
        });
        applyFireidxLongSeriesToChartSeries(
          state.chartSeries,
          long.dailyBars,
          long.hourlyBars
        );
        state.fireidxRuntime.longSeriesBootstrapped = true;
      }
      const batch = advanceFireidxBatchUpToEpoch({
        chartSeries: state.chartSeries,
        catalog: state.instrumentCatalog,
        compositeIndex: state.compositeIndex,
        details: state.details,
        simulationEpochMs,
        calendar: this.tradingCalendar,
        runtime: state.fireidxRuntime,
        sessionMskDateYyyymmdd: options?.currentMskDate ?? null,
      });
      state.compositeIndex = updateCompositeIndex(
        batch.compositeIndex,
        state.instrumentCatalog,
        state.assetsBySymbol,
        state.details,
        simulationEpochMs,
        this.tradingCalendar
      );
      this.perfProbe.fireidxBatchMinuteCount += batch.minutesProcessed;
      this.perfProbe.fireidxIncrementalCount += 1;
    }

    syncFireidxAsset(state.assetsBySymbol, state.compositeIndex);
    if (chartDetail === FIREIDX_SYMBOL) {
      refreshQuotesForSymbol(
        state,
        FIREIDX_SYMBOL,
        simulationEpochMs,
        this.tradingCalendar,
        { fullChartLineSymbols: [FIREIDX_SYMBOL] }
      );
    }
    }

    this.perfProbe.fireidxChainMs += performance.now() - fireidxChainStart;
    this.perfProbe.tickCount += 1;
    this.perfProbe.quotesApplyMs += performance.now() - quotesStart;
    this.reportPerfProbeIfNeeded();
  }

  createInitialState(simulationEpochMs: number): MarketModuleState {
    const items = readCatalogItems();
    const state = createMarketModuleState(items, emptyChartSeriesBundle());
    this.applyQuotesAndCompositeIndex(state, simulationEpochMs);
    this.lastQuotedSimulationEpochMs = simulationEpochMs;
    this.clearRuntimeCaches();
    // Сбрасываем сабсервис corporateActions. Все события до текущей эпохи
    // считаем «уже произошедшими» (без эмиссии): начинаем сканировать с simulationEpochMs.
    this.corporateActions.processedPaymentIds.clear();
    this.lastScannedEpochMs = simulationEpochMs;
    return state;
  }

  /** Сброс day-buffer и hydrate flags; не трогает corporateActions dedup. */
  clearRuntimeCaches(): void {
    this.lastHydratedEpochMs = null;
    this.marketHydrateInFlight = false;
    this.pendingHydrateEpochMs = null;
    this.prefetchedDays.clear();
    this.rendererPreloadedDays.clear();
    this.dayLoadState = 'idle';
    this.activeDayKey = null;
    this.nextDayKey = null;
    this.bufferReady = false;
    this.nextDayPreloadInFlight = false;
    this.stagedDayBundles.clear();
    this.dayBufferProbe.dayPreloads = 0;
    this.dayBufferProbe.ramBufferSkips = 0;
    this.dayBufferProbe.minuteFallbacks = 0;
    this.dayBufferProbe.lastReportAtMs = 0;
    this.waitingDayForBoundary = null;
  }

  /** После загрузки рядов из SQLite (Electron) пересчитать котировки. */
  afterExternalHydrate(
    gameState: GameState,
    simulationEpochMs: number,
    hydrateMeta?: { stockBarsChanged: boolean }
  ): void {
    if (
      simulationEpochMs === this.lastQuotedSimulationEpochMs &&
      hydrateMeta?.stockBarsChanged !== true
    ) {
      return;
    }
    // Не форсируем full rebuild FIREIDX при гидрации: только incremental-путь.
    // Full rebuild — один раз при bootstrap (пустая minute-серия FIREIDX).
    if (hydrateMeta?.stockBarsChanged) {
      gameState.market.fireidxRuntime.longSeriesBootstrapped = false;
      gameState.market.fireidxRuntime.lastProcessedFireidxEpochMs = 0;
    }
    this.applyQuotesAndCompositeIndex(gameState.market, simulationEpochMs, {
      currentMskDate: gameState.currentTradingSession?.mskDateYyyymmdd ?? null,
      chartDetailSymbol: gameState.uiState.selectedSymbol,
    });
    this.lastQuotedSimulationEpochMs = simulationEpochMs;
  }

  private shouldAutoHydrateMarket(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const w = window as unknown as {
      marketData?: { getSlices?: unknown; getDaySlices?: unknown };
    };
    return (
      typeof w.marketData?.getDaySlices === 'function' ||
      typeof w.marketData?.getSlices === 'function'
    );
  }

  private rememberRendererPreloadedDay(mskDateYyyymmdd: string): void {
    this.rendererPreloadedDays.delete(mskDateYyyymmdd);
    this.rendererPreloadedDays.add(mskDateYyyymmdd);
    // Храним небольшой LRU-хвост, чтобы не раздувать Set при длинной сессии.
    while (this.rendererPreloadedDays.size > 8) {
      const first = this.rendererPreloadedDays.keys().next().value;
      if (typeof first !== 'string') {
        break;
      }
      this.rendererPreloadedDays.delete(first);
    }
  }

  private reportDayBufferProbeIfNeeded(): void {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
      return;
    }
    const now = Date.now();
    if (now - this.dayBufferProbe.lastReportAtMs < 5_000) {
      return;
    }
    console.debug('[market-day-buffer-probe]', {
      dayLoadState: this.dayLoadState,
      activeDayKey: this.activeDayKey,
      nextDayKey: this.nextDayKey,
      bufferReady: this.bufferReady,
      dayPreloads: this.dayBufferProbe.dayPreloads,
      ramBufferSkips: this.dayBufferProbe.ramBufferSkips,
      minuteFallbacks: this.dayBufferProbe.minuteFallbacks,
    });
    this.dayBufferProbe.lastReportAtMs = now;
  }

  private isCurrentDayPreloadedInRenderer(state: GameState): boolean {
    const day = state.currentTradingSession?.mskDateYyyymmdd;
    return Boolean(day && this.rendererPreloadedDays.has(day));
  }

  private markActiveAndNextDay(state: GameState): void {
    this.activeDayKey = state.currentTradingSession?.mskDateYyyymmdd ?? null;
    this.nextDayKey = state.nextTradingSession?.mskDateYyyymmdd ?? null;
    this.bufferReady = this.activeDayKey
      ? this.rendererPreloadedDays.has(this.activeDayKey)
      : false;
  }

  private async fetchDayBundleCoverage(
    state: GameState,
    symbols: readonly string[],
    mskDateYyyymmdd: string
  ): Promise<{
    bundle: MarketChartSeriesBundle | null;
    hasData: boolean;
    hasStockData: boolean;
  }> {
    const dayBundle = await fetchDaySlicesFromElectron(mskDateYyyymmdd, symbols);
    if (!dayBundle) {
      return { bundle: null, hasData: false, hasStockData: false };
    }
    const kindBySymbol = new Map(
      state.market.instrumentCatalog.map((item) => [
        item.symbol.toUpperCase(),
        item.assetKind,
      ])
    );
    const hasData = symbols.some((sym) => {
      const key = sym.toUpperCase();
      return (
        (dayBundle.minute[key]?.length ?? 0) > 0 ||
        (dayBundle.dailyClose[key]?.length ?? 0) > 0 ||
        (dayBundle.fiveMinute[key]?.length ?? 0) > 0 ||
        (dayBundle.thirtyMinute[key]?.length ?? 0) > 0 ||
        (dayBundle.oneHour[key]?.length ?? 0) > 0 ||
        (dayBundle.weekly[key]?.length ?? 0) > 0
      );
    });
    const hasStockData = symbols.some((sym) => {
      const key = sym.toUpperCase();
      if (kindBySymbol.get(key) !== 'stock') {
        return false;
      }
      return (
        (dayBundle.minute[key]?.length ?? 0) > 0 ||
        (dayBundle.dailyClose[key]?.length ?? 0) > 0
      );
    });
    return { bundle: dayBundle, hasData, hasStockData };
  }

  private async preloadDayBundleIntoRenderer(
    state: GameState,
    symbols: readonly string[],
    mskDateYyyymmdd: string
  ): Promise<{
    changed: boolean;
    stockBarsChanged: boolean;
    hasData: boolean;
    hasStockData: boolean;
  }> {
    const { bundle: dayBundle, hasData, hasStockData } =
      await this.fetchDayBundleCoverage(state, symbols, mskDateYyyymmdd);
    if (!dayBundle || !hasData) {
      return {
        changed: false,
        stockBarsChanged: false,
        hasData: false,
        hasStockData,
      };
    }
    this.dayBufferProbe.dayPreloads += 1;
    const merged = this.applyMergedBarsToSeries(
      state,
      symbols,
      dayBundle,
      state.simulationEpochMs
    );
    return { ...merged, hasData: true, hasStockData };
  }

  /**
   * Подготовить двухдневный буфер (`current + next`) в renderer-state.
   * Данные дня загружаются один раз через `market:get-day-slices`, далее внутри
   * дня логика работает из RAM без minute DB hydrate.
   */
  private async preloadCurrentAndNextDayIntoRenderer(
    state: GameState,
    symbols: readonly string[]
  ): Promise<boolean> {
    const currentDay = state.currentTradingSession?.mskDateYyyymmdd ?? null;
    if (!currentDay || symbols.length === 0) {
      return false;
    }
    const switchedDay =
      this.activeDayKey !== null && this.activeDayKey !== currentDay;
    this.dayLoadState = switchedDay ? 'rollingNext' : 'preloadingCurrent';
    let changedAny = false;
    let stockBarsChangedAny = false;
    let currentHasData = this.rendererPreloadedDays.has(currentDay);
    const hasStocksInCatalog = state.market.instrumentCatalog.some(
      (item) => item.assetKind === 'stock'
    );

    if (!this.rendererPreloadedDays.has(currentDay)) {
      const cur = await this.preloadDayBundleIntoRenderer(state, symbols, currentDay);
      changedAny = changedAny || cur.changed;
      stockBarsChangedAny = stockBarsChangedAny || cur.stockBarsChanged;
      const currentReadyByCoverage =
        cur.hasData && (!hasStocksInCatalog || cur.hasStockData);
      if (currentReadyByCoverage) {
        this.rememberRendererPreloadedDay(currentDay);
        this.prefetchedDays.add(currentDay);
      }
      currentHasData = currentHasData || currentReadyByCoverage;
    }

    // Следующий торговый день держим тёплым в RAM заранее (staged), но не вливаем
    // в chartSeries, чтобы не вызывать фоновые merge/trim лаги и артефакты.
    const nextDay = state.nextTradingSession?.mskDateYyyymmdd ?? null;
    if (
      nextDay &&
      !this.rendererPreloadedDays.has(nextDay) &&
      !this.nextDayPreloadInFlight
    ) {
      this.nextDayPreloadInFlight = true;
      void this.fetchDayBundleCoverage(state, symbols, nextDay)
        .then((nxt) => {
          if (!nxt.bundle) {
            return;
          }
          const nextReadyByCoverage = nxt.hasData && (!hasStocksInCatalog || nxt.hasStockData);
          if (nextReadyByCoverage) {
            this.stagedDayBundles.set(nextDay, nxt.bundle);
            while (this.stagedDayBundles.size > 4) {
              const first = this.stagedDayBundles.keys().next().value;
              if (typeof first !== 'string') break;
              this.stagedDayBundles.delete(first);
            }
          }
        })
        .finally(() => {
          this.nextDayPreloadInFlight = false;
        });
    }

    this.markActiveAndNextDay(state);
    this.bufferReady = currentHasData;
    this.dayLoadState = currentHasData ? 'readyCurrent' : 'idle';
    this.reportDayBufferProbeIfNeeded();

    if (!changedAny) {
      return false;
    }
    // Не двигаем симуляцию вперёд: пересчёт только на текущий simulationEpochMs.
    this.lastHydratedEpochMs = state.simulationEpochMs;
    this.notifyHook?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.afterExternalHydrate(state, state.simulationEpochMs, {
      stockBarsChanged: stockBarsChangedAny,
    });
    this.notifyHook?.();
    return true;
  }

  private mergeBarsByEpoch(
    prev: readonly MarketPriceBar[],
    delta: readonly MarketPriceBar[]
  ): readonly MarketPriceBar[] {
    if (delta.length === 0) {
      return prev;
    }
    if (prev.length === 0) {
      return [...delta];
    }
    const lastPrevTs = prev[prev.length - 1]?.t ?? Number.NEGATIVE_INFINITY;
    const firstDeltaTs = delta[0]?.t ?? Number.POSITIVE_INFINITY;
    if (firstDeltaTs > lastPrevTs) {
      return [...prev, ...delta];
    }
    const byT = new Map<number, MarketPriceBar>();
    for (const b of prev) {
      byT.set(b.t, b);
    }
    for (const b of delta) {
      byT.set(b.t, b);
    }
    return [...byT.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, bar]) => ({ ...bar }));
  }

  private reportHydrateProbeIfNeeded(): void {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
      return;
    }
    const now = Date.now();
    if (now - this.hydrateProbe.lastReportAtMs < 2_000) {
      return;
    }
    const avgMs =
      this.hydrateProbe.started > 0
        ? this.hydrateProbe.totalMs / this.hydrateProbe.started
        : 0;
    console.debug('[market-hydrate-probe]', {
      requested: this.hydrateProbe.requested,
      started: this.hydrateProbe.started,
      coalesced: this.hydrateProbe.coalesced,
      applied: this.hydrateProbe.applied,
      skippedInFlight: this.hydrateProbe.skippedInFlight,
      avgMs: Number(avgMs.toFixed(2)),
      maxMs: Number(this.hydrateProbe.maxMs.toFixed(2)),
      lastHydratedEpochMs: this.lastHydratedEpochMs,
      pendingHydrateEpochMs: this.pendingHydrateEpochMs,
    });
    this.hydrateProbe.lastReportAtMs = now;
  }

  private pickHydrateSymbols(state: GameState): string[] {
    const catalog = state.market.instrumentCatalog;
    if (catalog.length === 0) {
      return [];
    }
    // Важно: рынок не должен зависеть от состава портфеля пользователя.
    // Подгружаем по полному каталогу рынка.
    return pickHydrateSymbolsFromCatalog(catalog);
  }

  /**
   * Фаза 1 гидрации: смержить бары из bundle в chartSeries и обрезать ряды.
   * НЕ вызывает afterExternalHydrate — пересчёт котировок откладывается на фазу 2.
   */
  private applyMergedBarsToSeries(
    state: GameState,
    symbols: readonly string[],
    bundle: NonNullable<Awaited<ReturnType<typeof fetchMarketSlicesFromElectron>>>,
    currentEpoch: number
  ): { changed: boolean; stockBarsChanged: boolean } {
    void currentEpoch;
    const catalog = state.market.instrumentCatalog;
    const prevSeries = state.market.chartSeries;
    const merged = {
      minute: { ...prevSeries.minute } as Record<string, readonly MarketPriceBar[]>,
      dailyClose: { ...prevSeries.dailyClose } as Record<string, readonly MarketPriceBar[]>,
      fiveMinute: { ...prevSeries.fiveMinute } as Record<string, readonly MarketPriceBar[]>,
      thirtyMinute: { ...prevSeries.thirtyMinute } as Record<string, readonly MarketPriceBar[]>,
      oneHour: { ...prevSeries.oneHour } as Record<string, readonly MarketPriceBar[]>,
      weekly: { ...prevSeries.weekly } as Record<string, readonly MarketPriceBar[]>,
    };
    let changed = false;
    let stockBarsChanged = false;
    const stockSet = new Set(stockSymbolsFromCatalog(catalog));
    for (const key of symbols) {
      const prevMinute = prevSeries.minute[key] ?? [];
      const nextMinute = this.mergeBarsByEpoch(prevMinute, bundle.minute[key] ?? []);
      changed = changed || nextMinute !== prevMinute;
      merged.minute[key] = nextMinute;

      const prevDaily = prevSeries.dailyClose[key] ?? [];
      const nextDaily = this.mergeBarsByEpoch(prevDaily, bundle.dailyClose[key] ?? []);
      changed = changed || nextDaily !== prevDaily;
      merged.dailyClose[key] = nextDaily;

      const prevFive = prevSeries.fiveMinute[key] ?? [];
      const nextFive = this.mergeBarsByEpoch(prevFive, bundle.fiveMinute[key] ?? []);
      changed = changed || nextFive !== prevFive;
      merged.fiveMinute[key] = nextFive;

      const prevThirty = prevSeries.thirtyMinute[key] ?? [];
      const nextThirty = this.mergeBarsByEpoch(prevThirty, bundle.thirtyMinute[key] ?? []);
      changed = changed || nextThirty !== prevThirty;
      merged.thirtyMinute[key] = nextThirty;

      if (
        stockSet.has(key) &&
        (nextMinute !== prevMinute ||
          nextDaily !== prevDaily ||
          nextFive !== prevFive ||
          nextThirty !== prevThirty)
      ) {
        stockBarsChanged = true;
      }

      const prevHour = prevSeries.oneHour[key] ?? [];
      const nextHour = this.mergeBarsByEpoch(prevHour, bundle.oneHour[key] ?? []);
      changed = changed || nextHour !== prevHour;
      merged.oneHour[key] = nextHour;

      const prevWeekly = prevSeries.weekly[key] ?? [];
      const nextWeekly = this.mergeBarsByEpoch(prevWeekly, bundle.weekly[key] ?? []);
      changed = changed || nextWeekly !== prevWeekly;
      merged.weekly[key] = nextWeekly;
    }

    if (!changed) {
      return { changed: false, stockBarsChanged: false };
    }
    const trimmed = trimChartSeriesBundleForStorage(merged);
    applyChartSeriesBundleToMarket(state.market, trimmed);
    this.hydrateProbe.applied += 1;
    return { changed: true, stockBarsChanged };
  }

  private async runHydrateCycle(
    state: GameState,
    currentEpoch: number,
    previousEpochMs: number
  ): Promise<boolean> {
    const symbols = this.pickHydrateSymbols(state);
    if (symbols.length === 0) {
      return false;
    }
    const startedAt = performance.now();
    this.hydrateProbe.started += 1;
    const bundle = await fetchMarketSlicesFromElectron(
      currentEpoch,
      symbols,
      this.lastHydratedEpochMs ?? previousEpochMs
    );
    const elapsedMs = performance.now() - startedAt;
    this.hydrateProbe.totalMs += elapsedMs;
    this.hydrateProbe.maxMs = Math.max(this.hydrateProbe.maxMs, elapsedMs);
    if (!bundle) {
      return false;
    }

    // ── Фаза 1: смерж баров (~10 мс) ──
    const { changed, stockBarsChanged } = this.applyMergedBarsToSeries(
      state, symbols, bundle, currentEpoch
    );
    if (!changed) {
      return false;
    }
    this.lastHydratedEpochMs = currentEpoch;

    // Промежуточное уведомление: UI видит новые бары до тяжёлой фазы 2.
    this.notifyHook?.();

    // Выдержка: браузер может отрисовать кадр до запуска пересчёта котировок.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // ── Фаза 2: пересчёт котировок + FIREIDX (~3–30 мс) ──
    this.afterExternalHydrate(state, currentEpoch, { stockBarsChanged });

    return true;
  }

  async hydrateFromDatabaseTick(
    state: GameState,
    previousEpochMs: number
  ): Promise<boolean> {
    this.hydrateProbe.requested += 1;
    if (!this.shouldAutoHydrateMarket()) {
      return false;
    }
    const currentEpoch = state.simulationEpochMs;
    if (!Number.isFinite(currentEpoch) || currentEpoch <= previousEpochMs) {
      return false;
    }
    const symbols = this.pickHydrateSymbols(state);
    if (symbols.length === 0) {
      return false;
    }
    // Приоритетный путь: day-buffer. Для текущего дня minute hydrate отключён.
    if (this.isCurrentDayPreloadedInRenderer(state)) {
      this.markActiveAndNextDay(state);
      this.dayBufferProbe.ramBufferSkips += 1;
      this.reportDayBufferProbeIfNeeded();
      return false;
    }
    // На старте/после границы дня сначала пытаемся восстановить day-buffer,
    // и только при неуспехе откатываемся на старый minute hydrate.
    if (!this.marketHydrateInFlight) {
      this.marketHydrateInFlight = true;
      try {
        const dayChanged = await this.preloadCurrentAndNextDayIntoRenderer(
          state,
          symbols
        );
        if (this.isCurrentDayPreloadedInRenderer(state)) {
          return dayChanged;
        }
      } finally {
        this.marketHydrateInFlight = false;
      }
    }
    this.dayBufferProbe.minuteFallbacks += 1;
    this.reportDayBufferProbeIfNeeded();
    if (this.marketHydrateInFlight) {
      this.pendingHydrateEpochMs =
        this.pendingHydrateEpochMs === null
          ? currentEpoch
          : Math.max(this.pendingHydrateEpochMs, currentEpoch);
      this.hydrateProbe.skippedInFlight += 1;
      this.reportHydrateProbeIfNeeded();
      return false;
    }

    this.marketHydrateInFlight = true;
    let changedAny = false;
    let targetEpoch = currentEpoch;
    let fallbackFromEpoch = previousEpochMs;
    try {
      while (Number.isFinite(targetEpoch)) {
        const changed = await this.runHydrateCycle(
          state,
          targetEpoch,
          fallbackFromEpoch
        );
        changedAny = changedAny || changed;
        fallbackFromEpoch = targetEpoch;
        const pending = this.pendingHydrateEpochMs;
        if (pending === null || pending <= targetEpoch) {
          break;
        }
        this.pendingHydrateEpochMs = null;
        targetEpoch = pending;
        this.hydrateProbe.coalesced += 1;
      }
      return changedAny;
    } finally {
      this.marketHydrateInFlight = false;
      this.reportHydrateProbeIfNeeded();
    }
  }

  update(state: GameState, _deltaTime: number, context: ModuleContext): void {
    if (!state.tradingCalendarReady) {
      return;
    }
    const epoch = state.simulationEpochMs;
    if (this.lastQuotedSimulationEpochMs === epoch) {
      return;
    }
    const prevEpoch = this.lastScannedEpochMs ?? epoch;
    this.lastQuotedSimulationEpochMs = epoch;
    this.applyQuotesAndCompositeIndex(state.market, epoch, {
      currentMskDate: state.currentTradingSession?.mskDateYyyymmdd ?? null,
      chartDetailSymbol: state.uiState.selectedSymbol,
    });
    // Сабсервис corporateActions: scan & emit (слой A) — после обновления котировок,
    // чтобы консьюмеры могли уже опираться на актуальные позиции/цены.
    // Передаём календарь: для дивидендов scanner вычисляет cut-off реестра
    // (T-N торговых дней по эре settlement-цикла Мосбиржи).
    const declarations = scanScheduleWindow(
      state.market.details,
      prevEpoch,
      epoch,
      this.tradingCalendar
    );
    if (declarations.length > 0) {
      emitDeclarations(this.corporateActions, declarations, context);
    }
    this.lastScannedEpochMs = epoch;
  }

  onTradingDayChanged(state: GameState, _payload: TradingDayChangedPayload): void {
    const symbols = this.pickHydrateSymbols(state);
    if (symbols.length === 0) {
      return;
    }
    const currentDay = state.currentTradingSession?.mskDateYyyymmdd;
    if (currentDay && !this.rendererPreloadedDays.has(currentDay)) {
      this.waitingDayForBoundary = currentDay;
      void (async () => {
        if (this.marketHydrateInFlight) {
          // Не блокируем симуляцию навсегда: если preload занят/неуспешен,
          // разрешаем minute-fallback в обычном тике.
          if (this.waitingDayForBoundary === currentDay) {
            this.waitingDayForBoundary = null;
          }
          return;
        }
        this.marketHydrateInFlight = true;
        try {
          const stagedKey = state.currentTradingSession?.mskDateYyyymmdd ?? null;
          if (
            stagedKey &&
            this.stagedDayBundles.has(stagedKey) &&
            !this.rendererPreloadedDays.has(stagedKey)
          ) {
            const stagedBundle = this.stagedDayBundles.get(stagedKey)!;
            const { changed, stockBarsChanged } = this.applyMergedBarsToSeries(
              state,
              symbols,
              stagedBundle,
              state.simulationEpochMs
            );
            this.stagedDayBundles.delete(stagedKey);
            this.rememberRendererPreloadedDay(stagedKey);
            this.prefetchedDays.add(stagedKey);
            if (changed) {
              this.lastHydratedEpochMs = state.simulationEpochMs;
              this.notifyHook?.();
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              this.afterExternalHydrate(state, state.simulationEpochMs, {
                stockBarsChanged,
              });
              this.notifyHook?.();
            }
            // Критично для smooth-переходов "каждый день":
            // сразу после swap текущего дня запускаем фоновую подготовку N+2.
            await this.preloadCurrentAndNextDayIntoRenderer(state, symbols);
          } else {
            await this.preloadCurrentAndNextDayIntoRenderer(state, symbols);
          }
        } finally {
          this.marketHydrateInFlight = false;
        }
        // Boundary hold снимаем всегда: если буфер не собрался, работает minute-fallback.
        if (this.waitingDayForBoundary === currentDay) {
          this.waitingDayForBoundary = null;
        }
      })();
    } else if (this.waitingDayForBoundary === currentDay) {
      this.waitingDayForBoundary = null;
    }
  }

  /** Полная пересборка линий графика для выбранного символа (смена инструмента / bootstrap). */
  rebuildChartLinesForSymbol(state: GameState, symbol: string): boolean {
    const sym = symbol.toUpperCase();
    return refreshQuotesForSymbol(
      state.market,
      sym,
      state.simulationEpochMs,
      this.tradingCalendar,
      { fullChartLineSymbols: [sym] }
    );
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    if (command.type === 'market/rebuild-chart-lines') {
      return this.rebuildChartLinesForSymbol(state, command.symbol);
    }
    if (command.type !== 'market/consume-orderbook-liquidity') {
      return false;
    }
    const symbol = command.symbol.toUpperCase();
    const asset = state.market.assetsBySymbol[symbol];
    if (!asset) {
      return false;
    }
    const nextBook = applyOrderBookConsumption(
      asset.orderBook,
      command.takerSide,
      command.slices
    );
    state.market.assetsBySymbol[symbol] = {
      ...asset,
      orderBook: nextBook,
    };
    return true;
  }

  exportRuntimeState(_state: GameState): unknown {
    return {
      processedPaymentIds: [...this.corporateActions.processedPaymentIds],
      lastScannedEpochMs: this.lastScannedEpochMs,
    };
  }

  importRuntimeState(_state: GameState, runtime: unknown): void {
    const r = runtime as {
      processedPaymentIds?: string[];
      lastScannedEpochMs?: number | null;
    };
    this.corporateActions.processedPaymentIds.clear();
    if (Array.isArray(r.processedPaymentIds)) {
      for (const id of r.processedPaymentIds) {
        if (typeof id === 'string') {
          this.corporateActions.processedPaymentIds.add(id);
        }
      }
    }
    this.lastScannedEpochMs =
      r.lastScannedEpochMs === null ||
      (typeof r.lastScannedEpochMs === 'number' &&
        Number.isFinite(r.lastScannedEpochMs))
        ? r.lastScannedEpochMs
        : null;
  }
}
