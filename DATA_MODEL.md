# Meal-prep — Data Model

Core rule: **meals reference ingredients by ID. They never copy nutrition values.**
Nutrition is calculated on the fly from whatever the best current source is.
This is what lets a later scan update every meal that uses that ingredient,
retrospectively and automatically.

---

## 0. Where each thing lives

Three stores, and which one a thing belongs in follows from how it changes.

| what | where | why there |
|---|---|---|
| Ingredients | `data/ingredients.json`, in git | Reference data. Changes rarely and deliberately, is the same for everybody, and every number in it wants reviewing — so it wants a diff and a test, which is what a file in git gives you. |
| Recipes | **Cloudflare D1** | The one thing you add to from your phone, from a Reel, standing in the kitchen. A file in git cannot take a write from a form. |
| Week plan | `localStorage` | Personal, changes daily, different on every device. Belongs to the browser, not the repo. |
| Shopping list, nutrition | nowhere | Derived. Recalculated on every render — see §4. |

The split is not arbitrary: **written by a person, in advance → git. Written by
the app, at any moment → D1. Written by you, about this week only → the
browser.**

Recipes reference ingredients by id across that boundary, and nothing enforces
it at the database level — D1 has no idea `data/ingredients.json` exists. The
API checks every `ingredient_id` against the file before it writes, because an
id with nothing behind it does not fail quietly: `expandPlan` throws on it and
takes the whole week's shopping list down.

---

## 1. Ingredients (`/data/ingredients.json`)

The master list. One entry per thing you cook with.

```json
{
  "id": "chicken-breast",
  "name": "Chicken breast",
  "aliases": ["chicken breasts", "chicken fillet"],
  "category": "meat",
  "nutrition": {
    "kcal_per_100g": 148,
    "protein_per_100g": 32.0,
    "source": "cofid",
    "source_detail": "Chicken, breast, meat only, raw",
    "updated": "2026-09-05"
  },
  "purchase": {
    "barcode": null,
    "unit": "g",
    "unit_weight_g": null,
    "density_g_per_ml": null,
    "pack_size_g": 650
  }
}
```

### `nutrition.source` — the trust ladder

Always store where a number came from. Priority, best first:

| source | meaning |
|---|---|
| `scanned` | Read off the actual product. Exact match. |
| `openfoodfacts` | Barcode lookup. Crowd-sourced, usually right. |
| `cofid` | UK official dataset. Generic but accurate for raw foods. |
| `manual` | You typed it in from the packet. |
| `estimate` | Guess from a similar ingredient. **Always flagged in the UI.** |

An `estimate` never becomes verified by you eyeballing it. Only a real
value replaces it.

### `purchase.unit_weight_g`

Solves the "1 onion" problem. If `unit` is `"each"`, this says how many
grams one of them is, so nutrition maths still works. Onion ≈ 150g.

### `purchase.density_g_per_ml`

Solves the "200ml milk" problem, the same way. Recipes measure liquids by
volume and nutrition is per 100 **grams**, so a millilitre figure is useless
until you know what a millilitre weighs. Semi-skimmed milk is 1.03 g/ml,
olive oil 0.91.

Density is a measured physical property, not a nutrition figure, so it sits
outside the `nutrition` block and has no `source` on the trust ladder. That
puts more weight on the null: **leave it `null` unless you have a real
figure.** A null is not an omission, it is a statement that nobody has
looked it up, and the shopping list handles it accordingly — the
millilitres stay millilitres and the line is flagged, exactly like a count
with no `unit_weight_g`. Never fill it in by eye to make a number appear.

### Units a recipe line may use

| kind | units | converts to grams when |
|---|---|---|
| weight | `g`, `kg` | always |
| volume | `ml`, `l` | the ingredient has a `density_g_per_ml` |
| count | `each` | the ingredient has a `unit_weight_g` |

Anything else (`tbsp`, `cup`, `pinch`) is rejected outright rather than
guessed at. Convert it to one of the above when you type the recipe in.

### Weight convention

**Log raw weights.** CoFID lists foods both raw and cooked and they are not
interchangeable — 100g dry pasta is ~250g cooked, and mince loses water and
fat when browned. Raw is what your recipe says and what you buy, so match
the CoFID row to raw every time. Put which row you used in `source_detail`.

---

## 2. Recipes (Cloudflare D1)

Recipes used to be `data/recipes.json`. They live in D1 now, in three tables:
a recipe is a header plus two ordered lists, and SQL has no row order of its
own, so the order is an explicit `position` column. Step 3 before step 1 is a
broken recipe.

```
recipes             id, name, servings,
                    source_type, source_url, source_creator,
                    source_captured_text, source_imported, created_at

recipe_ingredients  recipe_id, position, ingredient_id, qty, unit
recipe_steps        recipe_id, position, text
```

