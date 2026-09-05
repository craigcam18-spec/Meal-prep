# Meal prep

Plan a week of meals, get the shopping list for it.

Static site, no build step. `index.html` loads ES modules straight from
`src/` and fetches `data/*.json`; there is nothing to compile and no
dependencies to install for the site itself.

## Running it

Any static server, because ES modules and `fetch` do not work over
`file://`:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploying to Cloudflare Pages

Deploys as-is from the repo root:

| setting | value |
|---|---|
| Build command | *(leave empty)* |
| Build output directory | `/` |

## Tests

```sh
npm test
```

Node's built-in runner, no dependencies. The tests cover the unit merging
and guard `data/*.json` against drift from `DATA_MODEL.md`.

## Where things live

| path | what |
|---|---|
| `DATA_MODEL.md` | The schema, and why it is shaped that way. Read first. |
| `data/` | Ingredients and recipes. Committed. |
| `src/units.js` | Unit conversion: weight, volume, count. |
| `src/shopping-list.js` | Merging a week plan into one list. |
| `src/week-plan.js` | The week plan in `localStorage`. Not committed — it is per-device. |
| `src/aisles.js` | What order the aisles come in. |
| `src/app.js` | The two screens. |
