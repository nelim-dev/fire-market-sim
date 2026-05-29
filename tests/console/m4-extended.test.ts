/**
 * Расширенный набор тестов M4 — комиссия, лотность, FIFO + капитал-гейн, дивиденды,
 * купоны, погашение бондов, налоговая база с НКД, фильтр финансового журнала.
 *
 * Тесты целенаправленно манипулируют GameState напрямую (через тип-каст),
 * чтобы изолировать инварианты от рыночных рядов SQLite.
 */
import { LogicManager } from '../../src/logic/managers/LogicManager';
import type { GameState } from '../../src/logic/managers/LogicManager';
import type {
  LedgerEntry,
  PortfolioPosition,
  PositionLot,
} from '../../src/logic/domain/portfolio';
import {
  positionAvgPriceRub,
  positionTotalQuantity,
  selectLedgerByKind,
} from '../../src/logic/modules/portfolio/selectors';
import type { MarketAssetState } from '../../src/logic/modules/market/state';
import {
  MARKET_BOND_MATURED,
  MARKET_COUPON_DECLARED,
  MARKET_DIVIDEND_DECLARED,
} from '../../src/logic/logicEvents';
import { exitCode, printResult } from './runner';

const M = 'M4-ext';
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

function settleOpenOrders(lm: LogicManager, maxSteps = 80): void {
  for (let i = 0; i < maxSteps; i += 1) {
    lm.update(1);
    const open = lm.getState().trading.openOrders.filter(
      (o) => o.status === 'open' || o.status === 'partially_filled'
    );
    if (open.length === 0) {
      return;
    }
  }
}

