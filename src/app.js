/**
 * The three screens: pick your week, the shopping list, and add a recipe.
 *
 * No build step: this is an ES module the browser loads directly, importing
 * the same shopping-list code the tests run against. The list is never
 * stored — it is rebuilt by `buildShoppingList` from the ingredients, the
 * recipes and the week plan on every render, which is what lets a corrected
 * ingredient show up everywhere at once (DATA_MODEL.md §4).
 *
 * Where those three come from is now three different places, which is the
 * whole of DATA_MODEL.md §0: ingredients from a file in git, recipes from D1
 * over /api/recipes, the week plan from localStorage.
 */

import { toAisles } from './aisles.js';
import { button, node, replace } from './dom.js';
import { createRecipeForm } from './recipe-form.js';
import { createRecipe, deleteRecipe, listRecipes } from './recipes-client.js';
import { buildShoppingList, groupByCategory } from './shopping-list.js';
import { formatQuantity } from './units.js';
import {
  DAYS,
  addWeeks,
  dayOrder,
  emptyPlan,
  formatWeekRange,
  loadPlan,
  mondayOf,
  parseIsoDate,
  pruneTicks,
  savePlan,
} from './week-plan.js';

const MAX_SERVINGS = 24;

const state = {
  ingredients: [],
  recipes: [],
  recipeIndex: new Map(),
  plan: emptyPlan(),
  view: 'week',
  shopMode: false,
};

const el = {
  tabs: document.querySelectorAll('[data-tab]'),
  views: document.querySelectorAll('[data-view]'),
  listCount: document.querySelector('#tab-list-count'),
  weekRange: document.querySelector('#week-range'),
  weekDate: document.querySelector('#week-date'),
  planned: document.querySelector('#planned'),
  plannedEmpty: document.querySelector('#planned-empty'),
  plannedSummary: document.querySelector('#planned-summary'),
  clearWeek: document.querySelector('#clear-week'),
  recipes: document.querySelector('#recipes'),
  recipesEmpty: document.querySelector('#recipes-empty'),
  listHeader: document.querySelector('#list-header'),
  listProgress: document.querySelector('#list-progress'),
  listBar: document.querySelector('#list-bar'),
  aisles: document.querySelector('#aisles'),
  listEmpty: document.querySelector('#list-empty'),
  shopMode: document.querySelector('#shop-mode'),
  clearTicks: document.querySelector('#clear-ticks'),
  addView: document.querySelector('#view-add'),
  error: document.querySelector('#error'),
};

/* ------------------------------------------------------------------ data */

