/**
 * Small hand-built dataset. Deliberately not the real data files — merging
 * behaviour should be pinned by numbers chosen to exercise it, not by
 * whatever happens to be in ingredients.json this week.
 */

export const ingredients = [
  ingredient('beef-mince-5', 'Beef mince, 5% fat', 'meat', { unit: 'g' }),
  // Bought by the item, and we know what one weighs: fully interconvertible.
  ingredient('onion', 'Onion', 'produce', { unit: 'each', unit_weight_g: 150 }),
  ingredient('garlic', 'Garlic', 'produce', { unit: 'each', unit_weight_g: 3 }),
  // Bought by weight, but we still know what one weighs.
  ingredient('chopped-tomatoes', 'Chopped tomatoes', 'tinned', {
    unit: 'g',
    unit_weight_g: 400,
  }),
  ingredient('potato', 'Potatoes', 'produce', { unit: 'g', unit_weight_g: 180 }),
  // Counted in recipes, but nobody has said what one weighs.
  ingredient('lemon', 'Lemon', 'produce', { unit: 'each' }),
  ingredient('rice-basmati', 'Basmati rice', 'grains', { unit: 'g' }),
];

export const recipes = [
  recipe('beef-chilli', 'Beef chilli', 4, [
    { ingredient_id: 'beef-mince-5', qty: 500, unit: 'g' },
    { ingredient_id: 'onion', qty: 1, unit: 'each' },
    { ingredient_id: 'garlic', qty: 3, unit: 'each' },
    { ingredient_id: 'chopped-tomatoes', qty: 400, unit: 'g' },
    { ingredient_id: 'rice-basmati', qty: 300, unit: 'g' },
  ]),
  recipe('bolognese', 'Bolognese', 2, [
    { ingredient_id: 'beef-mince-5', qty: 300, unit: 'g' },
    { ingredient_id: 'onion', qty: 150, unit: 'g' },
    { ingredient_id: 'chopped-tomatoes', qty: 1, unit: 'each' },
  ]),
  recipe('lemon-chicken', 'Lemon chicken', 2, [
    { ingredient_id: 'lemon', qty: 1, unit: 'each' },
    { ingredient_id: 'potato', qty: 2, unit: 'each' },
  ]),
];

function ingredient(id, name, category, purchase) {
  return {
    id,
    name,
    aliases: [],
    category,
    nutrition: {
      kcal_per_100g: 100,
      protein_per_100g: 10,
      source: 'cofid',
      source_detail: 'fixture',
      updated: '2026-09-05',
    },
    purchase: {
      barcode: null,
      unit: purchase.unit,
      unit_weight_g: purchase.unit_weight_g ?? null,
      pack_size_g: purchase.pack_size_g ?? null,
    },
  };
}

function recipe(id, name, servings, lines) {
  return {
    id,
    name,
    servings,
    ingredients: lines,
    steps: ['Cook it.'],
    source: {
      type: 'manual',
      url: null,
      creator: null,
      captured_text: 'fixture',
      imported: '2026-09-05',
    },
  };
}

/** Pull one line out of a built list, failing loudly if it isn't there. */
export function line(list, ingredientId) {
  const found = list.find((item) => item.ingredient_id === ingredientId);
  if (!found) {
    throw new Error(
      `Expected "${ingredientId}" on the list. Got: ${list
        .map((i) => i.ingredient_id)
        .join(', ')}`
    );
  }
  return found;
}
