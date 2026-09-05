/**
 * The four DOM helpers the screens share.
 *
 * Small enough to have lived at the top of app.js until the recipe form
 * needed them too. Everything is built with createElement rather than
 * innerHTML: recipe names and step text come from a form, and there is no
 * escaping to get wrong if there is no HTML string.
 */

export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function button(className, label, onClick, { ariaLabel } = {}) {
  const element = node('button', className, label);
  element.type = 'button';
  if (ariaLabel) element.setAttribute('aria-label', ariaLabel);
  element.addEventListener('click', onClick);
  return element;
}

export function replace(parent, children) {
  parent.replaceChildren(...children);
}

/** A `<select>` with a label VoiceOver can read, since the visible one is shared. */
export function select(className, ariaLabel) {
  const element = node('select', className);
  element.setAttribute('aria-label', ariaLabel);
  return element;
}

/** An `<option>`, because building one takes three lines every time. */
export function option(value, label, selected = false) {
  const element = node('option', null, label);
  element.value = value;
  element.selected = selected;
  return element;
}
