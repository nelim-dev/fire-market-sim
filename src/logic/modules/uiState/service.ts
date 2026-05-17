import type { GameState } from '@/logic/managers/LogicManager';
import type { LogicCommand, LogicModule, ModuleContext } from '@/logic/modules/contracts';
import {
  DEFAULT_MARKET_OVERVIEW_FILTERS,
  normalizeUiSymbol,
  type UiStateModuleState,
} from './state';

export class UiStateModuleService implements LogicModule<GameState> {
  readonly id = 'uiState';

  createInitialState(): UiStateModuleState {
    return {
      leftPanelMode: 'portfolio',
      selectedSymbol: null,
      marketOverview: { ...DEFAULT_MARKET_OVERVIEW_FILTERS },
      ready: false,
    };
  }

  update(): void {
    // Пассивный модуль: навигация и выбор — через команды UI.
  }

  handleCommand(
    state: GameState,
    command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    switch (command.type) {
      case 'uiState/set-left-panel-mode':
        return this.setLeftPanelMode(state, command.mode);
      case 'uiState/select-instrument':
        return this.selectInstrument(state, command.symbol);
      case 'uiState/set-market-overview-filters':
        return this.setMarketOverviewFilters(state, command.patch);
      default:
        return false;
    }
  }

  /**
   * Выставить первый символ каталога, если выбор ещё пуст.
   */
  ensureDefaultSelectedSymbol(state: GameState): boolean {
    if (state.uiState.selectedSymbol != null) {
      return false;
    }
    const first = state.market.instrumentCatalog[0];
    if (!first) {
      return false;
    }
    state.uiState.selectedSymbol = normalizeUiSymbol(first.symbol);
    state.uiState.ready = true;
    return true;
  }

  private setLeftPanelMode(
    state: GameState,
    mode: UiStateModuleState['leftPanelMode']
  ): boolean {
    if (state.uiState.leftPanelMode === mode) {
      return false;
    }
    state.uiState.leftPanelMode = mode;
    state.uiState.ready = true;
    return true;
  }

  private selectInstrument(state: GameState, symbol: string): boolean {
    const next = normalizeUiSymbol(symbol);
    if (!next) {
      return false;
    }
    if (state.uiState.selectedSymbol === next) {
      return true;
    }
    state.uiState.selectedSymbol = next;
    state.uiState.ready = true;
    return true;
  }

  private setMarketOverviewFilters(
    state: GameState,
    patch: Partial<UiStateModuleState['marketOverview']>
  ): boolean {
    const prev = state.uiState.marketOverview;
    const next = { ...prev, ...patch };
    const unchanged =
      prev.searchQuery === next.searchQuery &&
      prev.assetKindFilter === next.assetKindFilter &&
      prev.showAvailable === next.showAvailable &&
      prev.showLocked === next.showLocked;
    if (unchanged) {
      return true;
    }
    state.uiState.marketOverview = next;
    state.uiState.ready = true;
    return true;
  }
}
