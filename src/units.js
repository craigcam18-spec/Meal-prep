/**
 * Unit primitives for the shopping list.
 *
 * The data model recognises three kinds of unit:
 *
 *   weight  - `g`, `kg`. Always interconvertible.
 *   count   - `each`. Only convertible to weight when the ingredient
 *             carries `purchase.unit_weight_g` (the "1 onion" problem).
 *   volume  - `ml`, `l`. Only convertible to weight when the ingredient
 *             carries `purchase.density_g_per_ml` (the "200ml milk" problem).
 *
 * Grams are the canonical unit. Everything that can be reduced to grams is,
 * because that is what nutrition maths needs (`qty / 100 * per_100g`).
 *
 * Density is a real measured property, not a guess: 1ml of olive oil is
 * 0.91g and nothing about the recipe changes that. Where no density is on
 * file the field stays null and the millilitres stay millilitres, exactly
 * like a count with no `unit_weight_g` — a gap to fill in, never a number
 * to invent.
 */

/** Weight units and how many grams one of them is. */
export const WEIGHT_UNITS = Object.freeze({ g: 1, kg: 1000 });

/** Volume units and how many millilitres one of them is. */
export const VOLUME_UNITS = Object.freeze({ ml: 1, l: 1000 });

/** Units that count whole items rather than measuring mass. */
export const COUNT_UNITS = Object.freeze(['each']);

/** Every unit a recipe line is allowed to use. */
export const KNOWN_UNITS = Object.freeze([
  ...Object.keys(WEIGHT_UNITS),
  ...Object.keys(VOLUME_UNITS),
  ...COUNT_UNITS,
]);

/**
 * Floating point slack. 1.5 * 2 is 3.0000000000000004 in IEEE 754, and without
 * a tolerance that rounds up to 4 onions. Small enough never to mask a real
 * fractional remainder.
 */
const EPSILON = 1e-9;

export function isWeightUnit(unit) {
  return Object.hasOwn(WEIGHT_UNITS, unit);
}

export function isVolumeUnit(unit) {
  return Object.hasOwn(VOLUME_UNITS, unit);
}

export function isCountUnit(unit) {
  return COUNT_UNITS.includes(unit);
}

export function isKnownUnit(unit) {
  return isWeightUnit(unit) || isVolumeUnit(unit) || isCountUnit(unit);
}

export function assertKnownUnit(unit, context = '') {
  if (!isKnownUnit(unit)) {
    const where = context ? ` (${context})` : '';
    throw new Error(
      `Unknown unit "${unit}"${where}. Expected one of: ${KNOWN_UNITS.join(', ')}.`
    );
  }
}

/**
 * How many grams one `each` of this ingredient weighs, or null if unknown.
 */
export function unitWeightOf(ingredient) {
  const w = ingredient?.purchase?.unit_weight_g;
  return typeof w === 'number' && w > 0 ? w : null;
}

/**
 * How many grams one millilitre of this ingredient weighs, or null if nobody
 * has looked it up. Null is the honest default: only a real density goes in.
 */
export function densityOf(ingredient) {
  const d = ingredient?.purchase?.density_g_per_ml;
  return typeof d === 'number' && d > 0 ? d : null;
}

/** Millilitres in a volume quantity. Throws if `unit` is not a volume unit. */
export function toMillilitres(qty, unit) {
  if (!isVolumeUnit(unit)) {
    throw new Error(`"${unit}" is not a volume unit.`);
  }
  return qty * VOLUME_UNITS[unit];
}

/**
 * Convert a quantity to grams.
 *
 * Returns null — not an error — when the conversion is genuinely impossible:
 * a count of an ingredient with no `unit_weight_g`, or a volume of one with
 * no `density_g_per_ml`. That is missing data to be surfaced, not a bug to
 * crash on. Unknown units do throw.
 */
export function toGrams(qty, unit, ingredient) {
  assertKnownUnit(unit, ingredient?.id);
  if (isWeightUnit(unit)) return qty * WEIGHT_UNITS[unit];

  if (isVolumeUnit(unit)) {
    const density = densityOf(ingredient);
    return density === null ? null : toMillilitres(qty, unit) * density;
  }

  const unitWeight = unitWeightOf(ingredient);
  return unitWeight === null ? null : qty * unitWeight;
}

/**
 * Convert grams back into `unit`. Returns null when the ingredient is missing
 * the figure that conversion needs.
 */
export function fromGrams(grams, unit, ingredient) {
  assertKnownUnit(unit, ingredient?.id);
  if (isWeightUnit(unit)) return grams / WEIGHT_UNITS[unit];

  if (isVolumeUnit(unit)) {
    const density = densityOf(ingredient);
    return density === null ? null : grams / density / VOLUME_UNITS[unit];
  }

  const unitWeight = unitWeightOf(ingredient);
  return unitWeight === null ? null : grams / unitWeight;
}

/**
 * Round up to a whole item. You cannot buy 2.4 onions, so 2.4 means 3 — but
 * 3.0000000000000004 still means 3.
 */
export function ceilWhole(qty) {
  return Math.ceil(qty - EPSILON);
}

/** Round grams to 0.1g, which also clears float noise like 0.30000000000000004. */
export function roundGrams(grams) {
  return Math.round(grams * 10) / 10;
}

/** Round millilitres to 0.1ml, on the same reasoning as roundGrams. */
export function roundMillilitres(ml) {
  return Math.round(ml * 10) / 10;
}

/**
 * Human-readable quantity for one shopping list part. Grams roll up into kg
 * past 1000g and millilitres into litres past 1000ml, because "1.5kg mince"
 * reads better than "1500g mince".
 */
export function formatQuantity(qty, unit) {
  if (unit === 'each') return String(qty);

  if (isVolumeUnit(unit)) {
    const ml = toMillilitres(qty, unit);
    if (ml >= 1000) return `${Math.round((ml / 1000) * 100) / 100}L`;
    return `${roundMillilitres(ml)}ml`;
  }

  const grams = unit === 'kg' ? qty * 1000 : qty;
  if (grams >= 1000) return `${Math.round((grams / 1000) * 100) / 100}kg`;
  return `${roundGrams(grams)}g`;
}
