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
    _state: { portfolio: PortfolioState },
    _command: LogicCommand,
    _context: ModuleContext
  ): boolean {
    return false;
  }
}

