/**
 * /api/recipes/:id — read one, delete one.
 */

import { json } from '../../../src/http.js';
import {
  deleteRecipeStatements,
  loadRecipes,
  missingDatabase,
} from '../../../src/recipes-store.js';

export async function onRequestGet({ env, params }) {
  const missing = missingDatabase(env);
  if (missing) return json({ errors: [missing] }, 503);

  const [recipe] = await loadRecipes(env.DB, params.id);
  if (!recipe) return json({ errors: ['No such recipe.'] }, 404);
  return json(recipe);
}

export async function onRequestDelete({ env, params }) {
  const missing = missingDatabase(env);
  if (missing) return json({ errors: [missing] }, 503);

  // The last statement is the one whose `changes` says whether it was there.
  const results = await env.DB.batch(deleteRecipeStatements(env.DB, params.id));

  if (results.at(-1).meta.changes === 0) {
    return json({ errors: ['No such recipe.'] }, 404);
  }
  return json({ id: params.id, deleted: true });
}
