-- Meal prep — seed data.
--
-- The Beef chilli, moved across from data/recipes.json verbatim: same id, so
-- any week plan already sitting in localStorage still points at it, and the
-- same captured_text, which for this one is the note explaining what an
-- imported recipe would put there instead.
--
-- Run after db/schema.sql, on a fresh database only — it inserts rather than
-- upserts, so a second run fails on the primary key. That is deliberate: it
-- is a seed, not a sync, and quietly overwriting a recipe you had since
-- edited would be worse than an error.
--
--   npx wrangler d1 execute meal-prep --remote --file=db/seed.sql

INSERT INTO recipes
  (id, name, servings, source_type, source_url, source_creator, source_captured_text, source_imported)
VALUES
  ('beef-chilli', 'Beef chilli', 4, 'manual', NULL, NULL,
   'Worked example, typed in by hand. Recipes imported from a Reel keep type ''instagram'', the reel URL in url, the @handle in creator, and the full original caption verbatim in captured_text.',
   '2026-09-05');

INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, qty, unit) VALUES
  ('beef-chilli', 0, 'beef-mince-5', 500, 'g'),
  ('beef-chilli', 1, 'onion', 1, 'each'),
  ('beef-chilli', 2, 'garlic', 3, 'each'),
  ('beef-chilli', 3, 'red-pepper', 1, 'each'),
  ('beef-chilli', 4, 'red-chilli', 1, 'each'),
  ('beef-chilli', 5, 'chopped-tomatoes', 400, 'g'),
  ('beef-chilli', 6, 'tomato-puree', 30, 'g'),
  ('beef-chilli', 7, 'kidney-beans-canned', 240, 'g'),
  ('beef-chilli', 8, 'olive-oil', 15, 'g'),
  ('beef-chilli', 9, 'rice-basmati', 300, 'g');

INSERT INTO recipe_steps (recipe_id, position, text) VALUES
  ('beef-chilli', 0, 'Heat the oil in a wide pan and brown the mince over a high heat, breaking it up as it colours.'),
  ('beef-chilli', 1, 'Add the onion, garlic, red pepper and chilli. Cook until soft, about 8 minutes.'),
  ('beef-chilli', 2, 'Stir in the tomato puree and cook out for a minute, then add the chopped tomatoes.'),
  ('beef-chilli', 3, 'Simmer uncovered for 25 minutes, then stir in the drained kidney beans and heat through.'),
  ('beef-chilli', 4, 'Cook the rice separately and serve alongside.');
