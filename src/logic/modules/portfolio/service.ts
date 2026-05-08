import { buildDemoPortfolio } from '@/data/portfolio/buildDemoPortfolio';
import type {
  LogicCommand,
  LogicModule,
  ModuleContext,
} from '@/logic/modules/contracts';
import type { PortfolioState } from './state';

export class PortfolioModuleService
  implements LogicModule<{ portfolio: PortfolioState }>
{
  readonly id = 'portfolio';

  createInitialState(): PortfolioState {
    return buildDemoPortfolio();
  }

  update(): void {
    // В M2 портфель статический: без рынка/сделок на тике.
  }

  handleCommand(
    state: { portfolio: PortfolioState },
    command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    if (command.type === 'market/sync-prices') {
      // Команда обработана всегда; changed отвечает только за факт мутации state.
      let changed = false;
      const nextPositions = state.portfolio.positions.map((position) => {
        const nextPrice = command.pricesBySymbol[position.ticker.toUpperCase()];
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
    if (command.type !== 'portfolio/apply-trade-execution') {
      return false;
    }

    const execution = command.execution;
    const ticker = execution.symbol.toUpperCase();
    const existingIndex = state.portfolio.positions.findIndex(
      (position) => position.ticker.toUpperCase() === ticker
    );
    const existing = existingIndex >= 0 ? state.portfolio.positions[existingIndex] : undefined;

    let nextCash = state.portfolio.cashRub;
    let nextPositions = state.portfolio.positions;
    if (execution.side === 'buy') {
      nextCash -= execution.amountRub;
      if (existing) {
        const nextQty = existing.quantity + execution.quantity;
        const totalCostRub =
          existing.avgPriceRub * existing.quantity + execution.amountRub;
        const nextAvgPriceRub = totalCostRub / nextQty;
        nextPositions = state.portfolio.positions.map((position, index) =>
          index === existingIndex
            ? {
                ...position,
                quantity: nextQty,
                avgPriceRub: nextAvgPriceRub,
                lastPriceRub: execution.priceRub,
              }
            : position
        );
      } else {
        nextPositions = [
          ...state.portfolio.positions,
          {
            id: `pos-${ticker.toLowerCase()}`,
            kind: execution.assetKind,
            ticker,
            displayName: ticker,
            quantity: execution.quantity,
            avgPriceRub: execution.priceRub,
            lastPriceRub: execution.priceRub,
          },
        ];
      }
    } else {
      nextCash += execution.amountRub;
      if (!existing) {
        return true;
      }
      const remainingQty = existing.quantity - execution.quantity;
      if (remainingQty <= 0) {
        nextPositions = state.portfolio.positions.filter((_, index) => index !== existingIndex);
      } else {
        nextPositions = state.portfolio.positions.map((position, index) =>
          index === existingIndex
            ? {
                ...position,
                quantity: remainingQty,
                lastPriceRub: execution.priceRub,
              }
            : position
        );
      }
    }

    state.portfolio = {
      ...state.portfolio,
      cashRub: nextCash,
      positions: nextPositions,
      tradeLedger: [
        {
          id: execution.tradeId,
          simulationEpochMs: execution.simulationEpochMs,
          ticker,
          action: execution.side,
          priceRub: execution.priceRub,
          quantity: execution.quantity,
          amountRub: execution.amountRub,
        },
        ...state.portfolio.tradeLedger,
      ],
    };

    return true;
  }
}

