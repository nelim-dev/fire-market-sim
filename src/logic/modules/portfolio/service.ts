import { buildDemoPortfolio } from '@/data/portfolio/buildDemoPortfolio';
import type {
  LedgerEntry,
  NavSnapshot,
  PortfolioCompositionSnapshot,
  PortfolioPosition,
  PositionLot,
  VsFireidxSnapshot,
} from '@/logic/domain/portfolio';
import { FIREIDX_SYMBOL } from '@/logic/modules/market/compositeIndex';
import { resolveFireidxComparisonBaseline } from '@/logic/modules/market/fireidxComparison';
import type { MarketModuleState } from '@/logic/modules/market/state';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
  PortfolioRecordDailyStatsSnapshotsCommand,
} from '@/logic/modules/contracts';
import type {
  TradeExecutionPayload,
  TradingDayChangedPayload,
} from '@/logic/logicEvents';
import type { PortfolioState } from './state';
import { computePortfolioNavRub, positionTotalQuantity } from './selectors';
import {
  buildNkdBySymbolFromMarket,
  computePortfolioNavRubWithNkd,
  resolveNavBaselineForFireidxComparison,
  selectPortfolioCompositionSlices,
} from './statsSelectors';

interface PortfolioModuleRoot {
  portfolio: PortfolioState;
  simulationEpochMs: number;
  market: MarketModuleState;
}

