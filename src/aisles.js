/**
 * Aisle order for the shopping list.
 *
 * Categories come off the ingredient, but the order they appear in is a
 * property of the shop, not the data: you want to walk the list top to
 * bottom without doubling back. Fruit and veg first, freezer last.
 *
 * A category with no entry here is not an error — it is a category added to
 * ingredients.json since this list was written. Those sort to the end under
 * their own name rather than vanishing.
 */
const AISLE_ORDER = [
  ['produce', 'Fruit & veg'],
  ['bakery', 'Bakery'],
  ['meat', 'Meat'],
  ['fish', 'Fish'],
  ['dairy', 'Dairy & chilled'],
  ['tinned', 'Tins & jars'],
  ['grains', 'Rice, pasta & grains'],
  ['store-cupboard', 'Store cupboard'],
  ['spices', 'Herbs & spices'],
  ['drinks', 'Drinks'],
  ['household', 'Household'],
  ['frozen', 'Frozen'],
];

const LABELS = new Map(AISLE_ORDER);
const RANK = new Map(AISLE_ORDER.map(([id], i) => [id, i]));

/** "store-cupboard" -> "Store cupboard", for a category nobody has named. */
function titleCase(category) {
  const words = String(category).replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Other';
}

export function aisleLabel(category) {
  return LABELS.get(category) ?? titleCase(category);
}

/**
 * Turn a built shopping list into aisle sections, in shop-walking order.
 *
 * Takes the Map from `groupByCategory` so the grouping itself stays in
 * shopping-list.js — this only decides what order the aisles come in and
 * what they are called.
 */
export function toAisles(groups) {
  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      label: aisleLabel(category),
      items,
    }))
    .sort((a, b) => {
      const rankA = RANK.get(a.category) ?? Number.MAX_SAFE_INTEGER;
      const rankB = RANK.get(b.category) ?? Number.MAX_SAFE_INTEGER;
      return rankA - rankB || a.label.localeCompare(b.label);
    });
}
