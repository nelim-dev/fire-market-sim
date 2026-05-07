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
    if (command.type !== 'market/sync-prices') {
      return false;
    }
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
}

