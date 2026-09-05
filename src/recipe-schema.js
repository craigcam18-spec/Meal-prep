/**
 * The recipe shape, in one place.
 *
 * Recipes live in D1 now (DATA_MODEL.md §2), which means the same rules have
 * to hold in three places: the Pages Function that writes a row, the form
 * that collects one, and the tests. Rather than write them three times and
 * watch them drift, everything here is a pure function over plain objects —
 * no D1, no DOM, no fetch — and all three import it.
 *
 * The JSON shape it produces and accepts is exactly the one data/recipes.json
 * used to hold, so the shopping-list code did not have to change at all.
 */

import { KNOWN_UNITS, isKnownUnit } from './units.js';

/** Slug-shaped, as ids have been since ingredients.json. */
export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Where a recipe came from. `manual` means you typed it in yourself. */
export const SOURCE_TYPES = Object.freeze([
  'manual',
  'instagram',
  'tiktok',
  'youtube',
  'web',
  'book',
]);

/** Nothing sane needs more, and it caps what one request can write. */
export const LIMITS = Object.freeze({
  name: 120,
  servings: 24,
  ingredients: 60,
  steps: 40,
  step: 1000,
  captured_text: 20000,
  url: 2000,
  creator: 120,
});

/**
 * "Beef chilli" -> "beef-chilli". Anything that is not a letter or digit
 * becomes a separator, so accents and punctuation cannot produce an id the
 * ID_PATTERN would then reject.
 */
export function slugify(name) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'recipe';
}

/**
 * A free id based on `name`, avoiding everything in `taken`.
 *
 * Two "Beef chilli"s are a thing that happens — one from a Reel, one from a
 * book — so the second becomes `beef-chilli-2` rather than being refused.
 */
export function uniqueId(name, taken) {
  const has = (id) => (taken instanceof Set ? taken.has(id) : taken.includes(id));
  const base = slugify(name);
  if (!has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!has(candidate)) return candidate;
  }
}

/** Today as yyyy-mm-dd, in local time — UTC shifts the day either side of midnight. */
export function today(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Check a recipe submitted by the form.
 *
 * Returns `{ errors, recipe }` rather than throwing: the form wants to show
 * every problem at once, and the API wants to put them all in one 400. An
 * empty `errors` means `recipe` is safe to write.
 *
 * `ingredientIds` is the set of ids in data/ingredients.json. It is required,
 * not optional-with-a-skip, because an unknown ingredient_id does not fail
 * quietly later — expandPlan throws on it and takes the whole week's shopping
 * list down with it.
 */
export function validateRecipe(input, { ingredientIds, existingIds = [] } = {}) {
  const errors = [];
  const known = ingredientIds instanceof Set ? ingredientIds : new Set(ingredientIds ?? []);
  if (known.size === 0) {
    throw new Error('validateRecipe needs the ingredient ids to check against.');
  }

  if (!input || typeof input !== 'object') {
    return { errors: ['Nothing to save.'], recipe: null };
  }

  const name = text(input.name);
  if (!name) errors.push('Give the recipe a name.');
  else if (name.length > LIMITS.name) {
    errors.push(`The name is too long (max ${LIMITS.name} characters).`);
  }

  const servings = Number(input.servings);
  if (!Number.isInteger(servings) || servings < 1 || servings > LIMITS.servings) {
    errors.push(`Servings must be a whole number between 1 and ${LIMITS.servings}.`);
  }

  const rawLines = Array.isArray(input.ingredients) ? input.ingredients : [];
  if (rawLines.length === 0) errors.push('Add at least one ingredient.');
  if (rawLines.length > LIMITS.ingredients) {
    errors.push(`That is more than ${LIMITS.ingredients} ingredients.`);
  }

  const ingredients = [];
  const seen = new Set();
  for (const [index, raw] of rawLines.entries()) {
    const where = `Ingredient ${index + 1}`;
    const ingredientId = text(raw?.ingredient_id);
    const qty = Number(raw?.qty);
    const unit = text(raw?.unit);

    if (!ingredientId) {
      errors.push(`${where}: pick an ingredient.`);
    } else if (!known.has(ingredientId)) {
      // Not "unknown ingredient" — the fix is to add it to the file.
      errors.push(`${where}: "${ingredientId}" is not in ingredients.json.`);
    } else if (seen.has(ingredientId)) {
      // Two lines for the same thing would merge on the shopping list anyway,
      // and reads as a slip while you are typing it in.
      errors.push(`${where}: ${ingredientId} is already on the list.`);
    } else {
      seen.add(ingredientId);
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`${where}: the quantity must be more than zero.`);
    }
    if (!isKnownUnit(unit)) {
      errors.push(`${where}: "${unit}" is not a unit we can convert (${KNOWN_UNITS.join(', ')}).`);
    }

    ingredients.push({ ingredient_id: ingredientId, qty, unit });
  }

  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps = rawSteps.map(text).filter((step) => step.length > 0);
  if (steps.length === 0) errors.push('Add at least one step.');
  if (steps.length > LIMITS.steps) errors.push(`That is more than ${LIMITS.steps} steps.`);
  if (steps.some((step) => step.length > LIMITS.step)) {
    errors.push(`One of the steps is longer than ${LIMITS.step} characters.`);
  }

  const source = validateSource(input.source, errors);

  if (errors.length > 0) return { errors, recipe: null };

  return {
    errors,
    recipe: {
      // Always derived, never taken from the request: an id chosen by the
      // caller could collide with one already stored, and a primary key
      // violation is a 500 where this is a well-mannered `-2` suffix.
      id: uniqueId(name, existingIds),
      name,
      servings,
      ingredients,
      steps,
      source,
    },
  };
}