async function loadIngredients() {
  const url = new URL('../data/ingredients.json', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ingredients.json: ${response.status}`);
  return response.json();
}

/** Take a fresh list of recipes from the API and rebuild the index off it. */
function setRecipes(recipes) {
  state.recipes = recipes;
  state.recipeIndex = new Map(recipes.map((r) => [r.id, r]));
}

/** Meals whose recipe still exists, in day order. Index is into plan.meals. */
function plannedMeals() {
  return state.plan.meals
    .map((meal, index) => ({ meal, index, recipe: state.recipeIndex.get(meal.recipe_id) }))
    .filter((entry) => entry.recipe)
    .sort(
      (a, b) => dayOrder(a.meal.day) - dayOrder(b.meal.day) || a.index - b.index
    );
}

function servingsOf(entry) {
  return entry.meal.servings ?? entry.recipe.servings;
}

/** The plan in the shape `buildShoppingList` wants. */
function toBuildPlan() {
  return plannedMeals().map((entry) => ({
    recipe_id: entry.meal.recipe_id,
    servings: servingsOf(entry),
  }));
}

function currentList() {
  try {
    return buildShoppingList(toBuildPlan(), {
      ingredients: state.ingredients,
      recipes: state.recipes,
    });
  } catch (error) {
    showError(error.message);
    return [];
  }
}

/* ---------------------------------------------------------------- mutate */

function update(changes) {
  state.plan = savePlan({ ...state.plan, ...changes });
  render();
}

function addMeal(recipeId) {
  update({ meals: [...state.plan.meals, { recipe_id: recipeId, servings: null, day: null }] });
}

function removeMeal(index) {
  update({ meals: state.plan.meals.filter((_, i) => i !== index) });
}

function setMeal(index, changes) {
  update({
    meals: state.plan.meals.map((meal, i) => (i === index ? { ...meal, ...changes } : meal)),
  });
}

/**
 * Delete a recipe from D1, and with it any meal in the week that used it.
 *
 * The week screen already skips meals whose recipe has gone, but leaving them
 * in localStorage means a plan that quietly refers to something that no longer
 * exists. Deleting a recipe is deliberate and irreversible, so tidy up.
 */
async function removeRecipe(recipe) {
  const planned = state.plan.meals.filter((meal) => meal.recipe_id === recipe.id).length;
  const also = planned === 0
    ? ''
    : ` It is in this week ${planned === 1 ? 'once' : `${planned} times`}.`;
  if (!window.confirm(`Delete the ${recipe.name} recipe?${also} This cannot be undone.`)) return;

  try {
    await deleteRecipe(recipe.id);
  } catch (error) {
    showError(`Could not delete ${recipe.name}: ${error.message}`);
    return;
  }

  clearError();
  setRecipes(state.recipes.filter((entry) => entry.id !== recipe.id));
  update({ meals: state.plan.meals.filter((meal) => meal.recipe_id !== recipe.id) });
}

function toggleTick(ingredientId) {
  const ticked = new Set(state.plan.ticked_off);
  if (ticked.has(ingredientId)) ticked.delete(ingredientId);
  else ticked.add(ingredientId);
  update({ ticked_off: [...ticked] });
}

/* ------------------------------------------------------------------- dom */

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = false;
}

function clearError() {
  el.error.textContent = '';
  el.error.hidden = true;
}

/**
 * A quantity as you would write it on a list. Counts get a "×" so "2" next
 * to "Onion" cannot be misread as 2 grams.
 */
function partText(part) {
  return part.unit === 'each'
    ? `×${formatQuantity(part.qty, part.unit)}`
    : formatQuantity(part.qty, part.unit);
}

function quantityText(item) {
  return item.parts.map(partText).join(' + ');
}

/**
 * "What is this here for" — the recipes that asked for the ingredient.
 *
 * Cooking the same thing twice in a week produces two source lines with the
 * same recipe name, which reads as a mistake, so they are summed. Units are
 * always the same within one recipe, so summing is safe.
 */
function sourceText(item) {
  const byRecipe = new Map();
  for (const source of item.sources) {
    const key = `${source.recipe_id}|${source.unit}`;
    const existing = byRecipe.get(key);
    if (existing) existing.qty += source.qty;
    else byRecipe.set(key, { name: source.recipe_name, qty: source.qty, unit: source.unit });
  }

  const groups = [...byRecipe.values()];
  if (groups.length === 0) return null;

  // Which meal an item is for is worth knowing even when one recipe wants all
  // of it — but repeating a quantity the row already shows, two lines apart,
  // is not.
  const [only] = groups;
  if (groups.length === 1 && partText(only) === quantityText(item)) {
    return `For ${only.name}`;
  }

  return groups.map((group) => `${group.name} ${partText(group)}`).join(', ');
}

/**
 * What is missing when the merger could not give one number. Surfacing the
 * gap is the point — the alternative is a made-up weight.
 */
function gapText(item) {
  if (item.needs_unit_weight && item.needs_density) return 'no unit weight or density on file';
  if (item.needs_unit_weight) return 'no unit weight on file';
  if (item.needs_density) return 'no density on file';
  return null;
}

/* ------------------------------------------------------------ week screen */

function renderWeekBar() {
  el.weekDate.value = state.plan.week_of;
  el.weekRange.textContent = formatWeekRange(state.plan.week_of);
}

function mealRow(entry) {
  const row = node('li', 'meal');

  const main = node('div', 'meal-main');
  main.append(node('span', 'meal-name', entry.recipe.name));
  main.append(
    node('span', 'meal-note', `Recipe serves ${entry.recipe.servings}`)
  );
  row.append(main);

  const controls = node('div', 'meal-controls');

  const daySelect = node('select', 'day-select');
  daySelect.setAttribute('aria-label', `Day for ${entry.recipe.name}`);
  const anyDay = node('option', null, 'Any day');
  anyDay.value = '';
  daySelect.append(anyDay);
  for (const day of DAYS) {
    const option = node('option', null, day.long);
    option.value = day.id;
    daySelect.append(option);
  }
  daySelect.value = entry.meal.day ?? '';
  daySelect.addEventListener('change', () => {
    setMeal(entry.index, { day: daySelect.value || null });
  });
  controls.append(daySelect);

  const servings = servingsOf(entry);
  const stepper = node('div', 'stepper');
  stepper.append(
    button('step', '−', () => setMeal(entry.index, { servings: Math.max(1, servings - 1) }), {
      ariaLabel: `One fewer serving of ${entry.recipe.name}`,
    })
  );
  stepper.append(node('span', 'step-value', `${servings}`));
  stepper.append(
    button(
      'step',
      '+',
      () => setMeal(entry.index, { servings: Math.min(MAX_SERVINGS, servings + 1) }),
      { ariaLabel: `One more serving of ${entry.recipe.name}` }
    )
  );
  controls.append(stepper);

  controls.append(
    button('remove', '✕', () => removeMeal(entry.index), {
      ariaLabel: `Remove ${entry.recipe.name} from the week`,
    })
  );

  row.append(controls);
  return row;
}

function renderPlanned() {
  const entries = plannedMeals();
  replace(el.planned, entries.map(mealRow));
  el.plannedEmpty.hidden = entries.length > 0;
  el.clearWeek.hidden = entries.length === 0;

  const servings = entries.reduce((total, entry) => total + servingsOf(entry), 0);
  el.plannedSummary.textContent = entries.length
    ? `${entries.length} ${entries.length === 1 ? 'meal' : 'meals'} · ${servings} servings`
    : '';
}

function recipeCard(recipe) {
  const card = node('li', 'recipe');

  const main = node('div', 'recipe-main');
  main.append(node('span', 'recipe-name', recipe.name));
  main.append(
    node(
      'span',
      'recipe-note',
      `Serves ${recipe.servings} · ${recipe.ingredients.length} ingredients`
    )
  );

  const planned = state.plan.meals.filter((meal) => meal.recipe_id === recipe.id).length;
  if (planned > 0) {
    main.append(node('span', 'recipe-count', `${planned} in the week`));
  }
  card.append(main);

  card.append(
    button('add', 'Add', () => addMeal(recipe.id), {
      ariaLabel: `Add ${recipe.name} to the week`,
    })
  );
  card.append(
    button('remove', '✕', () => removeRecipe(recipe), {
      ariaLabel: `Delete the ${recipe.name} recipe`,
    })
  );
  return card;
}

function renderRecipes() {
  replace(el.recipes, state.recipes.map(recipeCard));
  el.recipesEmpty.hidden = state.recipes.length > 0;
}

/* ---------------------------------------------------- shopping list screen */

function listRow(item, ticked) {
  const row = node('li', `item${ticked ? ' is-ticked' : ''}`);

  const toggle = node('button', 'item-hit');
  toggle.type = 'button';
  // A checkbox role, not a plain button: VoiceOver then announces the ticked
  // state, and the whole row is the tap target rather than a small box.
  toggle.setAttribute('role', 'checkbox');
  toggle.setAttribute('aria-checked', String(ticked));

  toggle.append(node('span', 'item-box', ticked ? '✓' : ''));

  const text = node('span', 'item-text');
  text.append(node('span', 'item-name', item.name));

  if (!state.shopMode) {
    const gap = gapText(item);
    const from = gap ?? sourceText(item);
    if (from) text.append(node('span', gap ? 'item-gap' : 'item-from', from));
  }
  toggle.append(text);

  toggle.append(node('span', 'item-qty', quantityText(item)));
  toggle.addEventListener('click', () => toggleTick(item.ingredient_id));

  row.append(toggle);
  return row;
}

function aisleSection(aisle, ticked) {
  const section = node('section', 'aisle');

  // Ticked items sink to the bottom of their aisle so what is left to find
  // stays at the top. Only in shop mode — while planning, a list that
  // reorders under your thumb is just confusing.
  const items = state.shopMode
    ? [...aisle.items].sort(
        (a, b) => Number(ticked.has(a.ingredient_id)) - Number(ticked.has(b.ingredient_id))
      )
    : aisle.items;

  const done = aisle.items.filter((item) => ticked.has(item.ingredient_id)).length;

  const heading = node('h3', `aisle-head${done === aisle.items.length ? ' is-done' : ''}`);
  heading.append(node('span', null, aisle.label));
  heading.append(node('span', 'aisle-count', `${done}/${aisle.items.length}`));
  section.append(heading);

  const list = node('ul', 'items');
  replace(list, items.map((item) => listRow(item, ticked.has(item.ingredient_id))));
  section.append(list);

  return section;
}

function renderList(list) {
  const ticked = new Set(state.plan.ticked_off);

  el.listEmpty.hidden = list.length > 0;
  el.listHeader.hidden = list.length === 0;

  const done = list.filter((item) => ticked.has(item.ingredient_id)).length;
  el.listProgress.textContent = list.length
    ? `${done} of ${list.length} ticked off`
    : '';
  el.listBar.style.width = list.length ? `${(done / list.length) * 100}%` : '0%';
  el.clearTicks.hidden = done === 0;

  replace(
    el.aisles,
    toAisles(groupByCategory(list)).map((aisle) => aisleSection(aisle, ticked))
  );
}

/* ---------------------------------------------------------------- render */

function render() {
  const list = currentList();
  state.plan = pruneTicks(state.plan, list);

  renderWeekBar();
  renderPlanned();
  renderRecipes();
  renderList(list);

  el.listCount.textContent = list.length ? String(list.length) : '';
  el.listCount.hidden = list.length === 0;

  for (const tab of el.tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === state.view));
  }
  for (const view of el.views) {
    view.hidden = view.dataset.view !== state.view;
  }

  document.body.classList.toggle('shop-mode', state.shopMode);
  el.shopMode.setAttribute('aria-pressed', String(state.shopMode));
  el.shopMode.textContent = state.shopMode ? 'Shop mode on' : 'Shop mode';

  measureSticky();
}

/**
 * Publish the heights of the two sticky bars so the aisle headings can park
 * underneath them. Hard-coding the number breaks as soon as the safe-area
 * inset or the reader's text size differs from the phone it was written on.
 */
function measureSticky() {
  const root = document.documentElement.style;
  root.setProperty('--topbar-h', `${document.querySelector('.topbar').offsetHeight}px`);
  root.setProperty('--listtop-h', `${el.listHeader.hidden ? 0 : el.listHeader.offsetHeight}px`);
}

function setView(view) {
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ wire */

function wire() {
  for (const tab of el.tabs) {
    tab.addEventListener('click', () => setView(tab.dataset.tab));
  }

  document.querySelector('#week-prev').addEventListener('click', () => {
    update({ week_of: addWeeks(state.plan.week_of, -1) });
  });
  document.querySelector('#week-next').addEventListener('click', () => {
    update({ week_of: addWeeks(state.plan.week_of, 1) });
  });
  el.weekDate.addEventListener('change', () => {
    const picked = parseIsoDate(el.weekDate.value);
    // Snap to the Monday: the plan is a week, not a day.
    update({ week_of: picked ? mondayOf(picked) : state.plan.week_of });
  });

  el.clearWeek.addEventListener('click', () => {
    if (window.confirm('Clear every meal from this week?')) {
      update({ meals: [], ticked_off: [] });
    }
  });

  el.shopMode.addEventListener('click', () => {
    state.shopMode = !state.shopMode;
    render();
  });

  el.clearTicks.addEventListener('click', () => {
    update({ ticked_off: [] });
  });

  document.querySelector('#go-shopping').addEventListener('click', () => setView('list'));
  document.querySelector('#go-week').addEventListener('click', () => setView('week'));

  createRecipeForm({
    root: el.addView,
    ingredients: state.ingredients,
    save: createRecipe,
    // The API hands back the recipe it stored, id and all, so the new card
    // appears without re-fetching the whole list.
    onSaved: (recipe) => {
      clearError();
      setRecipes([...state.recipes, recipe].sort((a, b) => a.name.localeCompare(b.name)));
      render();
    },
  });

  // Rotating an iPad changes both sticky bar heights.
  window.addEventListener('resize', measureSticky);
  window.addEventListener('orientationchange', measureSticky);
}

/**
 * Ingredients and recipes now fail in different ways, so they are loaded and
 * reported separately.
 *
 * No ingredients means no app at all — every screen is built out of them.
 * No recipes API means the site is up but D1 is not reachable: the week and
 * the list still work with whatever is planned, and the message says which
 * of the two likely causes it is rather than "something went wrong".
 */
async function start() {
  state.plan = loadPlan();

  try {
    state.ingredients = await loadIngredients();
  } catch (error) {
    showError(
      `Could not load data/ingredients.json (${error.message}). ` +
        'Open the site over http, not by double-clicking the file.'
    );
    return;
  }

  try {
    setRecipes(await listRecipes());
  } catch (error) {
    showError(`Could not load your recipes. ${error.message}`);
  }

  wire();
  render();
}

start();