function near(a: number, b: number, eps = 0.011): boolean {
  return Math.abs(a - b) <= eps;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Готовит «лабораторный» LogicManager: чистый портфель + один кастомный актив
 * (с управляемой ценой / лотностью / признаком bond и т.п.).
 */
function makeLm(opts: {
  symbol: string;
  assetKind?: MarketAssetState['assetKind'];
  pricePerUnitRub: number;
  lotSize?: number;
  isBond?: boolean;
  faceValueRub?: number | null;
  nkdPerBondRub?: number;
  positionLots?: PositionLot[];
  cashRub?: number;
}): { lm: LogicManager; state: GameState; symbol: string } {
  const lm = new LogicManager();
  const state = lm.getState() as unknown as GameState;
  const symbol = opts.symbol.toUpperCase();
  const isBondAsset = (opts.isBond ?? false) && (opts.faceValueRub ?? 0) > 0;
  // Подменяем активы: оставляем только наш тестовый.
  const baseAsset: MarketAssetState = {
    symbol,
    assetKind: opts.assetKind ?? 'stock',
    displayName: symbol,
    isin: `TEST-${symbol}`,
    sourceFilePath: `test/${symbol}.txt`,
    currentPriceRub: opts.pricePerUnitRub,
    dailyChangePct: null,
    periodChangePctByTimeframe: {
      '1d': null,
      '1w': null,
      '1m': null,
      '6m': null,
      '1y': null,
      all: null,
    },
    chartLineByTimeframe: {
      '1d': [],
      '1w': [],
      '1m': [],
      '6m': [],
      '1y': [],
      all: [],
    },
    orderBook: {
      bids: [{ priceRub: opts.pricePerUnitRub, qty: 1_000_000 }],
      asks: [{ priceRub: opts.pricePerUnitRub, qty: 1_000_000 }],
    },
    testOrderBookPin: { priceRub: opts.pricePerUnitRub, qty: 1_000_000 },
    orderBookBuiltAtEpochMs: 0,
    lotSize: opts.lotSize ?? 1,
    isBond: opts.isBond ?? false,
    faceValueRub: opts.faceValueRub ?? null,
    maturityEpochMs: null,
    nkdPerBondRub: opts.nkdPerBondRub ?? 0,
  };
  // Для бондов делаем «правдоподобный» minute bar: бары в % от номинала,
  // и quoteApply нормализует их → ₽ при первом update.
  const minuteSeries: Record<string, { t: number; o: number; h: number; l: number; c: number; v: number }[]> = {
    ...(state.market.chartSeries.minute as Record<string, { t: number; o: number; h: number; l: number; c: number; v: number }[]>),
  };
  if (isBondAsset) {
    const pricePct = (opts.pricePerUnitRub * 100) / (opts.faceValueRub as number);
    minuteSeries[symbol] = [
      {
        t: state.simulationEpochMs - 60_000,
        o: pricePct,
        h: pricePct,
        l: pricePct,
        c: pricePct,
        v: 5_000_000,
      },
    ];
  } else {
    const p = opts.pricePerUnitRub;
    minuteSeries[symbol] = [
      {
        t: state.simulationEpochMs - 60_000,
        o: p,
        h: p,
        l: p,
        c: p,
        v: 5_000_000,
      },
    ];
  }
  state.market = {
    ...state.market,
    instrumentCatalog: [
      {
        assetKind: baseAsset.assetKind,
        ticker: symbol,
        symbol,
        displayName: symbol,
        isin: baseAsset.isin,
        sourceFilePath: baseAsset.sourceFilePath,
      },
    ],
    assetsBySymbol: { [symbol]: baseAsset },
    chartSeries: {
      ...state.market.chartSeries,
      minute: minuteSeries,
    },
  };
  // Пустой портфель + опциональная позиция.
  const positions: PortfolioPosition[] = [];
  if (opts.positionLots && opts.positionLots.length > 0) {
    positions.push({
      id: `pos-${symbol.toLowerCase()}`,
      kind: baseAsset.assetKind,
      ticker: symbol,
      displayName: symbol,
      lots: opts.positionLots,
      lastPriceRub: opts.pricePerUnitRub,
    });
  }
  state.portfolio = {
    cashRub: opts.cashRub ?? 1_000_000,
    cashReservedRub: 0,
    reservedQtyBySymbol: {},
    positions,
    upcomingPayments: [],
    ledger: [],
    navHistory: [],
  };
  state.timeScale = 1000;
  return { lm, state, symbol };
}

function findPosition(state: GameState, symbol: string): PortfolioPosition | undefined {
  return state.portfolio.positions.find(
    (p) => p.ticker.toUpperCase() === symbol.toUpperCase()
  );
}

function lot(
  id: string,
  quantity: number,
  pricePerUnitRub: number,
  nkdPaidAtBuyPerUnit = 0
): PositionLot {
  return {
    id,
    purchaseEpochMs: 0,
    quantity,
    pricePerUnitRub,
    nkdPaidAtBuyPerUnit,
  };
}

// === 1. Bond pricing: % → ₽ через faceValue ===
run('Bond pricing: faceValueRub × pricePct / 100 даёт цену в ₽', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TBND',
    assetKind: 'bond',
    pricePerUnitRub: 1000, // временно как ₽; перезапишем normalized ниже
    isBond: true,
    faceValueRub: 1000,
  });
  // Симулируем сценарий «pricePct=98, face=1000» → должно стать 980 ₽.
  // Для этого подкинем минутный бар и вызовем applyMarketQuotesForSimulationEpoch напрямую через update.
  state.market.chartSeries = {
    ...state.market.chartSeries,
    minute: {
      ...state.market.chartSeries.minute,
      [symbol]: [
        { t: state.simulationEpochMs - 60_000, o: 98, h: 98, l: 98, c: 98, v: 1 },
      ],
    },
  };
  lm.update(1);
  const after = lm.getState();
  const asset = after.market.assetsBySymbol[symbol];
  assert(asset.isBond, 'isBond=true');
  assert(asset.faceValueRub === 1000, `faceValueRub ожидался 1000, получили ${asset.faceValueRub}`);
  assert(
    near(asset.currentPriceRub ?? 0, 980),
    `currentPriceRub ожидался 980, получили ${asset.currentPriceRub}`
  );
});

