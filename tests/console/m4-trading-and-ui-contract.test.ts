import { LogicManager } from '../../src/logic/managers/LogicManager';
import { FIREIDX_SYMBOL } from '../../src/logic/modules/market/compositeIndex';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { positionTotalQuantity } from '../../src/logic/modules/portfolio/selectors';
import {
  createLogicManagerWithTradableMarket,
  pickTradableSymbolForBuy,
  pickTradableSymbolForSell,
} from './tradingTestHarness';
import { exitCode, printResult } from './runner';

const M = 'M4';
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

function qtyOf(state: ReturnType<LogicManager['getState']>, symbol: string): number {
  const pos = state.portfolio.positions.find(
    (p) => p.ticker.toUpperCase() === symbol
  );
  return pos ? positionTotalQuantity(pos) : 0;
}

run('FIREIDX: покупка отклоняется (NON_TRADABLE_INSTRUMENT)', () => {
  const lm = new LogicManager();
  const before = lm.getState();
  const qtyBefore = qtyOf(before, FIREIDX_SYMBOL);
  const ledgerBefore = before.portfolio.ledger.length;

  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol: FIREIDX_SYMBOL,
    quantity: 1,
    source: 'modal',
  });
  lm.update(1);

  const after = lm.getState();
  if (qtyOf(after, FIREIDX_SYMBOL) !== qtyBefore) {
    throw new Error('позиция FIREIDX не должна появиться');
  }
  if (after.portfolio.ledger.length !== ledgerBefore) {
    throw new Error('журнал не должен меняться при отказе FIREIDX');
  }
  const rejection = after.trading.lastRejection;
  if (!rejection || rejection.reason !== 'NON_TRADABLE_INSTRUMENT') {
    throw new Error(
      `ожидали NON_TRADABLE_INSTRUMENT, получили ${rejection?.reason ?? 'нет rejection'}`
    );
  }
});

run('Псевдостакан: несколько уровней bid/ask с положительным объёмом', () => {
  const lm = createLogicManagerWithTradableMarket();
  const symbol = pickTradableSymbolForBuy(lm);
  const asset = lm.getState().market.assetsBySymbol[symbol];
  if (!asset || asset.currentPriceRub == null) {
    throw new Error(`нет актива или цены для ${symbol}`);
  }
  if (asset.orderBook.bids.length < 2 || asset.orderBook.asks.length < 2) {
    throw new Error('ожидали многоуровневый стакан (≥2 уровня)');
  }
  const totalBid = asset.orderBook.bids.reduce((s, l) => s + l.qty, 0);
  const totalAsk = asset.orderBook.asks.reduce((s, l) => s + l.qty, 0);
  if (totalBid <= 0 || totalAsk <= 0) {
    throw new Error('суммарная ликвидность стакана должна быть > 0');
  }
});

run('Успешная покупка: cash уменьшается на (price+commission), позиция растёт, журнал пополняется', () => {
  const lm = createLogicManagerWithTradableMarket();
  const symbol = pickTradableSymbolForBuy(lm);
  const before = lm.getState();
  const qty = 1;
  const qtyBefore = qtyOf(before, symbol);
  const cashBefore = before.portfolio.cashRub;
  const ledgerBefore = before.portfolio.ledger.length;

  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: qty,
    source: 'modal',
  });
  lm.update(1);

  const after = lm.getState();
  if (qtyOf(after, symbol) !== qtyBefore + qty) {
    throw new Error('количество позиции не увеличилось на qty');
  }
  const top = after.portfolio.ledger[0];
  if (top.kind !== 'trade-buy' || top.ticker !== symbol || top.priceRub == null) {
    throw new Error('верхняя запись журнала не соответствует покупке');
  }
  const fillPrice = top.priceRub;
  const expectedCashDelta =
    fillPrice * qty + Math.round(fillPrice * qty * 0.001 * 100) / 100;
  const actualCashDelta = cashBefore - after.portfolio.cashRub;
  if (Math.abs(actualCashDelta - expectedCashDelta) > 1) {
    throw new Error(
      `cash delta ожидалось ~${expectedCashDelta}, получено ${actualCashDelta}`
    );
  }
  if (after.portfolio.ledger.length < ledgerBefore + 1) {
    throw new Error('журнал не пополнился записями сделки');
  }
});

