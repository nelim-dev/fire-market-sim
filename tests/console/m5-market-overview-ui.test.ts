import { LogicManager } from '../../src/logic/managers/LogicManager';
import { selectEducationIsSymbolUnlocked } from '../../src/logic/modules/education/selectors';
import {
  selectMarketOverviewRows,
  selectUiSelectedSymbol,
} from '../../src/logic/modules/uiState/selectors';
import { exitCode, printResult } from './runner';

const M = 'M5';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

run('uiState/select-instrument обновляет selectedSymbol', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const target = state.market.instrumentCatalog[0]?.symbol;
  assert(Boolean(target), 'каталог пуст');
  lm.dispatchCommand({ type: 'uiState/select-instrument', symbol: target! });
  assert(
    selectUiSelectedSymbol(lm.getState()) === target!.toUpperCase(),
    'selectedSymbol должен совпадать'
  );
});

run('selectEducationIsSymbolUnlocked — все символы каталога после bootstrap', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  for (const row of state.market.instrumentCatalog) {
    assert(
      selectEducationIsSymbolUnlocked(row.symbol)(state),
      `${row.symbol} должен быть разблокирован`
    );
  }
});

run('selectMarketOverviewRows — фильтр по типу акции', () => {
  const lm = new LogicManager();
  lm.dispatchCommand({
    type: 'uiState/set-market-overview-filters',
    patch: { assetKindFilter: 'stock', searchQuery: '' },
  });
  const { available, locked } = selectMarketOverviewRows(lm.getState());
  const rows = [...available, ...locked];
  assert(rows.length > 0, 'ожидались акции в каталоге');
  assert(
    rows.every((r) => r.assetKind === 'stock'),
    'фильтр stock должен оставлять только акции'
  );
});

run('selectMarketOverviewRows — поиск по тикеру', () => {
  const lm = new LogicManager();
  const first = lm.getState().market.instrumentCatalog[0];
  assert(Boolean(first), 'каталог пуст');
  const q = first!.ticker.slice(0, 2).toLowerCase();
  lm.dispatchCommand({
    type: 'uiState/set-market-overview-filters',
    patch: { searchQuery: q, assetKindFilter: 'all' },
  });
  const { available, locked } = selectMarketOverviewRows(lm.getState());
  const rows = [...available, ...locked];
  assert(
    rows.every(
      (r) =>
        r.ticker.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q)
    ),
    'поиск должен фильтровать по тикеру/названию'
  );
});

run('education/lock-symbol — инструмент в секции закрытых', () => {
  const lm = new LogicManager();
  const target = lm.getState().market.instrumentCatalog[0]?.symbol;
  assert(Boolean(target), 'каталог пуст');
  lm.dispatchCommand({ type: 'education/lock-symbol', symbol: target! });
  const state = lm.getState();
  assert(
    !selectEducationIsSymbolUnlocked(target!)(state),
    'символ должен быть заблокирован'
  );
  lm.dispatchCommand({
    type: 'uiState/set-market-overview-filters',
    patch: { showAvailable: true, showLocked: true, assetKindFilter: 'all', searchQuery: '' },
  });
  const { locked } = selectMarketOverviewRows(state);
  assert(
    locked.some((r) => r.symbol === target!.toUpperCase()),
    'заблокированный символ должен быть в locked'
  );
});

process.exit(exitCode(failures));