// === 2. NKD: при buy уменьшает cash, при sell — увеличивает, оба попадают в журнал ===
run('NKD: buy/sell бонда — НКД списывается/зачисляется и фиксируется в журнале', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TBND',
    assetKind: 'bond',
    pricePerUnitRub: 1000,
    isBond: true,
    faceValueRub: 1000,
    nkdPerBondRub: 25,
  });
  const cashBefore = state.portfolio.cashRub;
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: 2,
    source: 'modal',
  });
  settleOpenOrders(lm);
  const posAfterBuy = findPosition(lm.getState() as unknown as GameState, symbol);
  assert(
    posAfterBuy && positionTotalQuantity(posAfterBuy) === 2,
    `позиция после buy: ${posAfterBuy ? positionTotalQuantity(posAfterBuy) : 0}`
  );
  const cashAfterBuy = lm.getState().portfolio.cashRub;
  // outflow = 2×1000 + commission(2*1000*0.001=2) + nkd(2×25=50) = 2052 (±VWAP стакана)
  assert(
    near(cashBefore - cashAfterBuy, 2052, 5),
    `buy cash delta=${cashBefore - cashAfterBuy}, ожидали ~2052`
  );
  const nkdPaidEntry = lm.getState().portfolio.ledger.find(
    (e) => e.kind === 'accrued-coupon-paid'
  );
  assert(nkdPaidEntry, 'нет записи accrued-coupon-paid после buy');
  assert(near(nkdPaidEntry.amountRub, -50), 'НКД-paid сумма не -50');
});

run('NKD: sell бонда — НКД зачисляется в журнал', () => {
  const { lm, symbol } = makeLm({
    symbol: 'TBND2',
    assetKind: 'bond',
    pricePerUnitRub: 1000,
    isBond: true,
    faceValueRub: 1000,
    nkdPerBondRub: 25,
    positionLots: [lot('b1', 2, 1001, 25)],
  });
  const cashBefore = lm.getState().portfolio.cashRub;
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'sell',
    symbol,
    quantity: 2,
    source: 'modal',
  });
  settleOpenOrders(lm);
  const cashAfterSell = lm.getState().portfolio.cashRub;
  assert(
    near(cashAfterSell - cashBefore, 2048, 5),
    `sell cash delta=${cashAfterSell - cashBefore}, ожидали ~2048`
  );
  const nkdReceived = lm.getState().portfolio.ledger.find(
    (e) => e.kind === 'accrued-coupon-received'
  );
  assert(nkdReceived, 'нет записи accrued-coupon-received после sell');
  assert(near(nkdReceived.amountRub, 50), 'НКД-received сумма не 50');
});

// === 3. Лотность ===
run('Lot size: ордер, не кратный лотности, отвергается с INVALID_LOT_QUANTITY', () => {
  const { lm, symbol } = makeLm({
    symbol: 'TLOT',
    pricePerUnitRub: 100,
    lotSize: 10,
  });
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: 7,
    source: 'modal',
  });
  lm.update(1);
  const rej = lm.getState().trading.lastRejection;
  assert(
    rej?.reason === 'INVALID_LOT_QUANTITY',
    `reject reason=${rej?.reason ?? 'none'}; ожидали INVALID_LOT_QUANTITY`
  );
  assert(rej?.lotSize === 10, `lotSize в reject=${rej?.lotSize}, ожидали 10`);
});

// === 4. Комиссия 0.1% при buy ===
run('Commission: 0.1% от суммы сделки удерживается при покупке', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TCOM',
    pricePerUnitRub: 250,
  });
  const cashBefore = state.portfolio.cashRub;
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: 4,
    source: 'modal',
  });
  settleOpenOrders(lm);
  const after = lm.getState();
  // outflow = 4×250 + 4×250×0.001 = 1000 + 1 = 1001 (±VWAP)
  assert(
    near(cashBefore - after.portfolio.cashRub, 1001, 3),
    `cash delta=${cashBefore - after.portfolio.cashRub}, ожидали ~1001`
  );
  const commission = after.portfolio.ledger.find((e) => e.kind === 'commission');
  assert(commission, 'нет записи commission');
  assert(near(commission.amountRub, -1), 'commission сумма не -1₽');
});

