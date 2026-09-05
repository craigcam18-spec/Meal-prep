/**
 * Guards the two data files against drift: every field the data model
 * specifies, present and the right shape, and every recipe reference
 * resolving to a real ingredient.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildShoppingList } from '../src/shopping-list.js';
import { KNOWN_UNITS } from '../src/units.js';

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));

const ingredients = read('ingredients.json');
const recipes = read('recipes.json');

const SOURCES = ['scanned', 'openfoodfacts', 'cofid', 'manual', 'estimate'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('ingredients.json', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(ingredients));
    assert.ok(ingredients.length > 0);
  });

  it('has unique, slug-shaped ids', () => {
    const ids = ingredients.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, ID);
  });

  for (const ingredient of ingredients) {
    describe(ingredient.id, () => {
      it('has a name, category and alias list', () => {
        assert.equal(typeof ingredient.name, 'string');
        assert.ok(ingredient.name.length > 0);
        assert.equal(typeof ingredient.category, 'string');
        assert.ok(Array.isArray(ingredient.aliases));
      });

      it('has nutrition with a source on the trust ladder', () => {
        const n = ingredient.nutrition;
        assert.equal(typeof n.kcal_per_100g, 'number');
        assert.equal(typeof n.protein_per_100g, 'number');
        assert.ok(n.kcal_per_100g >= 0);
        assert.ok(n.protein_per_100g >= 0);
        assert.ok(SOURCES.includes(n.source), `bad source "${n.source}"`);
        assert.ok(n.source_detail.length > 0);
        assert.match(n.updated, ISO_DATE);
      });

      it('cites a CoFID food code when the source is cofid', () => {
        if (ingredient.nutrition.source !== 'cofid') return;
        assert.match(
          ingredient.nutrition.source_detail,
          /^\d{2}-\d{3} \S/,
          'source_detail should start with the CoFID food code'
        );
      });

      it('names a raw or as-bought CoFID row, never a cooked one', () => {
        if (ingredient.nutrition.source !== 'cofid') return;
        assert.doesNotMatch(
          ingredient.nutrition.source_detail,
          /\b(boiled|stewed|roasted|grilled|fried|baked|casseroled|microwaved|barbecued|cooked)\b/i,
          'cooked weights are not interchangeable with raw'
        );
      });

      it('has a purchase block the merger can use', () => {
        const p = ingredient.purchase;
        assert.ok(Object.hasOwn(p, 'barcode'));
        assert.ok(['g', 'each'].includes(p.unit), `bad purchase unit "${p.unit}"`);
        assert.ok(p.unit_weight_g === null || p.unit_weight_g > 0);
        assert.ok(p.pack_size_g === null || p.pack_size_g > 0);
      });

      it('knows what one item weighs if that is how you buy it', () => {
        if (ingredient.purchase.unit !== 'each') return;
        assert.ok(
          ingredient.purchase.unit_weight_g > 0,
          'an "each" ingredient needs unit_weight_g or nutrition maths cannot run'
        );
      });
    });
  }
});

describe('recipes.json', () => {
  it('is an array of uniquely-identified recipes', () => {
    assert.ok(Array.isArray(recipes));
    const ids = recipes.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, ID);
  });

  for (const recipe of recipes) {
    describe(recipe.id, () => {
      it('has a name, positive servings and steps', () => {
        assert.ok(recipe.name.length > 0);
        assert.ok(recipe.servings > 0);
        assert.ok(Array.isArray(recipe.steps) && recipe.steps.length > 0);
      });

      it('references only real ingredients, in units we can convert', () => {
        const known = new Set(ingredients.map((i) => i.id));
        assert.ok(recipe.ingredients.length > 0);
        for (const line of recipe.ingredients) {
          assert.ok(known.has(line.ingredient_id), `unknown "${line.ingredient_id}"`);
          assert.ok(KNOWN_UNITS.includes(line.unit), `bad unit "${line.unit}"`);
          assert.ok(line.qty > 0);
        }
      });

      it('keeps the original text, not just a link that can rot', () => {
        const s = recipe.source;
        assert.ok(Object.hasOwn(s, 'url'));
        assert.ok(Object.hasOwn(s, 'creator'));
        assert.ok(typeof s.captured_text === 'string' && s.captured_text.length > 0);
        assert.match(s.imported, ISO_DATE);
      });
    });
  }
});

describe('the real data merges', () => {
  it('builds a list for every recipe at once without a unit gap', () => {
    const plan = recipes.map((r) => ({ recipe_id: r.id }));
    const list = buildShoppingList(plan, { ingredients, recipes });

    assert.equal(list.length > 0, recipes.length > 0);
    for (const item of list) {
      assert.equal(
        item.needs_unit_weight,
        false,
        `${item.ingredient_id} needs a unit_weight_g`
      );
      assert.ok(item.total_g > 0);
    }
  });

  it('doubles cleanly when you cook the same recipe twice', () => {
    if (recipes.length === 0) return;
    const single = buildShoppingList([{ recipe_id: recipes[0].id }], { ingredients, recipes });
    const double = buildShoppingList(
      [{ recipe_id: recipes[0].id }, { recipe_id: recipes[0].id }],
      { ingredients, recipes }
    );

    assert.equal(double.length, single.length);
    for (const [i, item] of double.entries()) {
      assert.equal(item.total_g, single[i].total_g * 2, item.ingredient_id);
    }
  });
});
