import marketInstrumentCatalogJson from '@/data/generated/marketInstrumentCatalog.json';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
} from '@/logic/modules/contracts';
import type { TradingDayChangedPayload } from '@/logic/logicEvents';
import type { GameState } from '@/logic/managers/LogicManager';
import type { MarketInstrumentCatalogItem } from './contracts';
import { emptyChartSeriesBundle } from './chartWindows';
import {
  fetchMarketSlicesFromElectron,
  prefetchDayFromElectron,
  prefetchNextDayFromElectron,
} from './marketElectronBridge';
import type { MarketPriceBar } from './priceSeries';
import { applyMarketQuotesForSimulationEpoch } from './quoteApply';
import {
  createMarketModuleState,
  type MarketModuleState,
} from './state';

type CatalogFileShape = { items: MarketInstrumentCatalogItem[] };

function readCatalogItems(): MarketInstrumentCatalogItem[] {
  const raw = marketInstrumentCatalogJson as CatalogFileShape;
  return Array.isArray(raw.items) ? raw.items : [];
}

export class MarketModuleService implements LogicModule<GameState> {
  readonly id = 'market';

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
  private waitingDayForBoundary: string | null = null;

  shouldHoldSimulationAtBoundary(state: GameState): boolean {
    const currentDay = state.currentTradingSession?.mskDateYyyymmdd;
    if (!currentDay) {
      return false;
    }
    return this.waitingDayForBoundary === currentDay;
  }

  createInitialState(simulationEpochMs: number): MarketModuleState {
    const items = readCatalogItems();
    const state = createMarketModuleState(items, emptyChartSeriesBundle());
    applyMarketQuotesForSimulationEpoch(state, simulationEpochMs);
    this.lastQuotedSimulationEpochMs = simulationEpochMs;
    this.lastHydratedEpochMs = null;
    this.prefetchedDays.clear();
    this.waitingDayForBoundary = null;
    return state;
  }

  /** После загрузки рядов из SQLite (Electron) пересчитать котировки и сбросить кэш эпохи. */
  afterExternalHydrate(state: MarketModuleState, simulationEpochMs: number): void {
    applyMarketQuotesForSimulationEpoch(state, simulationEpochMs);
    this.lastQuotedSimulationEpochMs = simulationEpochMs;
  }

  private shouldAutoHydrateMarket(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const w = window as unknown as { marketData?: { getSlices?: unknown } };
    return typeof w.marketData?.getSlices === 'function';
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
    // Подгружаем по каталогу рынка, чтобы котировки и графики обновлялись
    // независимо от наличия позиции в PortfolioModule.
    return catalog
      .map((item) => item.symbol.toUpperCase())
      .filter((symbol, index, arr) => arr.indexOf(symbol) === index);
  }

  private applyHydratedBundle(
    state: GameState,
    symbols: readonly string[],
    bundle: Awaited<ReturnType<typeof fetchMarketSlicesFromElectron>>,
    currentEpoch: number
  ): boolean {
    if (!bundle) {
      return false;
    }
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
      return false;
    }
    state.market = createMarketModuleState(catalog, merged);
    this.afterExternalHydrate(state.market, currentEpoch);
    this.hydrateProbe.applied += 1;
    return true;
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
    const changed = this.applyHydratedBundle(state, symbols, bundle, currentEpoch);
    this.lastHydratedEpochMs = currentEpoch;
    return changed;
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
        const changed = await this.runHydrateCycle(state, targetEpoch, fallbackFromEpoch);
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

  update(state: GameState, _deltaTime: number, _context: ModuleContext): void {
    if (!state.tradingCalendarReady) {
      return;
    }
    const epoch = state.simulationEpochMs;
    if (this.lastQuotedSimulationEpochMs === epoch) {
      return;
    }
    this.lastQuotedSimulationEpochMs = epoch;
    applyMarketQuotesForSimulationEpoch(state.market, epoch);
  }

  onTradingDayChanged(state: GameState, _payload: TradingDayChangedPayload): void {
    const symbols = this.pickHydrateSymbols(state);
    if (symbols.length === 0) {
      return;
    }
    const currentDay = state.currentTradingSession?.mskDateYyyymmdd;
    if (currentDay && !this.prefetchedDays.has(currentDay)) {
      this.waitingDayForBoundary = currentDay;
      void prefetchDayFromElectron(currentDay, symbols).then((res) => {
        if (res?.ok && res.prefetched) {
          if (res.mskDateYyyymmdd) {
            this.prefetchedDays.add(res.mskDateYyyymmdd);
          } else {
            this.prefetchedDays.add(currentDay);
          }
        }
        if (this.waitingDayForBoundary === currentDay) {
          this.waitingDayForBoundary = null;
        }
      });
    }
    void prefetchNextDayFromElectron(state.simulationEpochMs, symbols).then((res) => {
      if (res?.ok && res.prefetched && res.mskDateYyyymmdd) {
        this.prefetchedDays.add(res.mskDateYyyymmdd);
      }
    });
  }

  handleCommand(
    _state: GameState,
    _command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    return false;
  }
}
