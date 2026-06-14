import { LogicManager } from '../../src/logic/managers/LogicManager';
import { selectEducationIsSymbolUnlocked } from '../../src/logic/modules/education/selectors';
import { resolveRequiredTestIds } from '../../src/logic/modules/education/unlockResolver';
import { selectIsInstrumentActiveOnMarket } from '../../src/logic/modules/market/selectors';
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

run('selectEducationIsSymbolUnlocked — rule-based unlock по каталогу', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  for (const row of state.market.instrumentCatalog) {
    const required = resolveRequiredTestIds(row.symbol, row);
    const expectedUnlocked = required.length === 0;
    assert(
      selectEducationIsSymbolUnlocked(row.symbol)(state) === expectedUnlocked,
      expectedUnlocked
        ? `${row.symbol} должен быть разблокирован`
        : `${row.symbol} должен быть заблокирован (нужны тесты: ${required.join(', ')})`
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

run('education — облигации по умолчанию в секции закрытых', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const bond = state.market.instrumentCatalog.find(
    (row) =>
      row.assetKind === 'bond' &&
      selectIsInstrumentActiveOnMarket(row.symbol)(state)
  );
  assert(Boolean(bond), 'в каталоге должна быть облигация');
  assert(
    !selectEducationIsSymbolUnlocked(bond!.symbol)(state),
    'облигация должна быть заблокирована до прохождения теста'
  );
  lm.dispatchCommand({
    type: 'uiState/set-market-overview-filters',
    patch: { showAvailable: true, showLocked: true, assetKindFilter: 'bond', searchQuery: '' },
  });
  const { locked } = selectMarketOverviewRows(lm.getState());
  assert(
    locked.some((r) => r.symbol === bond!.symbol.toUpperCase()),
    'облигация должна быть в секции закрытых'
  );
});

run('selectMarketOverviewRows — EU price scaled for display (÷1000)', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const euAsset = state.market.assetsBySymbol.EU;
  assert(Boolean(euAsset), 'EU asset missing');
  state.market.assetsBySymbol.EU = {
    ...euAsset!,
    currentPriceRub: 71_029,
  };
  lm.dispatchCommand({
    type: 'uiState/set-market-overview-filters',
    patch: {
      showAvailable: true,
      showLocked: false,
      assetKindFilter: 'index',
      searchQuery: 'eur',
    },
  });
  const { available } = selectMarketOverviewRows(lm.getState());
  const eu = available.find((r) => r.symbol === 'EU');
  assert(Boolean(eu), 'EU должна быть в списке индексов');
  assert(
    eu!.currentPriceRub != null && Math.abs(eu!.currentPriceRub - 71.029) < 0.001,
    `EU price must be ÷1000 for display, got ${eu!.currentPriceRub}`
  );
});

process.exit(exitCode(failures));
