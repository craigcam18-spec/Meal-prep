-- Meal prep — D1 schema for recipes.
--
-- Recipes moved out of data/recipes.json and into D1 because they are the one
-- thing in the repo you add to from your phone. Ingredients stay in git: they
-- are reference data you edit deliberately, with a test guarding the shape.
--
-- Three tables, because a recipe is a header plus two ordered lists. Ordering
-- is explicit in a `position` column rather than left to whatever order the
-- rows come back in — SQL has no inherent row order, and "brown the mince"
-- has to stay step 1.
--
-- Paste this into the D1 console in the Cloudflare dashboard, or run:
--   npx wrangler d1 execute meal-prep --remote --file=db/schema.sql

DROP TABLE IF EXISTS recipe_steps;
DROP TABLE IF EXISTS recipe_ingredients;
DROP TABLE IF EXISTS recipes;

CREATE TABLE recipes (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL CHECK (length(trim(name)) > 0),
  servings             INTEGER NOT NULL CHECK (servings > 0),

  -- The source block from DATA_MODEL.md §2, flattened into columns.
  --
  -- captured_text is the whole point of storing a source at all: Reels get
  -- deleted and accounts go private, so the URL alone is not a backup. It is
  -- NOT NULL with a '' default — empty is the honest value for a recipe you
  -- typed in yourself, and the API rejects an empty one for any imported
  -- recipe, where a caption genuinely existed and losing it loses the recipe.
  --
  -- creator is its own column so you can find everything from one person.
  source_type          TEXT NOT NULL DEFAULT 'manual',
  source_url           TEXT,
  source_creator       TEXT,
  source_captured_text TEXT NOT NULL DEFAULT '',
  source_imported      TEXT NOT NULL,             -- yyyy-mm-dd

  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One line of the ingredient list: "500g beef mince".
--
-- ingredient_id points at data/ingredients.json, which is not in this
-- database, so there is no foreign key to enforce it. The API validates every
-- id against that file before it writes — an unknown id would otherwise blow
-- up the shopping list for the whole week (expandPlan throws on it).
--
-- unit is constrained here as well as in the API because the constraint is a
-- property of the data model, not of one code path: anything outside this set
-- is rejected outright rather than guessed at (DATA_MODEL.md §1).
CREATE TABLE recipe_ingredients (
  recipe_id     TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  ingredient_id TEXT NOT NULL,
  qty           REAL NOT NULL CHECK (qty > 0),
  unit          TEXT NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'each')),
  PRIMARY KEY (recipe_id, position)
);

-- "Which recipes use kidney beans" — cheap now, and the only index that earns
-- its keep at this size.
CREATE INDEX recipe_ingredients_by_ingredient
  ON recipe_ingredients (ingredient_id);

CREATE TABLE recipe_steps (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL CHECK (length(trim(text)) > 0),
  PRIMARY KEY (recipe_id, position)
);
