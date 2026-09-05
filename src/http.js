/**
 * The one response helper the Pages Functions share.
 *
 * Its own module rather than a corner of one of the route files, so neither
 * route has to import the other just to reply.
 */

/** JSON out, and never cached: the recipe list changes the moment you add one. */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}