The schema is `db/schema.sql`, the Beef chilli that came across from the old
file is `db/seed.sql`, and `src/recipes-store.js` holds the queries.

`unit` is constrained in the table as well as in the API, because the set of
units is a property of the data model rather than of one code path: `g`, `kg`,
`ml`, `l`, `each` and nothing else (see §1).

`ingredient_id` has no foreign key — the ingredients are in git, not in the
database. The API validates it instead; §0 says why that matters.

### Over the wire

`/api/recipes` speaks the shape the old JSON file had, so nothing downstream
of it had to change:

```json
{
  "id": "beef-chilli",
  "name": "Beef chilli",
  "servings": 4,
  "ingredients": [
    { "ingredient_id": "beef-mince-5", "qty": 500, "unit": "g" },
    { "ingredient_id": "onion", "qty": 1, "unit": "each" },
    { "ingredient_id": "chopped-tomatoes", "qty": 400, "unit": "g" }
  ],
  "steps": [
    "Brown the mince over a high heat.",
    "Add onion, cook until soft."
  ],
  "source": {
    "type": "instagram",
    "url": "https://www.instagram.com/reel/xxxxx/",
    "creator": "@handle",
    "captured_text": "full original caption, stored verbatim",
    "imported": "2026-09-05"
  }
}
```

| route | does |
|---|---|
| `GET /api/recipes` | every recipe, by name |
| `POST /api/recipes` | create one; the id is generated from the name |
| `GET /api/recipes/:id` | one recipe |
| `DELETE /api/recipes/:id` | remove it and its lines and steps |

A create is one D1 batch, which is one transaction: a recipe never lands
without its ingredients. A delete removes the child rows explicitly rather than
relying on `ON DELETE CASCADE`, which only fires when the connection has
foreign keys switched on — orphaned rows would stay invisible until something
reused the id.

Ids come from the name (`Beef chilli` → `beef-chilli`), and a second recipe
with a name already taken becomes `beef-chilli-2` rather than being refused.
Two chillis is a thing that happens.

### `captured_text`

`captured_text` matters: Reels get deleted and accounts go private. The URL
alone isn't a backup. The raw caption survives independently and lets you
reconstruct the recipe if the original vanishes.

Which is why it is required for anything imported and empty for anything you
typed in yourself — there was never any original text in that case, and `''`
is the honest answer rather than a placeholder. `source_type` is `manual` for
those.

`creator` is its own field so you can find everything from one person later.

---

## 3. Week plan (browser localStorage, not the repo, not D1)

This changes constantly and is personal — it doesn't belong in git, and it
doesn't belong in a database either: there is nobody else to share it with,
and a second device wanting its own week is a feature.

```json
{
  "week_of": "2026-09-08",
  "meals": [
    { "recipe_id": "beef-chilli", "servings": 4, "day": "mon" }
  ],
  "ticked_off": ["onion", "chopped-tomatoes"]
}
```

Stored under the single key `mealprep.week.v1`. `week_of` is the Monday of
the week, `day` is one of `mon`–`sun`, and `ticked_off` holds ingredient
IDs — not shopping-list rows, which are rebuilt from scratch every render
and have no stable identity of their own. IDs that are no longer on the list
are dropped on the next write, so a tick never outlives the meal that put
the ingredient there.

Nothing here is written anywhere but the browser it was typed into. It is
personal, it changes daily, and every device keeps its own.

---

## 4. Derived, never stored

Calculate these fresh each time. Storing them is how the numbers go stale.

- **Shopping list** — all ingredients across the week's meals, scaled to
  servings, merged by ingredient ID, quantities summed.
- **Per-meal nutrition** — sum of (qty ÷ 100 × per_100g) for each ingredient.
- **Verified count** — how many of this week's values are `estimate` vs real.
  Show as "3 of 5 meals fully verified" so you can tell at a glance whether
  the protein figure is trustworthy.

---

## Build order

1. ~~`ingredients.json` + `recipes.json` + the unit-merging logic.~~ Done.
   Combining 300g and 500g of mince correctly is the fiddly bit — do it first.
2. ~~Pick-your-week screen → shopping list, grouped by aisle, with a
   tick-off mode for in the shop.~~ Done — `index.html` + `src/app.js`.
3. ~~Recipes into D1, and a form to add one without editing a file.~~ Done —
   `db/`, `functions/api/`, and the third screen.
4. Manual nutrition entry (`source: "manual"`) + estimate flagging.

Later, once it's earning its keep: barcode scan → Open Food Facts, then
photo of the nutrition panel via a vision API behind a Cloudflare Pages
Function. Both are new *input methods* feeding the pipeline above — not
rewrites. Build them last.
