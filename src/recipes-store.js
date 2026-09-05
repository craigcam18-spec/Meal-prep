/**
 * Reading and writing recipes in D1.
 *
 * Shared by the two Pages Functions under `functions/api/` and by the tests,
 * which run the same queries against an in-memory SQLite database. That is
 * the point of the split: the SQL is exercised by `npm test` rather than only
 * ever running in production.
 *
 * Everything here takes the D1 binding as an argument. Nothing reaches for a
 * global, so a stand-in that implements `prepare`/`bind`/`all`/`batch` works
 * just as well as the real thing.
 */

import { recipeToRows, rowsToRecipes } from './recipe-schema.js';

/**
 * Why there is no database, or null if there is one.
 *
 * A string rather than a Response so this module stays free of HTTP; the
 * routes turn it into a 503. This is the error you get when the D1 database
 * exists but nobody has bound it to the Pages project yet, which is the one
 * setup step that has to happen in the dashboard — so the message says so.
 */
export function missingDatabase(env) {
  if (env?.DB) return null;
  return (
    'No database bound. The Pages project needs a D1 binding named DB ' +
    '(dashboard → the project → Settings → Bindings → Add → D1 database).'
  );
}

/**
 * Every recipe, or just one, in the JSON shape data/recipes.json used to hold.
 *
 * Three flat queries rather than one per recipe: the whole cookbook is a few
 * hundred rows and D1 charges by the round trip. The ORDER BYs are load
 * bearing — SQL has no row order of its own, and step 3 before step 1 is a
 * broken recipe.
 */
export async function loadRecipes(db, id = null) {
  const where = id === null ? '' : ' WHERE recipe_id = ?';
  const bindings = id === null ? [] : [id];

  const [recipes, ingredients, steps] = await db.batch([
    db
      .prepare(
        `SELECT id, name, servings, source_type, source_url, source_creator,
                source_captured_text, source_imported
           FROM recipes${id === null ? '' : ' WHERE id = ?'}
          ORDER BY name`
      )
      .bind(...bindings),
    db
      .prepare(
        `SELECT recipe_id, ingredient_id, qty, unit
           FROM recipe_ingredients${where}
          ORDER BY recipe_id, position`
      )
      .bind(...bindings),
    db
      .prepare(
        `SELECT recipe_id, text
           FROM recipe_steps${where}
          ORDER BY recipe_id, position`
      )
      .bind(...bindings),
  ]);

  return rowsToRecipes({
    recipes: recipes.results,
    ingredients: ingredients.results,
    steps: steps.results,
  });
}

/** The ids already in use, so a new recipe can be given one that is not. */
export async function existingRecipeIds(db) {
  const { results } = await db.prepare('SELECT id FROM recipes').all();
  return results.map((row) => row.id);
}

/**
 * The statements that write one validated recipe.
 *
 * Returned rather than run so the caller can hand the whole lot to
 * `db.batch()`, which D1 runs as a single transaction — a recipe never lands
 * without its ingredients.
 */
export function insertRecipeStatements(db, recipe) {
  const rows = recipeToRows(recipe);

  const insertIngredient = db.prepare(
    `INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, qty, unit)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertStep = db.prepare(
    'INSERT INTO recipe_steps (recipe_id, position, text) VALUES (?, ?, ?)'
  );

  return [
    db
      .prepare(
        `INSERT INTO recipes
           (id, name, servings, source_type, source_url, source_creator,
            source_captured_text, source_imported)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        rows.recipe.id,
        rows.recipe.name,
        rows.recipe.servings,
        rows.recipe.source_type,
        rows.recipe.source_url,
        rows.recipe.source_creator,
        rows.recipe.source_captured_text,
        rows.recipe.source_imported
      ),
    ...rows.ingredients.map((line) =>
      insertIngredient.bind(line.recipe_id, line.position, line.ingredient_id, line.qty, line.unit)
    ),
    ...rows.steps.map((step) => insertStep.bind(step.recipe_id, step.position, step.text)),
  ];
}

/**
 * The statements that remove one recipe, children first.
 *
 * Explicit rather than leaning on ON DELETE CASCADE: foreign keys are only
 * enforced when the connection has them switched on, and orphaned ingredient
 * rows would stay invisible until the day something reused the id. The last
 * statement is the one whose `changes` says whether the recipe existed.
 */
export function deleteRecipeStatements(db, id) {
  return [
    db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').bind(id),
    db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').bind(id),
    db.prepare('DELETE FROM recipes WHERE id = ?').bind(id),
  ];
}
