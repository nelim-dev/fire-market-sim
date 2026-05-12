import { LogicManager } from '../../src/logic/managers/LogicManager';
import { positionTotalQuantity } from '../../src/logic/modules/portfolio/selectors';
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

function pickTradableSymbolForBuy(lm: LogicManager): string {
  // Берём актив, у которого:
  // — kind не 'index' (индексы непокупаемы → reject NON_TRADABLE_INSTRUMENT, тест не про это),
  // — цена > 0 (бонды могут стартовать с 0₽ до асинхронной hydration минутных баров),
  // — есть ликвидность ask.
  const state = lm.getState();
  const symbol = state.market.instrumentCatalog
    .filter((row) => row.assetKind !== 'index')
    .map((row) => row.symbol.toUpperCase())
    .find((sym) => {
      const asset = state.market.assetsBySymbol[sym];
      return (
        asset &&
        Number.isFinite(asset.currentPriceRub) &&
        (asset.currentPriceRub ?? 0) > 0 &&
        (asset.orderBook.asks[0]?.qty ?? 0) > 0
      );
    });
  if (!symbol) {
    throw new Error('не найден инструмент для покупки');
  }
  return symbol;
}

function pickTradableSymbolForSell(lm: LogicManager): string {
  // Те же требования: kind ≠ index, цена > 0, есть bid-ликвидность.
  const state = lm.getState();
  const symbol = state.portfolio.positions
    .map((p) => p.ticker.toUpperCase())
    .find((sym) => {
      const asset = state.market.assetsBySymbol[sym];
      return (
        asset &&
        asset.assetKind !== 'index' &&
        Number.isFinite(asset.currentPriceRub) &&
        (asset.currentPriceRub ?? 0) > 0 &&
        (asset.orderBook.bids[0]?.qty ?? 0) > 0
      );
    });
  if (!symbol) {
    throw new Error('не найден инструмент для продажи');
  }
  return symbol;
}

function qtyOf(state: ReturnType<LogicManager['getState']>, symbol: string): number {
  const pos = state.portfolio.positions.find(
    (p) => p.ticker.toUpperCase() === symbol
  );
  return pos ? positionTotalQuantity(pos) : 0;
}

run('Псевдостакан содержит 2 строки по текущей цене', () => {
  const lm = new LogicManager();
  const symbol = pickTradableSymbolForBuy(lm);
  const asset = lm.getState().market.assetsBySymbol[symbol];
  if (!asset || asset.currentPriceRub == null) {
    throw new Error(`нет актива или цены для ${symbol}`);
  }
  if (asset.orderBook.bids.length !== 1 || asset.orderBook.asks.length !== 1) {
    throw new Error('ожидали по одной строке bid/ask');
  }
  if (asset.orderBook.bids[0].priceRub !== asset.currentPriceRub) {
    throw new Error('bid price не равен текущей цене');
  }
  if (asset.orderBook.asks[0].priceRub !== asset.currentPriceRub) {
    throw new Error('ask price не равен текущей цене');
  }
});

run('Успешная покупка: cash уменьшается на (price+commission), позиция растёт, журнал пополняется', () => {
  const lm = new LogicManager();
  const symbol = pickTradableSymbolForBuy(lm);
  const before = lm.getState();
  const price = before.market.assetsBySymbol[symbol].currentPriceRub as number;
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
  const expectedCashDelta = price * qty + Math.round(price * qty * 0.001 * 100) / 100;
  const actualCashDelta = cashBefore - after.portfolio.cashRub;
  if (Math.abs(actualCashDelta - expectedCashDelta) > 0.011) {
    throw new Error(
      `cash delta ожидалось ${expectedCashDelta}, получено ${actualCashDelta}`
    );
  }
  if (after.portfolio.ledger.length < ledgerBefore + 1) {
    throw new Error('журнал не пополнился записями сделки');
  }
  const top = after.portfolio.ledger[0];
  if (top.kind !== 'trade-buy' || top.ticker !== symbol || top.priceRub !== price) {
    throw new Error('верхняя запись журнала не соответствует покупке');
  }
});

run('Успешная продажа: cash растёт на (price-commission), позиция уменьшается', () => {
  const lm = new LogicManager();
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
  const lm = new LogicManager();
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
  const lm = new LogicManager();
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

run('Отказ при недостаточной ликвидности в псевдостакане', () => {
  const lm = new LogicManager();
  const symbol = pickTradableSymbolForBuy(lm);
  const qty = (lm.getState().market.assetsBySymbol[symbol].orderBook.asks[0]?.qty ?? 0) + 1;
  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: qty,
    source: 'modal',
  });
  lm.update(1);
  if (
    lm.getState().trading.lastRejection?.reason !==
    'INSUFFICIENT_ORDERBOOK_LIQUIDITY'
  ) {
    throw new Error('ожидали reject по ликвидности псевдостакана');
  }
});

run('На паузе ордера не исполняются; за шаг исполняется не больше ликвидности стакана и cash не уходит в минус', () => {
  const lm = new LogicManager();
  const symbol = pickTradableSymbolForBuy(lm);
  const before = lm.getState();
  const askQty = before.market.assetsBySymbol[symbol].orderBook.asks[0]?.qty ?? 0;
  if (askQty <= 0) {
    throw new Error('ожидали положительную ликвидность ask');
  }
  const posBeforeQty = qtyOf(before, symbol);
  const cashBefore = before.portfolio.cashRub;

  lm.pause();
  for (let i = 0; i < 5; i++) {
    lm.dispatchCommand({
      type: 'trading/submit-market-order',
      side: 'buy',
      symbol,
      quantity: askQty,
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
  if (executedQty !== askQty) {
    throw new Error(
      `за один шаг должно исполниться не больше ask=${askQty}, исполнено=${executedQty}`
    );
  }
  if (state.portfolio.cashRub < 0) {
    throw new Error(`cash ушел в минус: ${state.portfolio.cashRub}`);
  }
});

exitCode(failures);
