# Meal-prep — Data Model

Core rule: **meals reference ingredients by ID. They never copy nutrition values.**
Nutrition is calculated on the fly from whatever the best current source is.
This is what lets a later scan update every meal that uses that ingredient,
retrospectively and automatically.

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

### Weight convention

**Log raw weights.** CoFID lists foods both raw and cooked and they are not
interchangeable — 100g dry pasta is ~250g cooked, and mince loses water and
fat when browned. Raw is what your recipe says and what you buy, so match
the CoFID row to raw every time. Put which row you used in `source_detail`.

---

## 2. Recipes (`/data/recipes.json`)

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

`captured_text` matters: Reels get deleted and accounts go private. The URL
alone isn't a backup. The raw caption survives independently and lets you
reconstruct the recipe if the original vanishes.

`creator` is its own field so you can find everything from one person later.

---

## 3. Week plan (browser localStorage, not the repo)

This changes constantly and is personal — it doesn't belong in git.

```json
{
  "week_of": "2026-09-08",
  "meals": [
    { "recipe_id": "beef-chilli", "servings": 4, "day": "mon" }
  ],
  "ticked_off": ["onion", "chopped-tomatoes"]
}
```

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

1. `ingredients.json` + `recipes.json` + the unit-merging logic.
   Combining 300g and 500g of mince correctly is the fiddly bit — do it first.
2. Pick-your-week screen → shopping list, grouped by aisle.
3. Manual nutrition entry (`source: "manual"`) + estimate flagging.
4. Tick-off mode for in the shop.

Later, once it's earning its keep: barcode scan → Open Food Facts, then
photo of the nutrition panel via a vision API behind a Cloudflare Pages
Function. Both are new *input methods* feeding the pipeline above — not
rewrites. Build them last.