// === 5. FIFO + капитал-гейн налог (с учётом sell-side commission в cost basis) ===
run('FIFO + capital gain: налог 13% удерживается с прибыли по FIFO; sell commission в cost basis', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TFIFO',
    pricePerUnitRub: 250,
    positionLots: [lot('l1', 10, 100, 0), lot('l2', 10, 200, 0)],
  });
  const cashBefore = state.portfolio.cashRub;
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'sell',
    symbol,
    quantity: 15,
    source: 'modal',
  });
  settleOpenOrders(lm);
  const after = lm.getState();
  // Цена продажи 250, qty=15. Proceeds=15×250=3750. Commission=3.75.
  // FIFO cost: 10×100 + 5×200 = 2000.
  // costBasis = 2000 + commission_sell(3.75) = 2003.75.
  // realizedGain = 3750 - 2003.75 = 1746.25 → tax = 1746.25×0.13 = 227.0125 → 227.01.
  // cash_delta = 3750 - 3.75 - 227.01 = 3519.24.
  const delta = after.portfolio.cashRub - cashBefore;
  assert(near(delta, 3519.24, 8), `cash_delta=${delta}, ожидали ~3519.24`);
  const taxEntry = after.portfolio.ledger.find((e) => e.kind === 'capital-gain-tax');
  assert(taxEntry, 'нет записи capital-gain-tax');
  assert(
    near(taxEntry.amountRub, -227.01, 0.02),
    `tax=${taxEntry.amountRub}, ожидали -227.01`
  );
  // После продажи 15 из 20 остаётся 5 шт во втором лоте.
  const pos = findPosition(after, symbol);
  assert(pos, 'позиция исчезла');
  assert(positionTotalQuantity(pos) === 5, `остаток qty=${positionTotalQuantity(pos)}`);
});

// === 6. Sell commission in tax base (отдельный регресс-тест) ===
run('Sell commission входит в cost basis при расчёте налога', () => {
  // Позиция 1 шт @ 100.10 (включая buy commission); продажа @ 150.
  // costBasis = 100.10 + sell_commission(0.15) = 100.25 → tax ≈ 6.47.
  const { lm, state, symbol } = makeLm({
    symbol: 'TCSB',
    pricePerUnitRub: 150,
    positionLots: [lot('l1', 1, 100.1, 0)],
  });
  const cashBefore = state.portfolio.cashRub;
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'sell',
    symbol,
    quantity: 1,
    source: 'modal',
  });
  settleOpenOrders(lm);
  const after = lm.getState();
  const taxEntry = after.portfolio.ledger.find((e) => e.kind === 'capital-gain-tax');
  assert(taxEntry, 'нет записи capital-gain-tax');
  assert(
    near(taxEntry.amountRub, -6.47, 1),
    `tax=${taxEntry.amountRub}, ожидали ~-6.47`
  );
  // cash_delta = 150 - sell_commission(0.15) - tax(6.47) = 143.38 (±VWAP)
  const delta = after.portfolio.cashRub - cashBefore;
  assert(near(delta, 143.38, 3), `cash_delta=${delta}, ожидали ~143.38`);
});

// === 7. Dividend payout: gross + tax + net cash ===
run('Dividend payout: MARKET_DIVIDEND_DECLARED → cash += net, журнал += gross & tax', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TDIV',
    pricePerUnitRub: 100,
    positionLots: [lot('l1', 100, 50)],
    cashRub: 0,
  });
  // Триггерим update чтобы tax.attach получил актуальный state.
  lm.update(1);
  const bus = lm.getEventBus();
  bus.emit(MARKET_DIVIDEND_DECLARED, {
    ticker: symbol,
    perShareRub: 10,
    simulationEpochMs: state.simulationEpochMs,
  });
  lm.update(1);
  const after = lm.getState();
  // gross = 10 × 100 = 1000; tax = 130; net = 870.
  assert(
    near(after.portfolio.cashRub, 870),
    `cash после дивиденда=${after.portfolio.cashRub}, ожидали 870`
  );
  const grossEntry = after.portfolio.ledger.find((e) => e.kind === 'dividend-gross');
  const taxEntry = after.portfolio.ledger.find((e) => e.kind === 'dividend-tax');
  assert(grossEntry && near(grossEntry.amountRub, 1000), 'неверный gross дивиденда');
  assert(taxEntry && near(taxEntry.amountRub, -130), 'неверный налог с дивиденда');
});

