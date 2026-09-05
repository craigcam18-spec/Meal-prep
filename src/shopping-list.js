/**
 * Shopping list: combine ingredient quantities across a week's recipes.
 *
 * Nothing here is stored. The list is rebuilt from ingredients.json +
 * recipes.json + the week plan every time, so a corrected ingredient shows up
 * everywhere at once.
 *
 * The fiddly bit is that two recipes can ask for the same ingredient in
 * different units — 500g of mince in one and 300g in another is easy, but
 * "1 onion" plus "150g onion" needs `purchase.unit_weight_g` to combine.
 */

import {
  assertKnownUnit,
  ceilWhole,
  fromGrams,
  isCountUnit,
  roundGrams,
  roundMillilitres,
  toGrams,
  toMillilitres,
} from './units.js';

function indexById(rows, what) {
  const index = new Map();
  for (const row of rows) {
    if (index.has(row.id)) {
      throw new Error(`Duplicate ${what} id "${row.id}".`);
    }
    index.set(row.id, row);
  }
  return index;
}

function asIndex(collection, what) {
  return collection instanceof Map ? collection : indexById(collection, what);
}

/**
 * Flatten a week plan into individual ingredient lines, each already scaled
 * from the recipe's own serving count to the number of servings you want.
 *
 * plan: [{ recipe_id, servings? }] — servings defaults to the recipe's own.
 *
 * Exported separately because per-meal nutrition needs exactly the same
 * scaled lines.
 */
export function expandPlan(plan, { ingredients, recipes }) {
  const ingredientIndex = asIndex(ingredients, 'ingredient');
  const recipeIndex = asIndex(recipes, 'recipe');
  const lines = [];

  for (const entry of plan) {
    const recipe = recipeIndex.get(entry.recipe_id);
    if (!recipe) {
      throw new Error(`Unknown recipe_id "${entry.recipe_id}".`);
    }
    if (!(recipe.servings > 0)) {
      throw new Error(`Recipe "${recipe.id}" has a non-positive servings count.`);
    }

    const servings = entry.servings ?? recipe.servings;
    if (!(servings > 0)) {
      throw new Error(
        `Planned servings for "${recipe.id}" must be greater than zero.`
      );
    }
    const scale = servings / recipe.servings;

    for (const line of recipe.ingredients) {
      const ingredient = ingredientIndex.get(line.ingredient_id);
      if (!ingredient) {
        throw new Error(
          `Recipe "${recipe.id}" references unknown ingredient_id "${line.ingredient_id}".`
        );
      }
      assertKnownUnit(line.unit, `${recipe.id} → ${line.ingredient_id}`);
      if (!(line.qty >= 0)) {
        throw new Error(
          `Recipe "${recipe.id}" has a negative or non-numeric qty for "${line.ingredient_id}".`
        );
      }

      lines.push({
        ingredient,
        recipe_id: recipe.id,
        recipe_name: recipe.name,
        servings,
        qty: line.qty * scale,
        unit: line.unit,
      });
    }
  }

  return lines;
}

/**
 * Reduce the scaled lines for one ingredient to what you actually write down.
 *
 * Everything convertible goes into a single gram total and is then expressed
 * in the ingredient's own `purchase.unit` — grams for things you buy by
 * weight, whole items for things you buy by the item.
 *
 * When an ingredient is counted but has no `unit_weight_g` — or measured by
 * volume with no `density_g_per_ml` — those lines cannot join the gram total.
 * Rather than inventing a weight, they stay a separate part of the same line
 * and `needs_unit_weight` / `needs_density` say which figure is missing.
 */
function mergeIngredient(ingredient, lines) {
  let grams = 0;
  let unconvertedCount = 0;
  let unconvertedMl = 0;
  let hasGrams = false;

  for (const line of lines) {
    const asGrams = toGrams(line.qty, line.unit, ingredient);
    if (asGrams !== null) {
      grams += asGrams;
      hasGrams = true;
    } else if (isCountUnit(line.unit)) {
      unconvertedCount += line.qty;
    } else {
      unconvertedMl += toMillilitres(line.qty, line.unit);
    }
  }

  const needsUnitWeight = unconvertedCount > 0;
  const needsDensity = unconvertedMl > 0;
  const displayUnit = ingredient.purchase?.unit === 'each' ? 'each' : 'g';
  const parts = [];

  let totalG = null;
  let qty = null;
  let unit = null;
  let exactQty = null;

  if (!needsUnitWeight && !needsDensity) {
    // The normal case: one number, in the unit you buy the thing in.
    totalG = roundGrams(grams);
    if (displayUnit === 'each') {
      exactQty = fromGrams(grams, 'each', ingredient);
      qty = ceilWhole(exactQty);
    } else {
      exactQty = totalG;
      qty = totalG;
    }
    unit = displayUnit;
    parts.push({ qty, unit });
  } else {
    // Lines we could not weigh. Keep them honest and separate rather than
    // folding them into a gram total that would be a guess.
    if (hasGrams) parts.push({ qty: roundGrams(grams), unit: 'g' });
    if (needsUnitWeight) {
      parts.push({ qty: ceilWhole(unconvertedCount), unit: 'each' });
    }
    if (needsDensity) {
      parts.push({ qty: roundMillilitres(unconvertedMl), unit: 'ml' });
    }

    // Only one part means there is still a single number to write down, even
    // though it is not in the unit you buy the thing in.
    if (parts.length === 1) {
      qty = parts[0].qty;
      unit = parts[0].unit;
      exactQty = needsUnitWeight ? unconvertedCount : unconvertedMl;
    }
  }

  return {
    ingredient_id: ingredient.id,
    name: ingredient.name,
    category: ingredient.category,
    qty,
    unit,
    exact_qty: exactQty,
    total_g: totalG,
    parts,
    needs_unit_weight: needsUnitWeight,
    needs_density: needsDensity,
    sources: lines.map((line) => ({
      recipe_id: line.recipe_id,
      recipe_name: line.recipe_name,
      servings: line.servings,
      qty: roundGrams(line.qty),
      unit: line.unit,
    })),
  };
}

/**
 * Build the merged shopping list for a week plan.
 *
 * Returns one entry per ingredient, sorted by category then name so the
 * aisle-grouped screen has something sensible to work with.
 */
export function buildShoppingList(plan, { ingredients, recipes }) {
  const lines = expandPlan(plan, { ingredients, recipes });

  const grouped = new Map();
  for (const line of lines) {
    const existing = grouped.get(line.ingredient.id);
    if (existing) {
      existing.push(line);
    } else {
      grouped.set(line.ingredient.id, [line]);
    }
  }

  const list = [];
  for (const [, group] of grouped) {
    list.push(mergeIngredient(group[0].ingredient, group));
  }

  return list.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  );
}

/**
 * Group a built list by category, ready for the aisle-by-aisle screen.
 */
export function groupByCategory(list) {
  const groups = new Map();
  for (const item of list) {
    const bucket = groups.get(item.category);
    if (bucket) bucket.push(item);
    else groups.set(item.category, [item]);
  }
  return groups;
}

/**
 * Ingredients on the list that would merge more cleanly with a
 * `purchase.unit_weight_g` filled in. The data-quality nag list.
 */
export function missingUnitWeights(list) {
  return list.filter((item) => item.needs_unit_weight).map((item) => item.ingredient_id);
}

/**
 * The same nag list for `purchase.density_g_per_ml`: ingredients a recipe
 * asked for in millilitres that nobody has weighed a millilitre of.
 */
export function missingDensities(list) {
  return list.filter((item) => item.needs_density).map((item) => item.ingredient_id);
}
