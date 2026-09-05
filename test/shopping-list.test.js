import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildShoppingList,
  expandPlan,
  groupByCategory,
  missingUnitWeights,
} from '../src/shopping-list.js';
import { ingredients, line, recipes } from './fixtures.js';

const data = { ingredients, recipes };
const build = (plan) => buildShoppingList(plan, data);

describe('expandPlan', () => {
  it('scales a recipe up to the servings you asked for', () => {
    const lines = expandPlan([{ recipe_id: 'beef-chilli', servings: 8 }], data);
    const mince = lines.find((l) => l.ingredient.id === 'beef-mince-5');
    assert.equal(mince.qty, 1000);
    assert.equal(mince.unit, 'g');
  });

  it('scales down, fractionally, without rounding', () => {
    const lines = expandPlan([{ recipe_id: 'beef-chilli', servings: 3 }], data);
    assert.equal(lines.find((l) => l.ingredient.id === 'beef-mince-5').qty, 375);
    assert.equal(lines.find((l) => l.ingredient.id === 'onion').qty, 0.75);
  });

  it("defaults to the recipe's own serving count", () => {
    const lines = expandPlan([{ recipe_id: 'beef-chilli' }], data);
    assert.equal(lines.find((l) => l.ingredient.id === 'beef-mince-5').qty, 500);
  });

  it('records which recipe each line came from', () => {
    const lines = expandPlan([{ recipe_id: 'bolognese', servings: 2 }], data);
    assert.equal(lines[0].recipe_id, 'bolognese');
    assert.equal(lines[0].recipe_name, 'Bolognese');
    assert.equal(lines[0].servings, 2);
  });
});

describe('merging weights', () => {
  it('sums the same ingredient in the same unit across two recipes', () => {
    // 500g chilli + 300g bolognese
    const mince = line(build([
      { recipe_id: 'beef-chilli', servings: 4 },
      { recipe_id: 'bolognese', servings: 2 },
    ]), 'beef-mince-5');

    assert.equal(mince.total_g, 800);
    assert.equal(mince.qty, 800);
    assert.equal(mince.unit, 'g');
  });

  it('sums across scaled servings', () => {
    // 500g at 4 servings doubled, + 300g at 2 servings tripled
    const mince = line(build([
      { recipe_id: 'beef-chilli', servings: 8 },
      { recipe_id: 'bolognese', servings: 6 },
    ]), 'beef-mince-5');

    assert.equal(mince.total_g, 1900);
  });

  it('adds up repeats of the same recipe', () => {
    const mince = line(build([
      { recipe_id: 'beef-chilli', servings: 4 },
      { recipe_id: 'beef-chilli', servings: 4 },
    ]), 'beef-mince-5');

    assert.equal(mince.total_g, 1000);
    assert.equal(mince.sources.length, 2);
  });

  it('normalises kg into the gram total', () => {
    const bulk = [
      { ...recipes[0], id: 'bulk-chilli', ingredients: [
        { ingredient_id: 'beef-mince-5', qty: 1.2, unit: 'kg' },
      ] },
      ...recipes,
    ];
    const mince = line(
      buildShoppingList(
        [{ recipe_id: 'bulk-chilli' }, { recipe_id: 'bolognese', servings: 2 }],
        { ingredients, recipes: bulk }
      ),
      'beef-mince-5'
    );

    assert.equal(mince.total_g, 1500);
  });
});

describe('merging counts against weights via unit_weight_g', () => {
  it('combines "1 onion" and "150g onion" into whole onions', () => {
    const onion = line(build([
      { recipe_id: 'beef-chilli', servings: 4 },
      { recipe_id: 'bolognese', servings: 2 },
    ]), 'onion');

    assert.equal(onion.total_g, 300);
    assert.equal(onion.qty, 2);
    assert.equal(onion.unit, 'each');
  });

  it('rounds a part-onion up, and keeps the exact figure alongside', () => {
    // 1 onion at half a batch = 0.5 onions = 75g. You still buy one.
    const onion = line(build([{ recipe_id: 'beef-chilli', servings: 2 }]), 'onion');

    assert.equal(onion.total_g, 75);
    assert.equal(onion.exact_qty, 0.5);
    assert.equal(onion.qty, 1);
  });

  it('does not round a whole number up on floating point noise', () => {
    // 3 cloves at 4 servings, doubled = 6 cloves = 18g -> exactly 6, not 7.
    const garlic = line(build([{ recipe_id: 'beef-chilli', servings: 8 }]), 'garlic');

    assert.equal(garlic.qty, 6);
    assert.equal(garlic.exact_qty, 6);
  });

  it('reports in grams when that is how you buy it, even though it counts', () => {
    // Chilli asks for 400g, bolognese for 1 tin. A tin is 400g.
    const tomatoes = line(build([
      { recipe_id: 'beef-chilli', servings: 4 },
      { recipe_id: 'bolognese', servings: 2 },
    ]), 'chopped-tomatoes');

    assert.equal(tomatoes.total_g, 800);
    assert.equal(tomatoes.unit, 'g');
    assert.equal(tomatoes.qty, 800);
    assert.equal(tomatoes.needs_unit_weight, false);
  });

  it('converts a count into grams for a weight-bought ingredient', () => {
    // "2 potatoes" with no gram line anywhere: 2 x 180g.
    const potato = line(build([{ recipe_id: 'lemon-chicken', servings: 2 }]), 'potato');

    assert.equal(potato.total_g, 360);
    assert.equal(potato.unit, 'g');
  });
});