// === 8. Coupon payout: налог с учётом NKD-paid ===
run('Coupon payout: налоговая база купона уменьшается на накопленный НКД-paid', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TCPN',
    assetKind: 'bond',
    pricePerUnitRub: 1000,
    isBond: true,
    faceValueRub: 1000,
    positionLots: [lot('l1', 10, 1000, 20)], // НКД-paid = 20 ₽/бонд
    cashRub: 0,
  });
  lm.update(1);
  lm.getEventBus().emit(MARKET_COUPON_DECLARED, {
    ticker: symbol,
    perBondRub: 30,
    simulationEpochMs: state.simulationEpochMs,
  });
  lm.update(1);
  const after = lm.getState();
  // gross = 30×10 = 300. NKD-offset = 20×10 = 200. taxBase=100. tax=13. net=287.
  assert(
    near(after.portfolio.cashRub, 287),
    `cash после купона=${after.portfolio.cashRub}, ожидали 287`
  );
  const taxEntry = after.portfolio.ledger.find((e) => e.kind === 'coupon-tax');
  assert(taxEntry && near(taxEntry.amountRub, -13), 'неверный налог с купона');
  assert(taxEntry?.taxBaseRub === 100, `taxBaseRub=${taxEntry?.taxBaseRub}, ожидали 100`);
});

// === 9. Coupon NKD not double counted (последовательные купоны) ===
run('Coupon NKD not double counted: после первого купона NKD-paid обнуляется', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TCDB',
    assetKind: 'bond',
    pricePerUnitRub: 1000,
    isBond: true,
    faceValueRub: 1000,
    positionLots: [lot('l1', 10, 1000, 20)],
    cashRub: 0,
  });
  lm.update(1);
  const bus = lm.getEventBus();
  bus.emit(MARKET_COUPON_DECLARED, {
    ticker: symbol,
    perBondRub: 30,
    simulationEpochMs: state.simulationEpochMs,
  });
  lm.update(1);
  bus.emit(MARKET_COUPON_DECLARED, {
    ticker: symbol,
    perBondRub: 30,
    simulationEpochMs: state.simulationEpochMs + 1,
  });
  lm.update(1);
  const after = lm.getState();
  // 1-й купон: net = 287. 2-й купон: NKD-paid уже обнулён → taxBase=300, tax=39, net=261.
  // итог cash = 287 + 261 = 548.
  assert(
    near(after.portfolio.cashRub, 548),
    `cash после двух купонов=${after.portfolio.cashRub}, ожидали 548`
  );
  // У лота теперь nkdPaidAtBuyPerUnit=0.
  const pos = findPosition(after, symbol);
  assert(pos, 'позиция исчезла');
  assert(
    pos.lots.every((l) => l.nkdPaidAtBuyPerUnit === 0),
    'NKD-paid в лотах не обнулён'
  );
});

// === 10. Bond redemption — без капитал-гейна ===
run('Bond redemption (без прибыли): cash += face×qty, позиция удаляется', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TRED1',
    assetKind: 'bond',
    pricePerUnitRub: 1000,
    isBond: true,
    faceValueRub: 1000,
    positionLots: [lot('l1', 10, 1000, 0)],
    cashRub: 0,
  });
  lm.update(1);
  lm.getEventBus().emit(MARKET_BOND_MATURED, {
    ticker: symbol,
    faceValueRub: 1000,
    simulationEpochMs: state.simulationEpochMs,
  });
  lm.update(1);
  const after = lm.getState();
  assert(near(after.portfolio.cashRub, 10_000), `cash=${after.portfolio.cashRub}, ожидали 10000`);
  assert(!findPosition(after, symbol), 'позиция должна быть закрыта');
  const redemption = after.portfolio.ledger.find((e) => e.kind === 'redemption');
  assert(redemption && near(redemption.amountRub, 10_000), 'нет записи redemption');
  assert(
    !after.portfolio.ledger.find((e) => e.kind === 'capital-gain-tax'),
    'не должно быть налога при отсутствии прибыли'
  );
});

