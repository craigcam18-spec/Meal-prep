/**
 * /api/recipes — list and create.
 *
 * A Cloudflare Pages Function. `env.DB` is the D1 binding; README.md lists the
 * dashboard clicks that create it. The SQL lives in src/recipes-store.js and
 * the recipe shape in src/recipe-schema.js, both shared with the tests and
 * (for the shape) with the form, so the three cannot drift apart.
 */

import { json } from '../../src/http.js';
import { validateRecipe } from '../../src/recipe-schema.js';
import {
  existingRecipeIds,
  insertRecipeStatements,
  loadRecipes,
  missingDatabase,
} from '../../src/recipes-store.js';

/**
 * The ingredient ids a recipe line is allowed to reference.
 *
 * data/ingredients.json stays in git (DATA_MODEL.md §1), so this reads it back
 * off the site itself rather than out of the database.
 */
async function ingredientIds(request) {
  const response = await fetch(new URL('/data/ingredients.json', request.url));
  if (!response.ok) throw new Error(`ingredients.json: ${response.status}`);
  const ingredients = await response.json();
  return new Set(ingredients.map((ingredient) => ingredient.id));
}

export async function onRequestGet({ env }) {
  const missing = missingDatabase(env);
  if (missing) return json({ errors: [missing] }, 503);

  return json(await loadRecipes(env.DB));
}

export async function onRequestPost({ env, request }) {
  const missing = missingDatabase(env);
  if (missing) return json({ errors: [missing] }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ errors: ['That was not JSON.'] }, 400);
  }

  // A failed read of ingredients.json is a 503, not a skipped check: a recipe
  // pointing at an ingredient that does not exist does not fail quietly later,
  // it throws in expandPlan and takes the whole week's shopping list with it.
  let known;
  try {
    known = await ingredientIds(request);
  } catch (error) {
    return json(
      { errors: [`Could not read the ingredient list to check against (${error.message}).`] },
      503
    );
  }

  const { errors, recipe } = validateRecipe(body, {
    ingredientIds: known,
    existingIds: await existingRecipeIds(env.DB),
  });
  if (errors.length > 0) return json({ errors }, 400);

  await env.DB.batch(insertRecipeStatements(env.DB, recipe));

  return json(recipe, 201, { location: `/api/recipes/${recipe.id}` });
}
