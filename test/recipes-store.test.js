/**
 * The D1 side of recipes: the schema, the seed, and the queries in
 * src/recipes-store.js, all run against a real (in-memory) SQLite database.
 *
 * Recipes are no longer a file in git, so a test that reads a file is no
 * longer a guard on anything. This is what replaces it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { freshDatabase } from './d1.js';
import {
  deleteRecipeStatements,
  existingRecipeIds,
  insertRecipeStatements,
  loadRecipes,
} from '../src/recipes-store.js';

const sample = {
  id: 'lentil-dhal',
  name: 'Lentil dhal',
  servings: 3,
  ingredients: [
    { ingredient_id: 'red-lentils', qty: 250, unit: 'g' },
    { ingredient_id: 'onion', qty: 1, unit: 'each' },
    { ingredient_id: 'coconut-milk', qty: 400, unit: 'g' },
  ],
  steps: ['Soften the onion.', 'Add the lentils and the coconut milk.', 'Simmer.'],
  source: {
    type: 'instagram',
    url: 'https://www.instagram.com/reel/abc123/',
    creator: '@someone',
    captured_text: 'the original caption',
    imported: '2026-09-05',
  },
};

describe('the schema and the seed', () => {
  it('loads the Beef chilli that used to live in recipes.json', async () => {
    const db = freshDatabase('seed.sql');
    const recipes = await loadRecipes(db);

    assert.equal(recipes.length, 1);
    const [chilli] = recipes;
    assert.equal(chilli.id, 'beef-chilli');
    assert.equal(chilli.name, 'Beef chilli');
    assert.equal(chilli.servings, 4);
    assert.equal(chilli.ingredients.length, 10);
    assert.equal(chilli.steps.length, 5);
  });

  it('keeps the ingredients and the steps in the order they were written', async () => {
    const db = freshDatabase('seed.sql');
    const [chilli] = await loadRecipes(db);

    assert.equal(chilli.ingredients[0].ingredient_id, 'beef-mince-5');
    assert.equal(chilli.ingredients.at(-1).ingredient_id, 'rice-basmati');
    assert.match(chilli.steps[0], /^Heat the oil/);
    assert.match(chilli.steps.at(-1), /^Cook the rice/);
  });

  it('carries the source block across intact', async () => {
    const db = freshDatabase('seed.sql');
    const [chilli] = await loadRecipes(db);

    assert.equal(chilli.source.type, 'manual');
    assert.equal(chilli.source.url, null);
    assert.equal(chilli.source.creator, null);
    assert.equal(chilli.source.imported, '2026-09-05');
    assert.ok(chilli.source.captured_text.length > 0);
  });

  it('refuses a unit the shopping list could not convert', () => {
    const db = freshDatabase('seed.sql');
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO recipe_ingredients VALUES ('beef-chilli', 99, 'onion', 2, 'tbsp')`
        ),
      /constraint/i
    );
  });

  it('refuses a quantity of zero or less', () => {
    const db = freshDatabase('seed.sql');
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO recipe_ingredients VALUES ('beef-chilli', 98, 'onion', 0, 'each')`
        ),
      /constraint/i
    );
  });

  it('refuses an ingredient line with no recipe to belong to', () => {
    const db = freshDatabase('seed.sql');
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO recipe_ingredients VALUES ('no-such-recipe', 0, 'onion', 1, 'each')`
        ),
      /foreign key/i
    );
  });
});

describe('writing a recipe', () => {
  it('round-trips everything the form collects', async () => {
    const db = freshDatabase('seed.sql');
    await db.batch(insertRecipeStatements(db, sample));

    const [dhal] = await loadRecipes(db, 'lentil-dhal');
    assert.deepEqual(dhal, sample);
  });

  it('lands as one transaction, so a bad line takes the whole recipe with it', async () => {
    const db = freshDatabase('seed.sql');
    const broken = {
      ...sample,
      ingredients: [...sample.ingredients, { ingredient_id: 'onion', qty: 2, unit: 'tbsp' }],
    };

    await assert.rejects(() => db.batch(insertRecipeStatements(db, broken)));
    assert.deepEqual(await existingRecipeIds(db), ['beef-chilli']);
  });

  it('will not take an id that is already used', async () => {
    const db = freshDatabase('seed.sql');
    await assert.rejects(
      () => db.batch(insertRecipeStatements(db, { ...sample, id: 'beef-chilli' })),
      /UNIQUE|constraint/i
    );
  });

  it('lists the ids already in use, so a new one can avoid them', async () => {
    const db = freshDatabase('seed.sql');
    await db.batch(insertRecipeStatements(db, sample));
    assert.deepEqual((await existingRecipeIds(db)).sort(), ['beef-chilli', 'lentil-dhal']);
  });
});

describe('deleting a recipe', () => {
  it('takes its ingredient lines and its steps with it', async () => {
    const db = freshDatabase('seed.sql');
    await db.batch(insertRecipeStatements(db, sample));
    await db.batch(deleteRecipeStatements(db, 'lentil-dhal'));

    assert.deepEqual(await existingRecipeIds(db), ['beef-chilli']);
    const orphans = await db
      .prepare('SELECT recipe_id FROM recipe_ingredients WHERE recipe_id = ?')
      .bind('lentil-dhal')
      .all();
    assert.equal(orphans.results.length, 0);
    const steps = await db
      .prepare('SELECT recipe_id FROM recipe_steps WHERE recipe_id = ?')
      .bind('lentil-dhal')
      .all();
    assert.equal(steps.results.length, 0);
  });

  it('leaves the other recipes alone', async () => {
    const db = freshDatabase('seed.sql');
    await db.batch(insertRecipeStatements(db, sample));
    await db.batch(deleteRecipeStatements(db, 'lentil-dhal'));

    const [chilli] = await loadRecipes(db);
    assert.equal(chilli.ingredients.length, 10);
  });

  it('reports nothing changed when the recipe was not there', async () => {
    const db = freshDatabase('seed.sql');
    const results = await db.batch(deleteRecipeStatements(db, 'never-existed'));
    assert.equal(results.at(-1).meta.changes, 0);
  });
});