run('Успешная продажа: cash растёт на (price-commission), позиция уменьшается', () => {
  const lm = createLogicManagerWithTradableMarket();
  const symbol = pickTradableSymbolForSell(lm);
  const before = lm.getState();
  const qtyBefore = qtyOf(before, symbol);
  if (qtyBefore < 1) {
    throw new Error('нет позиции для продажи');
  }
  const cashBefore = before.portfolio.cashRub;

  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'sell',
    symbol,
    quantity: 1,
    source: 'modal',
  });
  lm.update(1);

  const after = lm.getState();
  if (qtyOf(after, symbol) !== qtyBefore - 1) {
    throw new Error('количество позиции не уменьшилось на 1');
  }
  if (after.portfolio.cashRub <= cashBefore) {
    throw new Error('cash не увеличился после продажи');
  }
  const topSell = after.portfolio.ledger.find((e) => e.kind === 'trade-sell');
  if (!topSell) {
    throw new Error('в журнале нет записи trade-sell');
  }
});

run('Отказ buy при недостатке средств (TRADE_REJECTED, журнал не меняется)', () => {
  const lm = createLogicManagerWithTradableMarket();
  const mutableState = lm.getState() as unknown as {
    portfolio: { cashRub: number };
  };
  mutableState.portfolio.cashRub = 1;
  const symbol = pickTradableSymbolForBuy(lm);
  const qty = 1;

  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: qty,
    source: 'modal',
  });
  lm.update(1);

  const after = lm.getState();
  if (after.trading.lastRejection?.reason !== 'INSUFFICIENT_FUNDS') {
    throw new Error(
      `ожидали INSUFFICIENT_FUNDS, получили ${after.trading.lastRejection?.reason ?? 'none'}`
    );
  }
  if (after.portfolio.ledger.length !== 0) {
    throw new Error('журнал не должен пополняться при reject');
  }
  if (after.portfolio.cashRub !== 1) {
    throw new Error('cash неожиданно изменился');
  }
});

run('Отказ sell при недостатке количества', () => {
  const lm = createLogicManagerWithTradableMarket();
  const symbol = pickTradableSymbolForSell(lm);
  const state = lm.getState();
  const qty = qtyOf(state, symbol);
  if (qty < 1) {
    throw new Error('нет позиции для sell reject');
  }
  const requested = qty + 1;

  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'sell',
    symbol,
    quantity: requested,
    source: 'modal',
  });
  lm.update(1);

  if (lm.getState().trading.lastRejection?.reason !== 'INSUFFICIENT_POSITION_QTY') {
    throw new Error('ожидали reject по количеству позиции');
  }
});

run('Крупная заявка: частичное исполнение по ликвидности стакана за один тик', () => {
  const lm = createLogicManagerWithTradableMarket();
  const symbol = pickTradableSymbolForBuy(lm);
  const state = lm.getState();
  const asset = state.market.assetsBySymbol[symbol];
  const totalAsk = asset.orderBook.asks.reduce((s, l) => s + l.qty, 0);
  if (totalAsk < 50) {
    throw new Error(`стакан слишком пуст для теста: ${totalAsk}`);
  }
  const price = asset.currentPriceRub ?? 0;
  const maxAffordable = Math.floor((state.portfolio.cashRub * 0.95) / (price * 1.002));
  // Заявка должна быть заметно больше текущего стакана, но не больше доступного cash.
  // Нельзя вызывать update() до замера: за тик market пересобирает стакан, и qty=totalAsk+ε
  // может совпасть с ликвидностью следующего тика → полное исполнение (см. limit-orders тест).
  const qty = Math.min(totalAsk + 50, maxAffordable);
  if (qty <= totalAsk) {
    throw new Error(
      `нельзя протестировать partial fill: ask=${totalAsk}, maxAffordable=${maxAffordable}`
    );
  }
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: qty,
    source: 'modal',
  });
  lm.update(1);
  const after = lm.getState();
  const order = after.trading.openOrders.find((o) => o.symbol === symbol);
  if (!order) {
    throw new Error(
      `нет заявки; rejection=${after.trading.lastRejection?.reason ?? 'none'}`
    );
  }
  if (order.filledQuantity <= 0 || order.filledQuantity >= qty) {
    throw new Error(
      `ожидали 0 < filled < ${qty}, получено status=${order.status} filled=${order.filledQuantity}`
    );
  }
});