function validateSource(raw, errors) {
  const type = text(raw?.type) || 'manual';
  if (!SOURCE_TYPES.includes(type)) {
    errors.push(`"${type}" is not a source type (${SOURCE_TYPES.join(', ')}).`);
  }

  const url = text(raw?.url);
  if (url && !/^https?:\/\//i.test(url)) {
    errors.push('The source URL should start with http:// or https://.');
  }
  if (url.length > LIMITS.url) errors.push('The source URL is too long.');

  const creator = text(raw?.creator);
  if (creator.length > LIMITS.creator) errors.push('The creator name is too long.');

  const capturedText = typeof raw?.captured_text === 'string' ? raw.captured_text.trim() : '';
  if (capturedText.length > LIMITS.captured_text) {
    errors.push('The captured text is too long.');
  }
  // The whole argument for storing a source (DATA_MODEL.md §2) is that the URL
  // rots and the text does not. So an imported recipe has to carry the text;
  // one you typed in yourself never had any, and '' is the honest answer.
  if (type !== 'manual' && !capturedText) {
    errors.push(
      'Paste the original text as well as the link — links rot, and the text is the backup.'
    );
  }

  const imported = text(raw?.imported);
  return {
    type,
    url: url || null,
    creator: creator || null,
    captured_text: capturedText,
    imported: ISO_DATE.test(imported) ? imported : today(),
  };
}

/* ------------------------------------------------------------ rows <-> json */

/** One recipe as the columns of the three tables. */
export function recipeToRows(recipe) {
  return {
    recipe: {
      id: recipe.id,
      name: recipe.name,
      servings: recipe.servings,
      source_type: recipe.source.type,
      source_url: recipe.source.url,
      source_creator: recipe.source.creator,
      source_captured_text: recipe.source.captured_text,
      source_imported: recipe.source.imported,
    },
    ingredients: recipe.ingredients.map((line, position) => ({
      recipe_id: recipe.id,
      position,
      ingredient_id: line.ingredient_id,
      qty: line.qty,
      unit: line.unit,
    })),
    steps: recipe.steps.map((step, position) => ({
      recipe_id: recipe.id,
      position,
      text: step,
    })),
  };
}

/**
 * Stitch the three result sets back into the recipe JSON the app expects.
 *
 * Three flat queries and a join in memory, rather than one query per recipe:
 * the whole cookbook is a few hundred rows, and D1 charges per round trip.
 * Callers are expected to have ordered the child rows by `position` — SQL has
 * no row order of its own, and step 3 before step 1 is a broken recipe.
 */
export function rowsToRecipes({ recipes, ingredients, steps }) {
  const byId = new Map();
  const out = [];

  for (const row of recipes) {
    const recipe = {
      id: row.id,
      name: row.name,
      servings: row.servings,
      ingredients: [],
      steps: [],
      source: {
        type: row.source_type,
        url: row.source_url ?? null,
        creator: row.source_creator ?? null,
        captured_text: row.source_captured_text ?? '',
        imported: row.source_imported,
      },
    };
    byId.set(row.id, recipe);
    out.push(recipe);
  }

  for (const row of ingredients) {
    byId.get(row.recipe_id)?.ingredients.push({
      ingredient_id: row.ingredient_id,
      qty: row.qty,
      unit: row.unit,
    });
  }

  for (const row of steps) {
    byId.get(row.recipe_id)?.steps.push(row.text);
  }

  return out;
}
