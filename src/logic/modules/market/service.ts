import marketInstrumentCatalogJson from '@/data/generated/marketInstrumentCatalog.json';
import marketChartSlicesJson from '@/data/generated/marketChartSlices.json';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
} from '@/logic/modules/contracts';
import type { GameState } from '@/logic/managers/LogicManager';
import type { MarketInstrumentCatalogItem } from './contracts';
import type { MarketChartSeriesBundle } from './chartWindows';
import { applyMarketQuotesForSimulationEpoch } from './quoteApply';
import type { MarketPriceBar } from './priceSeries';
import {
  createMarketModuleState,
  type MarketModuleState,
} from './state';

type CatalogFileShape = { items: MarketInstrumentCatalogItem[] };

type ChartDataFileShape = {
  dailyCloseBySymbol?: Record<string, MarketPriceBar[]>;
  fiveMinuteBySymbol?: Record<string, MarketPriceBar[]>;
  thirtyMinuteBySymbol?: Record<string, MarketPriceBar[]>;
  oneHourBySymbol?: Record<string, MarketPriceBar[]>;
  weeklyBySymbol?: Record<string, MarketPriceBar[]>;
};

function readCatalogItems(): MarketInstrumentCatalogItem[] {
  const raw = marketInstrumentCatalogJson as CatalogFileShape;
  return Array.isArray(raw.items) ? raw.items : [];
}

function normalizeBarList(
  bars: MarketPriceBar[] | undefined
): readonly MarketPriceBar[] {
  if (!Array.isArray(bars)) {
    return [];
  }
  return bars.map((b) => ({ t: Number(b.t), c: Number(b.c) }));
}

function uppercaseRecord(
  rec: Record<string, MarketPriceBar[]> | undefined
): Record<string, readonly MarketPriceBar[]> {
  const out: Record<string, readonly MarketPriceBar[]> = {};
  if (!rec || typeof rec !== 'object') {
    return out;
  }
  for (const [k, v] of Object.entries(rec)) {
    out[k.toUpperCase()] = normalizeBarList(v);
  }
  return out;
}

function readChartSeriesBundle(): MarketChartSeriesBundle {
  const raw = marketChartSlicesJson as ChartDataFileShape;
  return {
    dailyClose: uppercaseRecord(raw.dailyCloseBySymbol),
    fiveMinute: uppercaseRecord(raw.fiveMinuteBySymbol),
    thirtyMinute: uppercaseRecord(raw.thirtyMinuteBySymbol),
    oneHour: uppercaseRecord(raw.oneHourBySymbol),
    weekly: uppercaseRecord(raw.weeklyBySymbol),
  };
}

export class MarketModuleService implements LogicModule<GameState> {
  readonly id = 'market';

  private lastQuotedSimulationEpochMs: number | null = null;

  createInitialState(simulationEpochMs: number): MarketModuleState {
    const items = readCatalogItems();
    const bundle = readChartSeriesBundle();
    const state = createMarketModuleState(items, bundle);
    applyMarketQuotesForSimulationEpoch(state, simulationEpochMs);
    this.lastQuotedSimulationEpochMs = simulationEpochMs;
    return state;
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

  handleCommand(
    _state: GameState,
    _command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    return false;
  }
}
