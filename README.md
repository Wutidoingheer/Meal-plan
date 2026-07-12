# 🍽️ Family Dinner Planner

A simple, mobile-friendly weekly **dinner generator** for our family. Tap a
button, get 7 fresh dinners for the week (plus a couple of swap ideas), full
recipes, and a checkable grocery list. Built to copy onto the kitchen
whiteboard calendar.

## What it does

- **Generate a week** of 7 dinners with one tap, spread across ~6 cuisines for
  variety.
- **106 recipes** and growing.
- **Cooking-method filter** — Blackstone/flattop, stovetop, oven, sheet pan,
  slow cooker, Instant Pot, air fryer, grill. Every meal shows its method.
- **Keep a meal** 🔒 — lock the dinners you love so a reshuffle leaves them in
  place and only regenerates the rest.
- **Rest a meal** 💤 — mark one to sit out the next few weeks so you don't repeat
  it too soon; bring it back any time.
- **Swap picker** — tap "Swap" to see a list of alternatives (sorted so meals
  reusing this week's ingredients come first) before you replace a night.
- **Pantry-first mode** — list what you already have and the generator builds the
  week around it (and pre-checks those items on the grocery list).
- **Cost & efficiency** — the generator also favors weeks where meals share
  ingredients, so you buy less and waste less.
- **Full recipes** — ingredients, steps, time, calories, servings.
- **Grocery list** grouped by aisle, with checkboxes so you only buy what's
  missing. Items used in more than one meal are flagged (×N meals) so you don't
  over-buy.
- **Kid-friendly only** toggle — every meal Wesley can eat too (no separate
  cooking).
- **IF / calorie-cut tips** toggle — an easy lower-calorie tweak for each meal.
- **Blackstone-friendly** filter and badges for flattop nights.
- **Cuisine filters** — Mexican, Italian, American, Rice Bowls, Mediterranean,
  Asian.
- **No seafood, no berries** — always filtered out.
- Remembers your plan, pantry, kept meals, resting meals, and grocery checkmarks
  between visits (localStorage).

## How to use it

It's a static web app — no install, no server needed.

**On your phone:** open `index.html` in any browser. For the easiest access,
host it free with GitHub Pages (Settings → Pages → deploy from the
`claude/family-meal-planner-o653l6` branch) and add it to your home screen.

**On a computer:** just double-click `index.html`, or run a tiny local server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Adding or editing recipes

All recipes live in `js/recipes.js`. Copy an existing block and edit it. Each
recipe needs:

```js
{
  id: "unique-id",
  name: "Recipe Name",
  cuisine: "mexican" | "italian" | "american" | "ricebowl" | "mediterranean" | "asian",
  method: "flattop" | "stovetop" | "oven" | "sheetpan" | "slowcooker" | "instantpot" | "airfryer" | "grill", // optional; inferred from steps if omitted
  time: 35,            // minutes
  servings: 4,
  calories: 600,       // per serving, approx
  kidFriendly: true,
  blackstone: false,   // true if it works on the flattop
  ifTip: "How to cut calories for this meal.",
  ingredients: [
    { item: "ground beef", qty: 1, unit: "lb", category: "meat" },
    // category: produce | meat | dairy | frozen | bakery | pantry
    // add staple: true for things you usually have on hand
  ],
  steps: ["Step one.", "Step two."],
}
```

Keep it free of seafood and berries to match our house rules.

## Project layout

```
index.html        app shell
css/styles.css    mobile-first styles
js/recipes.js     the recipe database (edit this to add meals)
js/app.js         generator, grocery list, recipe modal, persistence
```

No dependencies, no build step.
