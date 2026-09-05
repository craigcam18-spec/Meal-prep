/**
 * The week plan: which meals, on which days, and what has been ticked off.
 *
 * This is the one piece of state that lives in the browser rather than the
 * repo. It is personal, it changes daily, and it is per-device — see
 * DATA_MODEL.md §3. The stored shape is exactly the one documented there:
 *
 *   { week_of, meals: [{ recipe_id, servings, day }], ticked_off: [...] }
 *
 * Meals have no id of their own, so the UI addresses them by index. That
 * keeps what is written to localStorage identical to what the data model
 * says, rather than adding a key only the UI cares about.
 */

const KEY = 'mealprep.week.v1';

export const DAYS = Object.freeze([
  { id: 'mon', short: 'Mon', long: 'Monday' },
  { id: 'tue', short: 'Tue', long: 'Tuesday' },
  { id: 'wed', short: 'Wed', long: 'Wednesday' },
  { id: 'thu', short: 'Thu', long: 'Thursday' },
  { id: 'fri', short: 'Fri', long: 'Friday' },
  { id: 'sat', short: 'Sat', long: 'Saturday' },
  { id: 'sun', short: 'Sun', long: 'Sunday' },
]);

const DAY_IDS = DAYS.map((d) => d.id);

/**
 * Safari in private browsing has historically thrown on localStorage rather
 * than just returning nothing, and a shopping list that white-screens in the
 * shop is worse than one that forgets. Every access goes through here, and a
 * failure downgrades to memory-only for the session.
 */
let memoryFallback = null;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memoryFallback;
  }
}

function writeRaw(value) {
  memoryFallback = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* Memory-only for this session. Nothing else to do about it. */
  }
}

/** `yyyy-mm-dd` for a Date, in local time — not UTC, which shifts the day. */
export function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse `yyyy-mm-dd` as a local date, for the same reason. */
export function parseIsoDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The Monday on or before `date`. Weeks start on Monday here. */
export function mondayOf(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return isoDate(start);
}

export function addWeeks(iso, count) {
  const date = parseIsoDate(iso) ?? new Date();
  date.setDate(date.getDate() + count * 7);
  return isoDate(date);
}

export function emptyPlan(weekOf = mondayOf(new Date())) {
  return { week_of: weekOf, meals: [], ticked_off: [] };
}

/**
 * Coerce whatever is in storage into a plan we can render.
 *
 * Anything unrecognised is dropped rather than repaired. A half-understood
 * plan that silently changes your shopping list is worse than an empty one.
 */
function normalise(value) {
  if (!value || typeof value !== 'object') return emptyPlan();

  const weekOf =
    typeof value.week_of === 'string' && parseIsoDate(value.week_of)
      ? value.week_of
      : mondayOf(new Date());

  const meals = Array.isArray(value.meals)
    ? value.meals
        .filter((meal) => meal && typeof meal.recipe_id === 'string')
        .map((meal) => ({
          recipe_id: meal.recipe_id,
          servings: Number.isFinite(meal.servings) && meal.servings > 0
            ? Math.round(meal.servings)
            : null,
          day: DAY_IDS.includes(meal.day) ? meal.day : null,
        }))
    : [];

  const tickedOff = Array.isArray(value.ticked_off)
    ? [...new Set(value.ticked_off.filter((id) => typeof id === 'string'))]
    : [];

  return { week_of: weekOf, meals, ticked_off: tickedOff };
}

export function loadPlan() {
  const raw = readRaw();
  if (!raw) return emptyPlan();
  try {
    return normalise(JSON.parse(raw));
  } catch {
    return emptyPlan();
  }
}

export function savePlan(plan) {
  writeRaw(JSON.stringify(plan));
  return plan;
}

/**
 * Drop ticks for ingredients that are no longer on the list, so a tick can
 * never outlive the meal that put the ingredient there.
 */
export function pruneTicks(plan, list) {
  const onList = new Set(list.map((item) => item.ingredient_id));
  const kept = plan.ticked_off.filter((id) => onList.has(id));
  if (kept.length === plan.ticked_off.length) return plan;
  return savePlan({ ...plan, ticked_off: kept });
}

/** Sort key putting Monday first and undated meals last. */
export function dayOrder(day) {
  const index = DAY_IDS.indexOf(day);
  return index === -1 ? DAY_IDS.length : index;
}

/** "Mon 8 – Sun 14 Sep" for the week starting `iso`. */
export function formatWeekRange(iso) {
  const start = parseIsoDate(iso);
  if (!start) return '';
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  // The weekday names are fixed — the week always runs Monday to Sunday —
  // so only the month needs the locale, and the order stays put whatever it
  // returns.
  const month = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  const sameMonth = start.getMonth() === end.getMonth();

  return sameMonth
    ? `Mon ${start.getDate()} – Sun ${end.getDate()} ${month(end)}`
    : `Mon ${start.getDate()} ${month(start)} – Sun ${end.getDate()} ${month(end)}`;
}