run('На паузе ордера не исполняются; за шаг исполняется не больше ликвидности стакана и cash не уходит в минус', () => {
  const lm = createLogicManagerWithTradableMarket();
  const symbol = pickTradableSymbolForBuy(lm);
  const before = lm.getState();
  const totalAsk = before.market.assetsBySymbol[symbol].orderBook.asks.reduce(
    (s, l) => s + l.qty,
    0
  );
  if (totalAsk <= 0) {
    throw new Error('ожидали положительную ликвидность ask');
  }
  const posBeforeQty = qtyOf(before, symbol);
  const cashBefore = before.portfolio.cashRub;
  const orderQty = 1;

  lm.pause();
  for (let i = 0; i < 3; i++) {
    lm.dispatchCommand({
      type: 'trading/submit-market-order',
      side: 'buy',
      symbol,
      quantity: orderQty,
      source: 'modal',
    });
  }

  lm.update(1);
  let state = lm.getState();
  const posPausedQty = qtyOf(state, symbol);
  if (posPausedQty !== posBeforeQty) {
    throw new Error('на паузе позиция не должна меняться');
  }
  if (state.portfolio.cashRub !== cashBefore) {
    throw new Error('на паузе cash не должен меняться');
  }

  lm.resume();
  lm.update(1);
  state = lm.getState();
  const posAfterQty = qtyOf(state, symbol);
  const executedQty = posAfterQty - posBeforeQty;
  if (executedQty > totalAsk) {
    throw new Error(
      `за один шаг не больше суммарной ликвидности ask=${totalAsk}, исполнено=${executedQty}`
    );
  }
  if (executedQty < orderQty) {
    throw new Error('после resume должна исполниться хотя бы одна заявка на 1 шт');
  }
  if (state.portfolio.cashRub < 0) {
    throw new Error(`cash ушел в минус: ${state.portfolio.cashRub}`);
  }
});

run('На паузе рыночные заявки по разным символам исполняются после resume', () => {
  const lm = createLogicManagerWithTradableMarket();
  const symA = pickTradableSymbolForBuy(lm);
  const symB = lm
    .getState()
    .market.instrumentCatalog.filter(
      (row) =>
        row.assetKind === 'stock' &&
        row.symbol.toUpperCase() !== FIREIDX_SYMBOL &&
        row.symbol.toUpperCase() !== symA
    )
    .map((row) => row.symbol.toUpperCase())
    .find((symbol) => {
      const asset = lm.getState().market.assetsBySymbol[symbol];
      return (
        asset &&
        Number.isFinite(asset.currentPriceRub) &&
        (asset.currentPriceRub ?? 0) > 0
      );
    });
  if (!symB) {
    throw new Error('не найден второй инструмент для теста');
  }

  const bootstrapOrderBook = (symbol: string) => {
    lm.dispatchCommand({ type: 'uiState/select-instrument', symbol });
    const state = lm.getState();
    applyMarketQuotesForSimulationEpoch(state.market, state.simulationEpochMs, null, {
      excludeSymbols: [FIREIDX_SYMBOL],
      fullChartLineSymbols: [symbol],
    });
  };

  bootstrapOrderBook(symA);
  bootstrapOrderBook(symB);

  const before = lm.getState();
  const qtyBeforeA = qtyOf(before, symA);
  const qtyBeforeB = qtyOf(before, symB);

  lm.pause();
  lm.dispatchCommand({ type: 'uiState/select-instrument', symbol: symB });
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol: symA,
    quantity: 1,
    source: 'modal',
  });
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol: symB,
    quantity: 1,
    source: 'modal',
  });

  lm.update(1);
  let state = lm.getState();
  if (qtyOf(state, symA) !== qtyBeforeA || qtyOf(state, symB) !== qtyBeforeB) {
    throw new Error('на паузе позиции не должны меняться');
  }
  const openCount = state.trading.openOrders.filter((o) => o.status === 'open').length;
  if (openCount !== 2) {
    throw new Error(`ожидали 2 open orders, получено ${openCount}`);
  }

  lm.resume();
  for (let i = 0; i < 30; i++) {
    lm.update(1);
    state = lm.getState();
    const stillOpen = state.trading.openOrders.filter(
      (o) =>
        (o.status === 'open' || o.status === 'partially_filled') &&
        (o.symbol === symA || o.symbol === symB)
    );
    if (stillOpen.length === 0) {
      break;
    }
  }

  if (qtyOf(state, symA) !== qtyBeforeA + 1) {
    throw new Error(`заявка по ${symA} не исполнилась после resume`);
  }
  if (qtyOf(state, symB) !== qtyBeforeB + 1) {
    throw new Error(`заявка по ${symB} не исполнилась после resume`);
  }
});

exitCode(failures);
