/**
 * The "Add recipe" screen.
 *
 * Recipes live in D1 now, which is what makes a form worth building: before,
 * adding one meant editing a JSON file in git. The form collects exactly the
 * shape DATA_MODEL.md §2 describes and posts it to /api/recipes, which
 * validates it again with the same module before it writes anything.
 *
 * Two things drive the layout:
 *   - Same touch sizing as the other screens. Every control is at least 44px
 *     on its shortest side, and the number and text fields are 16px or more
 *     so Safari does not zoom the page in when one takes focus.
 *   - Ingredient lines and steps are rendered once each and then mutated in
 *     place. Re-rendering the list on every keystroke would take the focus
 *     out of the field you are typing in on the first character.
 */

import { toAisles } from './aisles.js';
import { button, node, option, replace, select } from './dom.js';
import { LIMITS, SOURCE_TYPES, validateRecipe } from './recipe-schema.js';
import { KNOWN_UNITS, densityOf, isCountUnit, isVolumeUnit, unitWeightOf } from './units.js';

const DEFAULT_SERVINGS = 4;

const SOURCE_LABELS = new Map([
  ['manual', 'Typed in by hand'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['web', 'A website'],
  ['book', 'A book'],
]);

/**
 * What the shopping list will not be able to do with this line, or null.
 *
 * The same gap the list itself flags, said before you save rather than after:
 * "1 lemon" is a perfectly good thing to write down, it just cannot be added
 * to grams until somebody fills in what a lemon weighs. A warning, not an
 * error — refusing the line would only push you into inventing a weight.
 */
export function lineGap(ingredient, unit) {
  if (!ingredient) return null;
  if (isCountUnit(unit) && unitWeightOf(ingredient) === null) {
    return `No unit weight on file for ${ingredient.name}, so this stays a count on the list.`;
  }
  if (isVolumeUnit(unit) && densityOf(ingredient) === null) {
    return `No density on file for ${ingredient.name}, so this stays in ${unit} on the list.`;
  }
  return null;
}

/**
 * The ingredients grouped into aisles, in the same order as the shopping list
 * — you look for mince under Meat in both places — and alphabetical inside
 * each one, which the list does not need but a picker does.
 */
function groupIntoAisles(ingredients) {
  const groups = new Map();
  for (const ingredient of ingredients) {
    const bucket = groups.get(ingredient.category);
    if (bucket) bucket.push(ingredient);
    else groups.set(ingredient.category, [ingredient]);
  }
  for (const bucket of groups.values()) bucket.sort((a, b) => a.name.localeCompare(b.name));
  return toAisles(groups);
}

/**
 * Wire up the form.
 *
 * `ingredients` is the master list, straight from ingredients.json.
 * `onSaved` is called with the created recipe once the API has stored it, so
 * the week screen can pick it up.
 */
export function createRecipeForm({ root, ingredients, onSaved, save }) {
  const el = {
    form: root.querySelector('#recipe-form'),
    name: root.querySelector('#recipe-name'),
    servings: root.querySelector('#recipe-servings'),
    servingsDown: root.querySelector('#servings-down'),
    servingsUp: root.querySelector('#servings-up'),
    lines: root.querySelector('#recipe-lines'),
    linesEmpty: root.querySelector('#recipe-lines-empty'),
    addLine: root.querySelector('#add-line'),
    steps: root.querySelector('#recipe-steps'),
    stepsEmpty: root.querySelector('#recipe-steps-empty'),
    addStep: root.querySelector('#add-step'),
    sourceType: root.querySelector('#source-type'),
    sourceFields: root.querySelector('#source-fields'),
    sourceUrl: root.querySelector('#source-url'),
    sourceCreator: root.querySelector('#source-creator'),
    sourceText: root.querySelector('#source-text'),
    sourceHint: root.querySelector('#source-hint'),
    notice: root.querySelector('#form-notice'),
    submit: root.querySelector('#save-recipe'),
  };

  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const ingredientIds = new Set(byId.keys());

  // Grouped once, not once per ingredient line: the aisles do not change while
  // the form is open.
  const aisles = groupIntoAisles(ingredients);

  const state = { servings: DEFAULT_SERVINGS, lines: [], steps: [], saving: false };

  /* ------------------------------------------------------------ ingredients */

  /** Fill an ingredient picker, with `selectedId` chosen if it is given. */
  function ingredientOptions(selectEl, selectedId) {
    const children = [option('', 'Pick an ingredient…', !selectedId)];
    for (const aisle of aisles) {
      const group = node('optgroup');
      group.label = aisle.label;
      for (const ingredient of aisle.items) {
        group.append(option(ingredient.id, ingredient.name, ingredient.id === selectedId));
      }
      children.push(group);
    }
    replace(selectEl, children);
  }

  function lineRow(line) {
    const row = node('li', 'line');

    const picker = select('line-ingredient', 'Ingredient');
    ingredientOptions(picker, line.ingredient_id);

    const qty = node('input', 'line-qty');
    qty.type = 'number';
    qty.min = '0';
    qty.step = 'any';
    // decimal, not numeric: half a tin is 0.5, and the iOS numeric pad has no
    // decimal point on it.
    qty.inputMode = 'decimal';
    qty.placeholder = 'Qty';
    qty.value = line.qty;
    qty.setAttribute('aria-label', 'Quantity');

    const unit = select('line-unit', 'Unit');
    replace(
      unit,
      KNOWN_UNITS.map((name) => option(name, name === 'each' ? 'each' : name, name === line.unit))
    );

    const gap = node('p', 'line-gap');
    gap.hidden = true;

    const refreshGap = () => {
      const message = lineGap(byId.get(line.ingredient_id), line.unit);
      gap.textContent = message ?? '';
      gap.hidden = message === null;
    };

    picker.addEventListener('change', () => {
      line.ingredient_id = picker.value;
      refreshGap();
    });
    qty.addEventListener('input', () => {
      line.qty = qty.value;
    });
    unit.addEventListener('change', () => {
      line.unit = unit.value;
      refreshGap();
    });

    const controls = node('div', 'line-controls');
    controls.append(qty, unit);
    controls.append(
      button('remove', '✕', () => removeLine(line), { ariaLabel: 'Remove this ingredient' })
    );

    row.append(picker, controls, gap);
    refreshGap();
    line.row = row;
    return row;
  }

  function addLine() {
    if (state.lines.length >= LIMITS.ingredients) return;
    const line = { ingredient_id: '', qty: '', unit: 'g', row: null };
    state.lines.push(line);
    el.lines.append(lineRow(line));
    el.linesEmpty.hidden = true;
    return line;
  }

  function removeLine(line) {
    state.lines = state.lines.filter((entry) => entry !== line);
    line.row.remove();
    el.linesEmpty.hidden = state.lines.length > 0;
  }

  /* ------------------------------------------------------------------ steps */

  function stepRow(step) {
    const row = node('li', 'step-row');

    const label = node('span', 'step-number');
    const field = node('textarea', 'step-text');
    field.rows = 2;
    field.placeholder = 'What do you do?';
    field.value = step.text;
    field.maxLength = LIMITS.step;

    field.addEventListener('input', () => {
      step.text = field.value;
      grow(field);
    });

    row.append(label, field);
    row.append(button('remove', '✕', () => removeStep(step), { ariaLabel: 'Remove this step' }));

    step.row = row;
    step.label = label;
    step.field = field;
    return row;
  }

  /** Let a step grow with what you type rather than scroll inside two rows. */
  function grow(field) {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }

  /** "Step 3" has to still say 3 after step 2 is deleted. */
  function renumberSteps() {
    state.steps.forEach((step, index) => {
      step.label.textContent = String(index + 1);
      step.field.setAttribute('aria-label', `Step ${index + 1}`);
    });
    el.stepsEmpty.hidden = state.steps.length > 0;
  }

  function addStep() {
    if (state.steps.length >= LIMITS.steps) return;
    const step = { text: '', row: null, label: null, field: null };
    state.steps.push(step);
    el.steps.append(stepRow(step));
    renumberSteps();
    return step;
  }

  function removeStep(step) {
    state.steps = state.steps.filter((entry) => entry !== step);
    step.row.remove();
    renumberSteps();
  }

  /* ----------------------------------------------------------------- source */

  function renderSource() {
    const type = el.sourceType.value;
    const imported = type !== 'manual';
    el.sourceFields.hidden = !imported;
    // The argument for keeping the original text is that links rot, so it is
    // only worth insisting on where there was a link in the first place.
    el.sourceHint.textContent = imported
      ? 'Paste the caption or the method as written. Links rot; the text is the backup.'
      : 'Nothing to capture — you are the source.';
  }

  /* ------------------------------------------------------------------ notice */

  function showNotice(messages, kind) {
    replace(el.notice, messages.map((message) => node('li', null, message)));
    el.notice.className = `form-notice is-${kind}`;
    el.notice.hidden = messages.length === 0;
    if (messages.length > 0) el.notice.scrollIntoView({ block: 'nearest' });
  }

  function clearNotice() {
    el.notice.hidden = true;
    replace(el.notice, []);
  }

  /* ------------------------------------------------------------------ submit */

  function collect() {
    return {
      name: el.name.value,
      servings: state.servings,
      ingredients: state.lines.map((line) => ({
        ingredient_id: line.ingredient_id,
        qty: line.qty === '' ? NaN : Number(line.qty),
        unit: line.unit,
      })),
      steps: state.steps.map((step) => step.text),
      source: {
        type: el.sourceType.value,
        url: el.sourceUrl.value,
        creator: el.sourceCreator.value,
        captured_text: el.sourceType.value === 'manual' ? '' : el.sourceText.value,
      },
    };
  }

  function reset() {
    el.form.reset();
    state.servings = DEFAULT_SERVINGS;
    state.lines = [];
    state.steps = [];
    replace(el.lines, []);
    replace(el.steps, []);
    el.linesEmpty.hidden = false;
    el.stepsEmpty.hidden = false;
    addLine();
    addStep();
    renderServings();
    renderSource();
    clearNotice();
  }

  async function submit(event) {
    event.preventDefault();
    if (state.saving) return;

    const draft = collect();

    // Checked here as well as in the Function, off the same module: the
    // round trip is not the place to find out you left the quantity blank.
    const { errors } = validateRecipe(draft, { ingredientIds });
    if (errors.length > 0) {
      showNotice(errors, 'bad');
      return;
    }

    state.saving = true;
    el.submit.disabled = true;
    el.submit.textContent = 'Saving…';
    clearNotice();

    try {
      const saved = await save(draft);
      reset();
      showNotice([`Saved. ${saved.name} is on the week screen now.`], 'good');
      onSaved(saved);
    } catch (error) {
      showNotice(error.errors ?? [error.message], 'bad');
    } finally {
      state.saving = false;
      el.submit.disabled = false;
      el.submit.textContent = 'Save recipe';
    }
  }

  /* ------------------------------------------------------------------- wire */

  function renderServings() {
    el.servings.textContent = String(state.servings);
    el.servingsDown.disabled = state.servings <= 1;
    el.servingsUp.disabled = state.servings >= LIMITS.servings;
  }

  function setServings(value) {
    state.servings = Math.min(LIMITS.servings, Math.max(1, value));
    renderServings();
  }

  replace(
    el.sourceType,
    SOURCE_TYPES.map((type) => option(type, SOURCE_LABELS.get(type) ?? type, type === 'manual'))
  );
  el.name.maxLength = LIMITS.name;
  el.sourceCreator.maxLength = LIMITS.creator;
  el.sourceText.maxLength = LIMITS.captured_text;

  el.servingsDown.addEventListener('click', () => setServings(state.servings - 1));
  el.servingsUp.addEventListener('click', () => setServings(state.servings + 1));
  // addLine/addStep return nothing once the limit is reached, so the focus
  // call is guarded rather than throwing on the sixtieth ingredient.
  el.addLine.addEventListener('click', () => addLine()?.row.querySelector('select').focus());
  el.addStep.addEventListener('click', () => addStep()?.field.focus());
  el.sourceType.addEventListener('change', renderSource);
  el.form.addEventListener('submit', submit);

  reset();

  return { reset };
}