// === 11. Bond redemption capital gain ===
run('Bond redemption (с прибылью): удерживается налог 13% с (face-avg)', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TRED2',
    assetKind: 'bond',
    pricePerUnitRub: 1000,
    isBond: true,
    faceValueRub: 1000,
    positionLots: [lot('l1', 10, 900, 0)],
    cashRub: 0,
  });
  lm.update(1);
  lm.getEventBus().emit(MARKET_BOND_MATURED, {
    ticker: symbol,
    faceValueRub: 1000,
    simulationEpochMs: state.simulationEpochMs,
  });
  lm.update(1);
  const after = lm.getState();
  // gross=10000; gain = (1000-900)×10=1000; tax=130; net=9870.
  assert(near(after.portfolio.cashRub, 9_870), `cash=${after.portfolio.cashRub}, ожидали 9870`);
  const taxEntry = after.portfolio.ledger.find((e) => e.kind === 'capital-gain-tax');
  assert(taxEntry && near(taxEntry.amountRub, -130), 'неверный налог при погашении');
  assert(!findPosition(after, symbol), 'позиция должна быть закрыта');
});

// === 12. Financial journal filter (selectLedgerByKind) ===
run('Financial journal filter: selectLedgerByKind возвращает только заданные kinds', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TJRN',
    pricePerUnitRub: 100,
    cashRub: 100_000,
  });
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: 1,
    source: 'modal',
  });
  lm.update(1);
  const after = lm.getState();
  const onlyTrades = selectLedgerByKind(after.portfolio, ['trade-buy', 'trade-sell']);
  const onlyCommission = selectLedgerByKind(after.portfolio, ['commission']);
  const allEntries = after.portfolio.ledger;
  assert(onlyTrades.every((e) => e.kind === 'trade-buy' || e.kind === 'trade-sell'),
    'фильтр trades содержит сторонние записи');
  assert(onlyTrades.length === 1, `ожидали 1 trade, получили ${onlyTrades.length}`);
  assert(onlyCommission.every((e) => e.kind === 'commission'), 'фильтр commission несогласован');
  assert(allEntries.length >= 2, 'журнал не пополнился базовыми записями buy + commission');
});

// === 13. Coupon payout без NKD-paid (контрольный) ===
run('Coupon payout (без NKD-paid): tax = 13% от полного gross', () => {
  const { lm, state, symbol } = makeLm({
    symbol: 'TCPN0',
    assetKind: 'bond',
    pricePerUnitRub: 1000,
    isBond: true,
    faceValueRub: 1000,
    positionLots: [lot('l1', 10, 1000, 0)],
    cashRub: 0,
  });
  lm.update(1);
  lm.getEventBus().emit(MARKET_COUPON_DECLARED, {
    ticker: symbol,
    perBondRub: 30,
    simulationEpochMs: state.simulationEpochMs,
  });
  lm.update(1);
  const after = lm.getState();
  // gross=300; taxBase=300; tax=39; net=261.
  assert(near(after.portfolio.cashRub, 261), `cash=${after.portfolio.cashRub}, ожидали 261`);
});

// === 14. Non-tradable: ордер на индекс отвергается с NON_TRADABLE_INSTRUMENT ===
run('Non-tradable: ордер buy на индекс отвергается, журнал и кэш не меняются', () => {
  const { lm, symbol } = makeLm({
    symbol: 'TIDX',
    assetKind: 'index',
    pricePerUnitRub: 1_000,
    cashRub: 1_000_000,
  });
  const cashBefore = lm.getState().portfolio.cashRub;
  const ledgerLenBefore = lm.getState().portfolio.ledger.length;
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: 1,
    source: 'modal',
  });
  lm.update(1);
  const after = lm.getState();
  assert(
    after.trading.lastRejection?.reason === 'NON_TRADABLE_INSTRUMENT',
    `reject reason=${after.trading.lastRejection?.reason}, ожидали NON_TRADABLE_INSTRUMENT`
  );
  assert(
    near(after.portfolio.cashRub, cashBefore),
    `cash не должен меняться при отказе: было ${cashBefore}, стало ${after.portfolio.cashRub}`
  );
  assert(
    after.portfolio.ledger.length === ledgerLenBefore,
    `журнал не должен пополняться: было ${ledgerLenBefore}, стало ${after.portfolio.ledger.length}`
  );
  assert(
    after.trading.openOrders.length === 0,
    'ордер не должен попадать в openOrders'
  );
});

// silence unused-import warnings
void positionAvgPriceRub;
void ({} as LedgerEntry);

exitCode(failures);
