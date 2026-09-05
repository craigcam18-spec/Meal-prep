/**
 * What the form and the API both consider a valid recipe.
 *
 * They run the same module, so these are one set of tests for both: whatever
 * the browser lets through, the Function rejects on the same terms, and vice
 * versa.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ID_PATTERN, slugify, today, uniqueId, validateRecipe } from '../src/recipe-schema.js';

const INGREDIENTS = new Set(['beef-mince-5', 'onion', 'olive-oil', 'lemon']);

const draft = (changes = {}) => ({
  name: 'Beef chilli',
  servings: 4,
  ingredients: [{ ingredient_id: 'beef-mince-5', qty: 500, unit: 'g' }],
  steps: ['Brown the mince.'],
  source: { type: 'manual', url: '', creator: '', captured_text: '' },
  ...changes,
});

const check = (input) => validateRecipe(input, { ingredientIds: INGREDIENTS });

/** The first error mentioning `word`, so a test names what it is asserting. */
const complaint = (errors, word) => errors.find((error) => error.toLowerCase().includes(word));

describe('slugify', () => {
  it('makes an id of the shape every other id in the project has', () => {
    for (const name of ['Beef chilli', 'Sauté & café crème', 'Chicken   TIKKA!!!']) {
      assert.match(slugify(name), ID_PATTERN);
    }
  });

  it('falls back rather than producing an empty id', () => {
    assert.equal(slugify('!!!'), 'recipe');
    assert.equal(slugify(''), 'recipe');
  });

  it('numbers a name that is already taken instead of refusing it', () => {
    assert.equal(uniqueId('Beef chilli', []), 'beef-chilli');
    assert.equal(uniqueId('Beef chilli', ['beef-chilli']), 'beef-chilli-2');
    assert.equal(uniqueId('Beef chilli', ['beef-chilli', 'beef-chilli-2']), 'beef-chilli-3');
  });
});

describe('validateRecipe', () => {
  it('accepts a plain hand-typed recipe', () => {
    const { errors, recipe } = check(draft());
    assert.deepEqual(errors, []);
    assert.equal(recipe.id, 'beef-chilli');
    assert.equal(recipe.name, 'Beef chilli');
    assert.equal(recipe.source.imported, today());
  });

  it('trims the name and refuses an empty one', () => {
    assert.equal(check(draft({ name: '  Beef chilli  ' })).recipe.name, 'Beef chilli');
    assert.ok(complaint(check(draft({ name: '   ' })).errors, 'name'));
  });

  it('wants whole servings, at least one', () => {
    for (const servings of [0, -2, 2.5, 'lots', 999]) {
      assert.ok(complaint(check(draft({ servings })).errors, 'servings'), String(servings));
    }
  });

  it('wants at least one ingredient and at least one step', () => {
    assert.ok(complaint(check(draft({ ingredients: [] })).errors, 'ingredient'));
    assert.ok(complaint(check(draft({ steps: [] })).errors, 'step'));
    assert.ok(complaint(check(draft({ steps: ['  ', ''] })).errors, 'step'));
  });

  it('drops blank steps rather than storing them', () => {
    const { recipe } = check(draft({ steps: ['Brown the mince.', '   ', 'Simmer.'] }));
    assert.deepEqual(recipe.steps, ['Brown the mince.', 'Simmer.']);
  });

  it('refuses an ingredient that is not in ingredients.json', () => {
    const errors = check(
      draft({ ingredients: [{ ingredient_id: 'unicorn', qty: 1, unit: 'each' }] })
    ).errors;
    assert.ok(complaint(errors, 'ingredients.json'));
  });

  it('refuses the same ingredient twice, which would only merge anyway', () => {
    const errors = check(
      draft({
        ingredients: [
          { ingredient_id: 'onion', qty: 1, unit: 'each' },
          { ingredient_id: 'onion', qty: 2, unit: 'each' },
        ],
      })
    ).errors;
    assert.ok(complaint(errors, 'already'));
  });

  it('refuses a quantity of zero, a negative, or nothing at all', () => {
    for (const qty of [0, -1, NaN, 'some']) {
      const errors = check(
        draft({ ingredients: [{ ingredient_id: 'onion', qty, unit: 'each' }] })
      ).errors;
      assert.ok(complaint(errors, 'quantity'), String(qty));
    }
  });

  it('refuses a unit that would have to be guessed at', () => {
    for (const unit of ['tbsp', 'cup', 'pinch', '']) {
      const errors = check(
        draft({ ingredients: [{ ingredient_id: 'onion', qty: 1, unit }] })
      ).errors;
      assert.ok(complaint(errors, 'convert'), unit);
    }
  });

  it('allows a count of something with no unit weight — that is the list’s problem to flag', () => {
    // "1 lemon" is a fine thing to write down. The shopping list says the
    // weight is missing; refusing the line here would only invite a made-up one.
    const { errors } = check(
      draft({ ingredients: [{ ingredient_id: 'lemon', qty: 1, unit: 'each' }] })
    );
    assert.deepEqual(errors, []);
  });

  it('insists an imported recipe keeps the original text, not just the link', () => {
    const errors = check(
      draft({
        source: {
          type: 'instagram',
          url: 'https://www.instagram.com/reel/abc/',
          creator: '@someone',
          captured_text: '',
        },
      })
    ).errors;
    assert.ok(complaint(errors, 'links rot'));
  });

  it('is happy with an imported recipe that does', () => {
    const { errors, recipe } = check(
      draft({
        source: {
          type: 'instagram',
          url: 'https://www.instagram.com/reel/abc/',
          creator: '@someone',
          captured_text: 'the whole caption',
        },
      })
    );
    assert.deepEqual(errors, []);
    assert.equal(recipe.source.creator, '@someone');
    assert.equal(recipe.source.captured_text, 'the whole caption');
  });

  it('leaves captured_text empty for one you typed in yourself', () => {
    const { recipe } = check(draft());
    assert.equal(recipe.source.captured_text, '');
    assert.equal(recipe.source.url, null);
    assert.equal(recipe.source.creator, null);
  });

  it('refuses a source type and a URL it does not recognise', () => {
    assert.ok(complaint(check(draft({ source: { type: 'carrier-pigeon' } })).errors, 'source type'));
    assert.ok(
      complaint(
        check(draft({ source: { type: 'manual', url: 'instagram.com/reel/abc' } })).errors,
        'http'
      )
    );
  });

  it('gives a new recipe an id that avoids the ones already in the database', () => {
    const { recipe } = validateRecipe(draft(), {
      ingredientIds: INGREDIENTS,
      existingIds: ['beef-chilli'],
    });
    assert.equal(recipe.id, 'beef-chilli-2');
  });

  it('collects every problem at once rather than stopping at the first', () => {
    const { errors, recipe } = check(draft({ name: '', servings: 0, steps: [] }));
    assert.ok(errors.length >= 3);
    assert.equal(recipe, null);
  });

  it('needs the ingredient list to check against, and says so', () => {
    assert.throws(() => validateRecipe(draft(), {}), /ingredient ids/);
  });
});
