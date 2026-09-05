# Meal prep

Plan a week of meals, get the shopping list for it, and add recipes from your
phone.

No build step. `index.html` loads ES modules straight from `src/`; the only
server-side code is two Cloudflare Pages Functions under `functions/`, which
read and write the recipes in a D1 database. There is nothing to compile and
no dependencies to install for the site itself.

## Where the data lives

Three places, and `DATA_MODEL.md` §0 argues why each thing is where it is:

| what | where |
|---|---|
| Ingredients | `data/ingredients.json`, committed |
| Recipes | Cloudflare D1, via `/api/recipes` |
| Week plan | `localStorage`, per device |

## Running it

The recipes come from D1, so a plain static server no longer serves a working
app — you need the Pages Functions and a local database. Wrangler gives you
both, entirely offline:

```sh
cp wrangler.example.toml wrangler.toml        # gitignored; see the file for why
npx wrangler d1 execute DB --local --file=db/schema.sql
npx wrangler d1 execute DB --local --file=db/seed.sql
npx wrangler pages dev
```

Then open the address it prints. The local database lives in `.wrangler/`,
also gitignored; delete that directory to start over.

## Setting it up on Cloudflare, from an iPad

All of this is in the dashboard at **dash.cloudflare.com** — no terminal
needed. The database and the Pages project are two separate things, and the
third step is the one that introduces them to each other.

**1 — Make the database**

1. Left-hand menu → **Storage & Databases** → **D1 SQL Database**.
2. **Create** (top right). Name it `meal-prep`. **Create**.

**2 — Put the tables and the chilli in it**

1. Open the `meal-prep` database → the **Console** tab.
2. Open `db/schema.sql` from this repo, copy the whole file, paste it into the
   console, and run it.
3. Do the same with `db/seed.sql`. That is the Beef chilli.
4. The **Tables** tab should now list `recipes`, `recipe_ingredients` and
   `recipe_steps`, with 1, 10 and 5 rows.

**3 — Bind the database to the site** — the step that is easy to miss, and
the reason the app would otherwise say "No database bound":

1. Left-hand menu → **Compute (Workers)** → **Workers & Pages** → your
   `meal-prep` Pages project.
2. **Settings** tab → **Bindings** → **Add** → **D1 database**.
3. Variable name: `DB` — exactly that, capitals, no quotes. The Functions look
   for `env.DB` and nothing else.
4. D1 database: `meal-prep`. **Save**.
5. If the dashboard offers Production and Preview separately, add the same
   binding to both, or previews of a branch will 503 while production works.

**4 — Redeploy so the binding takes**

A binding only applies to deployments made after it: **Deployments** tab →
the latest one → **⋯** → **Retry deployment**. Or just push a commit.

**5 — Check it**

Open `https://your-project.pages.dev/api/recipes`. You want a JSON array with
the Beef chilli in it. If instead you get:

| what you see | what it means |
|---|---|
| `{"errors":["No database bound…"]}` | Step 3 or step 4 has not taken. Check the variable name is `DB`, then redeploy. |
| A 404, or the site's HTML | The Functions did not deploy. Check `functions/` is committed and the build output directory is `/`. |

### Build settings

Unchanged — the site is the repo root:

| setting | value |
|---|---|
| Build command | *(leave empty)* |
| Build output directory | `/` |

There is deliberately no `wrangler.toml` committed. A Pages project with one
in its repo takes its bindings from that file and ignores the dashboard, so a
committed config would silently undo step 3 above. `wrangler.example.toml` is
the local-only copy to work from.

## Tests

```sh
npm test
```

Node's built-in runner, no dependencies. The tests cover the unit merging, the
recipe validation the form and the API share, and `data/ingredients.json`
against drift from `DATA_MODEL.md`. The D1 queries and `db/*.sql` run for real
against an in-memory SQLite database — D1 is SQLite, so `test/d1.js` is a
small stand-in that lets `src/recipes-store.js` run unchanged.

## Where things live

| path | what |
|---|---|
| `DATA_MODEL.md` | The schema, and why it is shaped that way. Read first. |
| `data/ingredients.json` | The master ingredient list. Committed — it is reference data. |
| `db/schema.sql` | The D1 tables for recipes. |
| `db/seed.sql` | The Beef chilli, moved out of the old `recipes.json`. |
| `wrangler.example.toml` | Local dev config. Copy to `wrangler.toml`; never committed. |
| `functions/api/recipes.js` | `GET` the list, `POST` a new one. |
| `functions/api/recipes/[id].js` | `GET` and `DELETE` one recipe. |
| `src/recipe-schema.js` | What a valid recipe is. Shared by the API, the form and the tests. |
| `src/recipes-store.js` | The D1 queries. |
| `src/recipes-client.js` | The browser's side of `/api/recipes`. |
| `src/recipe-form.js` | The add-recipe screen. |
| `test/d1.js` | A D1-shaped stand-in over `node:sqlite`, so the SQL is tested. |
| `src/units.js` | Unit conversion: weight, volume, count. |
| `src/shopping-list.js` | Merging a week plan into one list. |
| `src/week-plan.js` | The week plan in `localStorage`. Not committed — it is per-device. |
| `src/aisles.js` | What order the aisles come in. |
| `src/dom.js` | The handful of DOM helpers the screens share. |
| `src/app.js` | The three screens. |
