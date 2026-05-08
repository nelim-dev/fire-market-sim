import { LogicManager } from '../../src/logic/managers/LogicManager';
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
  const state = lm.getState();
  const symbol = state.market.instrumentCatalog
    .map((row) => row.symbol.toUpperCase())
    .find((sym) => {
      const asset = state.market.assetsBySymbol[sym];
      return (
        asset &&
        Number.isFinite(asset.currentPriceRub) &&
        (asset.orderBook.asks[0]?.qty ?? 0) > 0
      );
    });
  if (!symbol) {
    throw new Error('не найден инструмент для покупки');
  }
  return symbol;
}

function pickTradableSymbolForSell(lm: LogicManager): string {
  const state = lm.getState();
  const symbol = state.portfolio.positions
    .map((p) => p.ticker.toUpperCase())
    .find((sym) => {
      const asset = state.market.assetsBySymbol[sym];
      return (
        asset &&
        Number.isFinite(asset.currentPriceRub) &&
        (asset.orderBook.bids[0]?.qty ?? 0) > 0
      );
    });
  if (!symbol) {
    throw new Error('не найден инструмент для продажи');
  }
  return symbol;
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

run('Успешная покупка: уменьшается cash, меняется позиция, добавляется запись', () => {
  const lm = new LogicManager();
  const symbol = pickTradableSymbolForBuy(lm);
  const before = lm.getState();
  const price = before.market.assetsBySymbol[symbol].currentPriceRub as number;
  const qty = 1;
  const positionBefore = before.portfolio.positions.find(
    (p) => p.ticker.toUpperCase() === symbol
  );
  const cashBefore = before.portfolio.cashRub;
  const ledgerBefore = before.portfolio.tradeLedger.length;

  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'buy',
    symbol,
    quantity: qty,
    source: 'modal',
  });
  lm.update(1);

  const after = lm.getState();
  const positionAfter = after.portfolio.positions.find(
    (p) => p.ticker.toUpperCase() === symbol
  );
  if (!positionAfter) {
    throw new Error('после покупки позиция отсутствует');
  }
  if (after.portfolio.cashRub >= cashBefore) {
    throw new Error('cash не уменьшился после покупки');
  }
  if (positionAfter.quantity !== (positionBefore?.quantity ?? 0) + qty) {
    throw new Error('количество позиции не увеличилось на qty');
  }
  if (after.portfolio.tradeLedger.length !== ledgerBefore + 1) {
    throw new Error('запись не добавлена в trade ledger');
  }
  const top = after.portfolio.tradeLedger[0];
  if (top.action !== 'buy' || top.ticker !== symbol || top.priceRub !== price) {
    throw new Error('верхняя запись ledger не соответствует покупке');
  }
});

run('Успешная продажа: растёт cash, уменьшается позиция, запись в истории', () => {
  const lm = new LogicManager();
  const symbol = pickTradableSymbolForSell(lm);
  const before = lm.getState();
  const posBefore = before.portfolio.positions.find(
    (p) => p.ticker.toUpperCase() === symbol
  );
  if (!posBefore || posBefore.quantity < 1) {
    throw new Error('нет позиции для продажи');
  }
  const cashBefore = before.portfolio.cashRub;
  const ledgerBefore = before.portfolio.tradeLedger.length;

  lm.dispatchCommand({
    type: 'trading/submit-market-order',
    side: 'sell',
    symbol,
    quantity: 1,
    source: 'modal',
  });
  lm.update(1);

  const after = lm.getState();
  const posAfter = after.portfolio.positions.find(
    (p) => p.ticker.toUpperCase() === symbol
  );
  if (!posAfter) {
    throw new Error('позиция полностью исчезла при продаже 1 шт');
  }
  if (posAfter.quantity !== posBefore.quantity - 1) {
    throw new Error('количество позиции не уменьшилось на 1');
  }
  if (after.portfolio.cashRub <= cashBefore) {
    throw new Error('cash не увеличился после продажи');
  }
  if (after.portfolio.tradeLedger.length !== ledgerBefore + 1) {
    throw new Error('продажа не добавлена в историю');
  }
  if (after.portfolio.tradeLedger[0].action !== 'sell') {
    throw new Error('верхняя запись history должна быть sell');
  }
});

run('Отказ buy при недостатке средств (TRADE_REJECTED в trading state)', () => {
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
  if (after.portfolio.tradeLedger.length !== 0) {
    throw new Error('ledger не должен пополняться при reject');
  }
  if (after.portfolio.cashRub !== 1) {
    throw new Error('cash неожиданно изменился');
  }
});

run('Отказ sell при недостатке количества', () => {
  const lm = new LogicManager();
  const symbol = pickTradableSymbolForSell(lm);
  const state = lm.getState();
  const pos = state.portfolio.positions.find((p) => p.ticker.toUpperCase() === symbol);
  if (!pos) {
    throw new Error('нет позиции для sell reject');
  }
  const requested = pos.quantity + 1;

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
  const posBeforeQty =
    before.portfolio.positions.find((p) => p.ticker.toUpperCase() === symbol)?.quantity ?? 0;
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

  // На паузе update не двигает время и не должен исполнять очередь.
  lm.update(1);
  let state = lm.getState();
  const posPausedQty =
    state.portfolio.positions.find((p) => p.ticker.toUpperCase() === symbol)?.quantity ?? 0;
  if (posPausedQty !== posBeforeQty) {
    throw new Error('на паузе позиция не должна меняться');
  }
  if (state.portfolio.cashRub !== cashBefore) {
    throw new Error('на паузе cash не должен меняться');
  }

  lm.resume();
  lm.update(1); // первый торговый шаг после паузы
  state = lm.getState();
  const posAfterQty =
    state.portfolio.positions.find((p) => p.ticker.toUpperCase() === symbol)?.quantity ?? 0;
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
