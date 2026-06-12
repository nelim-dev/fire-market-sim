import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyInstrumentCopyToCatalog } from '../instrumentCopy';
import type { MarketInstrumentCatalogItem } from '../contracts';

const brItem: MarketInstrumentCatalogItem = {
  assetKind: 'index',
  ticker: 'BR',
  symbol: 'BR',
  displayName: 'BR',
  isin: 'TBD-BR',
  sourceFilePath: 'indexes/BR.txt',
};

describe('applyInstrumentCopyToCatalog', () => {
  it('подменяет BR на справочные displayName, isin, ticker и description', () => {
    const [out] = applyInstrumentCopyToCatalog([brItem]);
    assert.equal(out.displayName, 'Нефть');
    assert.equal(out.isin, 'BRENT');
    assert.equal(out.ticker, 'BRENT');
    assert.ok(out.description?.includes('Brent'));
  });

  it('подменяет DN-R на справочные displayName, isin, ticker и description', () => {
    const dnItem: MarketInstrumentCatalogItem = {
      assetKind: 'fund',
      ticker: 'DN-R',
      symbol: 'DN-R',
      displayName: 'DN-R',
      isin: 'TBD-DN-R',
      sourceFilePath: 'fonds/DN-R.txt',
    };
    const [out] = applyInstrumentCopyToCatalog([dnItem]);
    assert.equal(out.displayName, 'Денежный рынок');
    assert.equal(out.isin, 'DN-R');
    assert.equal(out.ticker, 'DN-R');
    assert.ok(out.description?.includes('ежедневной капитализацией'));
  });
  it('подменяет INFL на справочные displayName, isin, ticker и description', () => {
    const inflItem: MarketInstrumentCatalogItem = {
      assetKind: 'index',
      ticker: 'INFL',
      symbol: 'INFL',
      displayName: 'INFL',
      isin: 'TBD-INFL',
      sourceFilePath: 'indexes/INFL.txt',
    };
    const [out] = applyInstrumentCopyToCatalog([inflItem]);
    assert.equal(out.displayName, 'Индекс инфляции');
    assert.equal(out.isin, 'INFL-RU');
    assert.ok(out.description?.includes('месячной инфляции'));
  });

  it('не меняет инструменты без записи в справочнике', () => {
    const other: MarketInstrumentCatalogItem = {
      ...brItem,
      symbol: 'ZZZZ',
      ticker: 'ZZZZ',
      displayName: 'ZZZZ',
      isin: 'TBD-ZZZZ',
    };
    const [out] = applyInstrumentCopyToCatalog([other]);
    assert.deepEqual(out, other);
  });
});
