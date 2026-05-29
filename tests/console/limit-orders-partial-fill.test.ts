import { LogicManager } from '../../src/logic/managers/LogicManager';
import { exitCode, printResult } from './runner';

const M = 'ORD';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(M, testNum, description, false, e instanceof Error ? e.message : String(e));
  }
}

function pickBuySymbol(lm: LogicManager): string {
  const state = lm.getState();
  const sym = state.market.instrumentCatalog
    .filter((r) => r.assetKind === 'stock')
    .map((r) => r.symbol.toUpperCase())
    .find((s) => {
      const a = state.market.assetsBySymbol[s];
      return a && (a.currentPriceRub ?? 0) > 0;
    });
  if (!sym) throw new Error('нет акции для теста');
  return sym;
}

run('market buy: частичное исполнение и остаток в openOrders', () => {
  const lm = new LogicManager();
  const symbol = pickBuySymbol(lm);
  const state = lm.getState();
  const asset = state.market.assetsBySymbol[symbol];
  const totalAsk = asset.orderBook.asks.reduce((s, l) => s + l.qty, 0);
  const price = asset.currentPriceRub ?? 0;
  const maxAffordable = Math.floor((state.portfolio.cashRub * 0.95) / (price * 1.002));
  const qty = Math.min(totalAsk + 20, maxAffordable);
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
  if (!order) throw new Error('нет открытой заявки');
  if (order.filledQuantity <= 0 || order.filledQuantity >= qty) {
    throw new Error(`filled=${order.filledQuantity}, qty=${qty}`);
  }
});

run('limit buy: отмена освобождает резерв', () => {
  const lm = new LogicManager();
  const symbol = pickBuySymbol(lm);
  const price = lm.getState().market.assetsBySymbol[symbol].currentPriceRub as number;
  const cashBefore = lm.getState().portfolio.cashRub;
  lm.dispatchCommand({
    type: 'trading/submit-limit-order',
    side: 'buy',
    symbol,
    quantity: 10,
    limitPriceRub: price * 0.5,
    source: 'modal',
  });
  const reserved = lm.getState().portfolio.cashReservedRub;
  if (reserved <= 0) throw new Error('ожидали резерв cash');
  const order = lm.getState().trading.openOrders[0];
  lm.dispatchCommand({ type: 'trading/cancel-order', orderId: order.id });
  if (lm.getState().portfolio.cashReservedRub > 0.01) {
    throw new Error('резерв не освобождён');
  }
  if (Math.abs(lm.getState().portfolio.cashRub - cashBefore) > 0.01) {
    throw new Error('cash изменился при отмене неисполненной лимитки');
  }
});

exitCode(failures);
