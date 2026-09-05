import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KNOWN_UNITS,
  assertKnownUnit,
  ceilWhole,
  densityOf,
  formatQuantity,
  fromGrams,
  isCountUnit,
  isVolumeUnit,
  isWeightUnit,
  roundGrams,
  toGrams,
  toMillilitres,
  unitWeightOf,
} from '../src/units.js';

const onion = { id: 'onion', purchase: { unit: 'each', unit_weight_g: 150 } };
const lemon = { id: 'lemon', purchase: { unit: 'each', unit_weight_g: null } };
const mince = { id: 'mince', purchase: { unit: 'g', unit_weight_g: null } };
const oil = { id: 'oil', purchase: { unit: 'g', density_g_per_ml: 0.91 } };
const stock = { id: 'stock', purchase: { unit: 'g', density_g_per_ml: null } };

describe('unit classification', () => {
  it('knows weight, volume and count units apart', () => {
    assert.ok(isWeightUnit('g'));
    assert.ok(isWeightUnit('kg'));
    assert.ok(!isWeightUnit('each'));
    assert.ok(!isWeightUnit('ml'));
    assert.ok(isVolumeUnit('ml'));
    assert.ok(isVolumeUnit('l'));
    assert.ok(!isVolumeUnit('g'));
    assert.ok(isCountUnit('each'));
    assert.ok(!isCountUnit('g'));
  });

  it('rejects units it cannot convert, naming what it accepts', () => {
    assert.throws(() => assertKnownUnit('tbsp'), /Unknown unit "tbsp"/);
    assert.throws(() => assertKnownUnit('cup'), new RegExp(KNOWN_UNITS.join(', ')));
  });

  it('includes the ingredient in the error so you can find the bad line', () => {
    assert.throws(() => toGrams(1, 'tbsp', mince), /\(mince\)/);
  });

  it('normalises litres into millilitres', () => {
    assert.equal(toMillilitres(1.5, 'l'), 1500);
    assert.equal(toMillilitres(250, 'ml'), 250);
    assert.throws(() => toMillilitres(1, 'g'), /not a volume unit/);
  });
});

describe('toGrams', () => {
  it('passes grams straight through', () => {
    assert.equal(toGrams(500, 'g', mince), 500);
  });

  it('scales kilograms up', () => {
    assert.equal(toGrams(1.5, 'kg', mince), 1500);
  });

  it('weighs a count using unit_weight_g', () => {
    assert.equal(toGrams(2, 'each', onion), 300);
  });

  it('returns null — not an error — for a count with no unit_weight_g', () => {
    assert.equal(toGrams(2, 'each', lemon), null);
  });

  it('treats a zero or missing unit_weight_g as unknown', () => {
    assert.equal(unitWeightOf({ purchase: { unit_weight_g: 0 } }), null);
    assert.equal(unitWeightOf({ purchase: {} }), null);
    assert.equal(unitWeightOf(undefined), null);
  });

  it('weighs a volume using density_g_per_ml', () => {
    assert.equal(roundGrams(toGrams(200, 'ml', oil)), 182);
    assert.equal(roundGrams(toGrams(1, 'l', oil)), 910);
  });

  it('returns null — not an error — for a volume with no density', () => {
    assert.equal(toGrams(200, 'ml', stock), null);
  });

  it('treats a zero or missing density as unknown', () => {
    assert.equal(densityOf({ purchase: { density_g_per_ml: 0 } }), null);
    assert.equal(densityOf({ purchase: {} }), null);
    assert.equal(densityOf(undefined), null);
  });
});

describe('fromGrams', () => {
  it('converts grams back into whole-item terms', () => {
    assert.equal(fromGrams(450, 'each', onion), 3);
  });

  it('keeps the fraction rather than rounding early', () => {
    assert.equal(fromGrams(300, 'each', { purchase: { unit_weight_g: 400 } }), 0.75);
  });

  it('returns null when there is no unit weight to divide by', () => {
    assert.equal(fromGrams(450, 'each', lemon), null);
  });

  it('converts grams back into volume through the density', () => {
    assert.equal(fromGrams(182, 'ml', oil), 200);
    assert.equal(fromGrams(910, 'l', oil), 1);
  });

  it('returns null when there is no density to divide by', () => {
    assert.equal(fromGrams(200, 'ml', stock), null);
  });
});

describe('ceilWhole', () => {
  it('rounds a part-item up, because you buy whole onions', () => {
    assert.equal(ceilWhole(2.1), 3);
    assert.equal(ceilWhole(0.25), 1);
  });

  it('leaves exact whole numbers alone', () => {
    assert.equal(ceilWhole(3), 3);
  });

  it('does not round 3.0000000000000004 up to 4', () => {
    assert.equal(ceilWhole(1.5 * 2), 3);
    assert.equal(ceilWhole(0.1 + 0.2 + 0.7), 1);
  });
});

describe('roundGrams', () => {
  it('clears floating point noise', () => {
    assert.equal(roundGrams(0.1 + 0.2), 0.3);
  });

  it('keeps a tenth of a gram', () => {
    assert.equal(roundGrams(12.34), 12.3);
  });
});

describe('formatQuantity', () => {
  it('writes counts bare', () => {
    assert.equal(formatQuantity(3, 'each'), '3');
  });

  it('writes small weights in grams', () => {
    assert.equal(formatQuantity(400, 'g'), '400g');
  });

  it('rolls up to kilograms past 1000g', () => {
    assert.equal(formatQuantity(1500, 'g'), '1.5kg');
    assert.equal(formatQuantity(1000, 'g'), '1kg');
  });

  it('normalises a kg input the same way', () => {
    assert.equal(formatQuantity(1.5, 'kg'), '1.5kg');
    assert.equal(formatQuantity(0.4, 'kg'), '400g');
  });

  it('writes volumes in ml, rolling up to litres', () => {
    assert.equal(formatQuantity(250, 'ml'), '250ml');
    assert.equal(formatQuantity(1500, 'ml'), '1.5L');
    assert.equal(formatQuantity(0.4, 'l'), '400ml');
  });
});
