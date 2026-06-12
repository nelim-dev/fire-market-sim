import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  displayPriceRubForSymbol,
  eurRubSeriesPriceToDisplayRub,
  isEurRubDisplaySymbol,
} from '@/logic/domain/eurRubSeriesDisplay';

describe('eurRubSeriesDisplay', () => {
  it('EU symbol uses ÷1000 for display', () => {
    assert.equal(isEurRubDisplaySymbol('EU'), true);
    assert.equal(eurRubSeriesPriceToDisplayRub(71029), 71.029);
    assert.equal(displayPriceRubForSymbol('EU', 70455), 70.455);
    assert.equal(displayPriceRubForSymbol('EUR-RUB', 71029), 71.029);
  });

  it('other symbols unchanged', () => {
    assert.equal(displayPriceRubForSymbol('GAZP', 258.5), 258.5);
    assert.equal(displayPriceRubForSymbol('SBER', 250), 250);
  });
});
