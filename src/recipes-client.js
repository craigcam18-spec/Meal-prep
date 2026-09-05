/**
 * The browser's side of /api/recipes.
 *
 * Recipes come from D1 now, so the app fetches them instead of reading
 * data/recipes.json. Ingredients still come from the file — they are
 * reference data and stay in git (DATA_MODEL.md §1).
 *
 * The API answers errors as `{ errors: [...] }` whatever the status, so one
 * reader handles them all and the screens never have to parse a status code.
 */

const ENDPOINT = '/api/recipes';

class ApiError extends Error {
  constructor(errors, status) {
    super(errors.join(' '));
    this.name = 'ApiError';
    this.errors = errors;
    this.status = status;
  }
}

async function readOrThrow(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* An error page rather than JSON — the status is all we have. */
  }

  if (response.ok) return body;

  const errors = Array.isArray(body?.errors) && body.errors.length > 0
    ? body.errors
    : [
        response.status === 404
          ? 'The recipes API is not there. Run the site with `wrangler pages dev` so ' +
            'the Pages Functions are served, not a plain static server.'
          : `The recipes API returned ${response.status}.`,
      ];

  throw new ApiError(errors, response.status);
}

export async function listRecipes() {
  return readOrThrow(await fetch(ENDPOINT, { headers: { accept: 'application/json' } }));
}

export async function createRecipe(recipe) {
  return readOrThrow(
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(recipe),
    })
  );
}

export async function deleteRecipe(id) {
  return readOrThrow(
    await fetch(`${ENDPOINT}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  );
}

export { ApiError };