describe('counts with no unit_weight_g', () => {
  it('still totals them, in items, and flags the gap', () => {
    const lemon = line(build([
      { recipe_id: 'lemon-chicken', servings: 2 },
      { recipe_id: 'lemon-chicken', servings: 4 },
    ]), 'lemon');

    assert.equal(lemon.qty, 3);
    assert.equal(lemon.unit, 'each');
    assert.equal(lemon.total_g, null, 'no weight can be claimed without unit_weight_g');
    assert.equal(lemon.needs_unit_weight, true);
  });

  it('keeps weights and counts as separate parts rather than inventing a weight', () => {
    const withGrams = [
      ...recipes,
      { ...recipes[2], id: 'lemon-drizzle', servings: 1, ingredients: [
        { ingredient_id: 'lemon', qty: 90, unit: 'g' },
      ] },
    ];
    const lemon = line(
      buildShoppingList(
        [{ recipe_id: 'lemon-chicken', servings: 2 }, { recipe_id: 'lemon-drizzle' }],
        { ingredients, recipes: withGrams }
      ),
      'lemon'
    );

    assert.equal(lemon.qty, null, 'refuses to give one combined number');
    assert.equal(lemon.total_g, null);
    assert.deepEqual(lemon.parts, [
      { qty: 90, unit: 'g' },
      { qty: 1, unit: 'each' },
    ]);
    assert.equal(lemon.needs_unit_weight, true);
  });

  it('lists what needs a unit weight filling in', () => {
    const list = build([{ recipe_id: 'lemon-chicken', servings: 2 }]);
    assert.deepEqual(missingUnitWeights(list), ['lemon']);
  });
});

describe('list shape', () => {
  it('gives every ingredient a parts array to write down', () => {
    const list = build([{ recipe_id: 'beef-chilli', servings: 4 }]);
    for (const item of list) {
      assert.ok(item.parts.length >= 1, `${item.ingredient_id} has no parts`);
      for (const part of item.parts) {
        assert.equal(typeof part.qty, 'number');
        assert.ok(['g', 'each'].includes(part.unit));
      }
    }
  });

  it('has one entry per ingredient, not one per recipe line', () => {
    const list = build([
      { recipe_id: 'beef-chilli', servings: 4 },
      { recipe_id: 'bolognese', servings: 2 },
    ]);
    const ids = list.map((i) => i.ingredient_id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 5, 'chilli 5 + bolognese 3, overlapping on 3');
  });

  it('traces each line back to the recipes that wanted it', () => {
    const mince = line(build([
      { recipe_id: 'beef-chilli', servings: 4 },
      { recipe_id: 'bolognese', servings: 4 },
    ]), 'beef-mince-5');

    assert.deepEqual(mince.sources, [
      { recipe_id: 'beef-chilli', recipe_name: 'Beef chilli', servings: 4, qty: 500, unit: 'g' },
      { recipe_id: 'bolognese', recipe_name: 'Bolognese', servings: 4, qty: 600, unit: 'g' },
    ]);
  });

  it('sorts by category then name, ready for aisle grouping', () => {
    const list = build([
      { recipe_id: 'beef-chilli', servings: 4 },
      { recipe_id: 'lemon-chicken', servings: 2 },
    ]);
    const keys = list.map((i) => `${i.category}/${i.name}`);
    assert.deepEqual(keys, [...keys].sort());
  });

  it('groups by category on request', () => {
    const groups = groupByCategory(build([{ recipe_id: 'beef-chilli', servings: 4 }]));
    assert.deepEqual([...groups.keys()].sort(), ['grains', 'meat', 'produce', 'tinned']);
    assert.equal(groups.get('produce').length, 2);
  });

  it('returns an empty list for an empty week', () => {
    assert.deepEqual(build([]), []);
  });
});

describe('bad input', () => {
  it('rejects an unknown recipe', () => {
    assert.throws(() => build([{ recipe_id: 'nope' }]), /Unknown recipe_id "nope"/);
  });

  it('rejects a recipe pointing at an ingredient that does not exist', () => {
    const broken = [
      { ...recipes[0], id: 'broken', ingredients: [
        { ingredient_id: 'unicorn', qty: 1, unit: 'each' },
      ] },
    ];
    assert.throws(
      () => buildShoppingList([{ recipe_id: 'broken' }], { ingredients, recipes: broken }),
      /unknown ingredient_id "unicorn"/
    );
  });

  it('rejects a unit it cannot convert instead of guessing a density', () => {
    const broken = [
      { ...recipes[0], id: 'broken', ingredients: [
        { ingredient_id: 'rice-basmati', qty: 250, unit: 'ml' },
      ] },
    ];
    assert.throws(
      () => buildShoppingList([{ recipe_id: 'broken' }], { ingredients, recipes: broken }),
      /Unknown unit "ml"/
    );
  });

  it('rejects zero or negative planned servings', () => {
    assert.throws(
      () => build([{ recipe_id: 'beef-chilli', servings: 0 }]),
      /must be greater than zero/
    );
  });

  it('rejects a negative quantity', () => {
    const broken = [
      { ...recipes[0], id: 'broken', ingredients: [
        { ingredient_id: 'rice-basmati', qty: -5, unit: 'g' },
      ] },
    ];
    assert.throws(
      () => buildShoppingList([{ recipe_id: 'broken' }], { ingredients, recipes: broken }),
      /negative or non-numeric qty/
    );
  });

  it('rejects duplicate ingredient ids', () => {
    assert.throws(
      () => buildShoppingList([], { ingredients: [...ingredients, ingredients[0]], recipes }),
      /Duplicate ingredient id "beef-mince-5"/
    );
  });
});