export class PortfolioModuleService
  implements LogicModule<PortfolioModuleRoot>
{
  readonly id = 'portfolio';
  private lotSequence = 0;

  createInitialState(): PortfolioState {
    this.lotSequence = 0;
    return buildDemoPortfolio();
  }

  update(): void {
    // Портфель пассивен: меняется только командами от других модулей.
  }

  handleCommand(
    state: PortfolioModuleRoot,
    command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    switch (command.type) {
      case 'market/sync-prices':
        return this.applyPriceSync(state, command.pricesBySymbol);
      case 'portfolio/apply-trade-execution':
        return this.applyTradeExecution(state, command.execution);
      case 'portfolio/credit-cash':
        return this.applyCashDelta(state, command.amountRub, command.ledgerEntry);
      case 'portfolio/debit-cash':
        return this.applyCashDelta(state, -command.amountRub, command.ledgerEntry);
      case 'portfolio/append-ledger':
        return this.appendLedger(state, command.entry);
      case 'portfolio/close-position':
        return this.closePosition(state, command.ticker);
      case 'portfolio/clear-lot-nkd-at-buy':
        return this.clearLotNkdAtBuy(state, command.ticker);
      case 'portfolio/record-nav-snapshot':
        return this.recordNavSnapshot(
          state,
          command.simulationEpochMs,
          command.navRub
        );
      case 'portfolio/record-daily-stats-snapshots':
        return this.recordDailyStatsSnapshots(state, command);
      case 'portfolio/adjust-reservation':
        return this.adjustReservation(
          state,
          command.symbol,
          command.deltaCashReservedRub,
          command.deltaQtyReserved
        );
      default:
        return false;
    }
  }

  /**
   * При смене торгового дня фиксируем NAV портфеля.
   * Это owned-логика PortfolioModule: владение `navHistory` остаётся в одном модуле,
   * UI читает её через селекторы (см. `selectPortfolioProfitForPeriod`).
   */
  onTradingDayChanged(
    state: PortfolioModuleRoot,
    _payload: TradingDayChangedPayload,
    context: ModuleContext
  ): void {
    const nkdBySymbol = buildNkdBySymbolFromMarket(state.market);
    const navRub = computePortfolioNavRubWithNkd(state.portfolio, nkdBySymbol);
    const compositionSnapshot: PortfolioCompositionSnapshot = {
      simulationEpochMs: state.simulationEpochMs,
      slices: selectPortfolioCompositionSlices(
        state.portfolio,
        nkdBySymbol,
        state.market.assetsBySymbol
      ),
    };

    const fireidxDaily =
      state.market.chartSeries.dailyClose[FIREIDX_SYMBOL] ?? [];
    const fireidxBaseline = resolveFireidxComparisonBaseline(
      fireidxDaily,
      state.simulationEpochMs
    );
    const vsFireidxSnapshot: VsFireidxSnapshot | null = fireidxBaseline
      ? {
          recordedAtEpochMs: state.simulationEpochMs,
          baselineEpochMs: fireidxBaseline.baselineEpochMs,
          navBaselineRub: resolveNavBaselineForFireidxComparison(
            state.portfolio,
            fireidxBaseline.baselineEpochMs
          ),
          indexBaselineLevel: fireidxBaseline.indexBaseline,
          mode: fireidxBaseline.mode,
        }
      : null;

    context.dispatchCommand({
      type: 'portfolio/record-daily-stats-snapshots',
      simulationEpochMs: state.simulationEpochMs,
      navRub,
      compositionSnapshot,
      vsFireidxSnapshot,
    });
  }

  private applyPriceSync(
    state: PortfolioModuleRoot,
    pricesBySymbol: Readonly<Record<string, number>>
  ): boolean {
    let changed = false;
    const nextPositions = state.portfolio.positions.map((position) => {
      const nextPrice = pricesBySymbol[position.ticker.toUpperCase()];
      if (!Number.isFinite(nextPrice) || position.lastPriceRub === nextPrice) {
        return position;
      }
      changed = true;
      return { ...position, lastPriceRub: nextPrice };
    });
    if (changed) {
      state.portfolio = {
        ...state.portfolio,
        positions: nextPositions,
      };
    }
    return true;
  }

  private applyTradeExecution(
    state: PortfolioModuleRoot,
    execution: TradeExecutionPayload
  ): boolean {
    const ticker = execution.symbol.toUpperCase();
    const existingIndex = state.portfolio.positions.findIndex(
      (position) => position.ticker.toUpperCase() === ticker
    );
    const existing =
      existingIndex >= 0 ? state.portfolio.positions[existingIndex] : undefined;

    const newLedgerEntries: LedgerEntry[] = [];
    let nextCash = state.portfolio.cashRub;
    let nextPositions = state.portfolio.positions;

    if (execution.side === 'buy') {
      const buyOutflow =
        execution.priceRub * execution.quantity + execution.commissionRub + execution.nkdRub;
      nextCash -= buyOutflow;
      const newLot = this.makeBuyLot(execution);
      if (existing) {
        nextPositions = state.portfolio.positions.map((position, index) =>
          index === existingIndex
            ? {
                ...position,
                lots: [...position.lots, newLot],
                lastPriceRub: execution.priceRub,
              }
            : position
        );
      } else {
        const asset = state.market.assetsBySymbol[ticker];
        const created: PortfolioPosition = {
          id: `pos-${ticker.toLowerCase()}`,
          kind: execution.assetKind,
          ticker,
          displayName: asset?.displayName ?? ticker,
          lots: [newLot],
          lastPriceRub: execution.priceRub,
        };
        nextPositions = [...state.portfolio.positions, created];
      }

      // Порядок (от верха журнала вниз): trade-buy → commission → НКД-paid.
      // В state.ledger вставляем reverse, чтобы trade-buy оказалась первой.
      if (execution.nkdRub > 0) {
        newLedgerEntries.push({
          id: `${execution.tradeId}-nkd-paid`,
          simulationEpochMs: execution.simulationEpochMs,
          kind: 'accrued-coupon-paid',
          ticker,
          amountRub: -execution.nkdRub,
          relatedTradeId: execution.tradeId,
        });
      }
      if (execution.commissionRub > 0) {
        newLedgerEntries.push({
          id: `${execution.tradeId}-commission`,
          simulationEpochMs: execution.simulationEpochMs,
          kind: 'commission',
          ticker,
          amountRub: -execution.commissionRub,
          relatedTradeId: execution.tradeId,
        });
      }
      newLedgerEntries.push({
        id: `${execution.tradeId}-buy`,
        simulationEpochMs: execution.simulationEpochMs,
        kind: 'trade-buy',
        ticker,
        amountRub: -execution.priceRub * execution.quantity,
        quantity: execution.quantity,
        priceRub: execution.priceRub,
        relatedTradeId: execution.tradeId,
      });
    } else {
      // sell
      if (!existing) {
        // Защитный no-op: продажа без позиции — управляющие проверки выше должны были отвергнуть ордер.
        return true;
      }
      const consumed = execution.consumedLots ?? [];
      const sellInflow = execution.priceRub * execution.quantity + execution.nkdRub;
      const capitalGainTax = execution.capitalGainTaxRub ?? 0;
      nextCash += sellInflow - execution.commissionRub - capitalGainTax;

      const consumedQtyByLotId = new Map<string, number>();
      for (const c of consumed) {
        consumedQtyByLotId.set(c.lotId, (consumedQtyByLotId.get(c.lotId) ?? 0) + c.consumedQty);
      }
      const updatedLots: PositionLot[] = [];
      for (const lot of existing.lots) {
        const consumedQty = consumedQtyByLotId.get(lot.id) ?? 0;
        const remaining = lot.quantity - consumedQty;
        if (remaining > 0) {
          updatedLots.push({ ...lot, quantity: remaining });
        }
      }

      if (updatedLots.length === 0) {
        nextPositions = state.portfolio.positions.filter(
          (_, index) => index !== existingIndex
        );
      } else {
        nextPositions = state.portfolio.positions.map((position, index) =>
          index === existingIndex
            ? { ...position, lots: updatedLots, lastPriceRub: execution.priceRub }
            : position
        );
      }

      // Для sell порядок (сверху вниз журнала): trade-sell → НКД-received → commission → capital-gain-tax.
      if (capitalGainTax > 0) {
        newLedgerEntries.push({
          id: `${execution.tradeId}-capital-gain-tax`,
          simulationEpochMs: execution.simulationEpochMs,
          kind: 'capital-gain-tax',
          ticker,
          amountRub: -capitalGainTax,
          taxBaseRub: execution.realizedGainRub,
          relatedTradeId: execution.tradeId,
        });
      }
      if (execution.commissionRub > 0) {
        newLedgerEntries.push({
          id: `${execution.tradeId}-commission`,
          simulationEpochMs: execution.simulationEpochMs,
          kind: 'commission',
          ticker,
          amountRub: -execution.commissionRub,
          relatedTradeId: execution.tradeId,
        });
      }
      if (execution.nkdRub > 0) {
        newLedgerEntries.push({
          id: `${execution.tradeId}-nkd-received`,
          simulationEpochMs: execution.simulationEpochMs,
          kind: 'accrued-coupon-received',
          ticker,
          amountRub: execution.nkdRub,
          relatedTradeId: execution.tradeId,
        });
      }
      newLedgerEntries.push({
        id: `${execution.tradeId}-sell`,
        simulationEpochMs: execution.simulationEpochMs,
        kind: 'trade-sell',
        ticker,
        amountRub: execution.priceRub * execution.quantity,
        quantity: execution.quantity,
        priceRub: execution.priceRub,
        relatedTradeId: execution.tradeId,
      });
    }

    state.portfolio = {
      ...state.portfolio,
      cashRub: nextCash,
      positions: nextPositions,
      ledger: [...newLedgerEntries.slice().reverse(), ...state.portfolio.ledger],
    };
    return true;
  }

  private applyCashDelta(
    state: PortfolioModuleRoot,
    deltaRub: number,
    ledgerEntry: LedgerEntry
  ): boolean {
    state.portfolio = {
      ...state.portfolio,
      cashRub: state.portfolio.cashRub + deltaRub,
      ledger: [ledgerEntry, ...state.portfolio.ledger],
    };
    return true;
  }

  private appendLedger(state: PortfolioModuleRoot, entry: LedgerEntry): boolean {
    state.portfolio = {
      ...state.portfolio,
      ledger: [entry, ...state.portfolio.ledger],
    };
    return true;
  }

  private closePosition(state: PortfolioModuleRoot, ticker: string): boolean {
    const upper = ticker.toUpperCase();
    const next = state.portfolio.positions.filter(
      (p) => p.ticker.toUpperCase() !== upper
    );
    if (next.length === state.portfolio.positions.length) return true;
    state.portfolio = {
      ...state.portfolio,
      positions: next,
    };
    return true;
  }

  /**
   * Добавляет дневной NAV-snapshot в `navHistory`.
   * Поддерживает сортировку по возрастанию `simulationEpochMs`.
   * При дубле epochMs — заменяет navRub существующей записи (последний выигрывает).
   * При попытке записать snapshot «в прошлое» (раньше последнего) — игнорирует:
   * это защищает от ретроградной перезаписи истории при reset/быстрой перемотке.
   */
  private recordNavSnapshot(
    state: PortfolioModuleRoot,
    simulationEpochMs: number,
    navRub: number
  ): boolean {
    const snap: NavSnapshot = { simulationEpochMs, navRub };
    const history = state.portfolio.navHistory;
    if (history.length === 0) {
      state.portfolio = {
        ...state.portfolio,
        navHistory: [snap],
      };
      return true;
    }
    const last = history[history.length - 1];
    if (simulationEpochMs === last.simulationEpochMs) {
      const next = history.slice(0, -1);
      next.push(snap);
      state.portfolio = { ...state.portfolio, navHistory: next };
      return true;
    }
    if (simulationEpochMs < last.simulationEpochMs) {
      return true;
    }
    state.portfolio = {
      ...state.portfolio,
      navHistory: [...history, snap],
    };
    return true;
  }

  private recordDailyStatsSnapshots(
    state: PortfolioModuleRoot,
    command: PortfolioRecordDailyStatsSnapshotsCommand
  ): boolean {
    this.recordNavSnapshot(state, command.simulationEpochMs, command.navRub);
    state.portfolio = {
      ...state.portfolio,
      compositionSnapshot: command.compositionSnapshot,
      vsFireidxSnapshot: command.vsFireidxSnapshot,
    };
    return true;
  }

  private adjustReservation(
    state: PortfolioModuleRoot,
    symbol: string,
    deltaCashReservedRub: number,
    deltaQtyReserved: number
  ): boolean {
    const sym = symbol.toUpperCase();
    const nextCashReserved = Math.max(
      0,
      state.portfolio.cashReservedRub + deltaCashReservedRub
    );
    const prevQty = state.portfolio.reservedQtyBySymbol[sym] ?? 0;
    const nextQty = Math.max(0, prevQty + deltaQtyReserved);
    const nextMap = { ...state.portfolio.reservedQtyBySymbol };
    if (nextQty <= 0) {
      delete nextMap[sym];
    } else {
      nextMap[sym] = nextQty;
    }
    state.portfolio = {
      ...state.portfolio,
      cashReservedRub: nextCashReserved,
      reservedQtyBySymbol: nextMap,
    };
    return true;
  }

  private clearLotNkdAtBuy(state: PortfolioModuleRoot, ticker: string): boolean {
    const upper = ticker.toUpperCase();
    let changed = false;
    const next = state.portfolio.positions.map((p) => {
      if (p.ticker.toUpperCase() !== upper) return p;
      let lotChanged = false;
      const lots = p.lots.map((lot) => {
        if (lot.nkdPaidAtBuyPerUnit === 0) return lot;
        lotChanged = true;
        return { ...lot, nkdPaidAtBuyPerUnit: 0 };
      });
      if (!lotChanged) return p;
      changed = true;
      return { ...p, lots };
    });
    if (!changed) return true;
    state.portfolio = { ...state.portfolio, positions: next };
    return true;
  }

  private makeBuyLot(execution: TradeExecutionPayload): PositionLot {
    this.lotSequence += 1;
    const pricePerUnitWithCommission =
      execution.priceRub + execution.commissionRub / Math.max(execution.quantity, 1);
    const nkdPaidAtBuyPerUnit =
      execution.assetKind === 'bond' && execution.quantity > 0
        ? execution.nkdRub / execution.quantity
        : 0;
    return {
      id: `${execution.tradeId}-lot-${this.lotSequence}`,
      purchaseEpochMs: execution.simulationEpochMs,
      quantity: execution.quantity,
      pricePerUnitRub: pricePerUnitWithCommission,
      nkdPaidAtBuyPerUnit,
    };
  }

  exportRuntimeState(_state: PortfolioModuleRoot): unknown {
    return { lotSequence: this.lotSequence };
  }

  importRuntimeState(_state: PortfolioModuleRoot, runtime: unknown): void {
    const r = runtime as { lotSequence?: number };
    this.lotSequence =
      typeof r.lotSequence === 'number' && Number.isFinite(r.lotSequence)
        ? r.lotSequence
        : 0;
  }
}

/**
 * Алиас — не часть public API сервиса, используется тестами/инспекцией.
 * @deprecated Используйте `positionTotalQuantity` из selectors.
 */
export const _positionTotalQuantity = positionTotalQuantity;
