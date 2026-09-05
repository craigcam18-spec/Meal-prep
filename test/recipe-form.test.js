/**
 * The warning the add-recipe form shows under an ingredient line.
 *
 * It is the shopping list's own gap, said before you save rather than after,
 * so the rule for when it appears is worth pinning: a count needs a unit
 * weight, a volume needs a density, and neither is an error.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lineGap } from '../src/recipe-form.js';

const ingredient = (name, purchase) => ({
  id: 'x',
  name,
  purchase: {
    unit: 'g',
    unit_weight_g: purchase.unit_weight_g ?? null,
    density_g_per_ml: purchase.density_g_per_ml ?? null,
  },
});

const onion = ingredient('Onion', { unit_weight_g: 150 });
const lemon = ingredient('Lemon', {});
const oil = ingredient('Olive oil', { density_g_per_ml: 0.91 });
const stock = ingredient('Chicken stock', {});

describe('lineGap', () => {
  it('says nothing about a weight, which always converts', () => {
    assert.equal(lineGap(lemon, 'g'), null);
    assert.equal(lineGap(stock, 'kg'), null);
  });

  it('says nothing when the figure the conversion needs is on file', () => {
    assert.equal(lineGap(onion, 'each'), null);
    assert.equal(lineGap(oil, 'ml'), null);
  });

  it('names the missing unit weight for a count', () => {
    assert.match(lineGap(lemon, 'each'), /unit weight.*Lemon/);
  });

  it('names the missing density for a volume, in the unit you typed', () => {
    assert.match(lineGap(stock, 'ml'), /density.*Chicken stock.*ml/);
    assert.match(lineGap(stock, 'l'), /stays in l/);
  });

  it('says nothing at all until an ingredient is picked', () => {
    assert.equal(lineGap(undefined, 'each'), null);
  });
});
