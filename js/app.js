/*
 * Family Dinner Planner — app logic.
 * Pure vanilla JS, no build step. State persists in localStorage so the plan
 * and grocery checkmarks survive a page refresh.
 */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STORAGE_KEY = "dinnerPlanner.v2";
const COOLDOWN_WEEKS = 3; // how many generated weeks a "rested" meal sits out

// --- DOM refs ---
const els = {
  kidOnly: document.getElementById("kidOnly"),
  ifMode: document.getElementById("ifMode"),
  blackstoneOnly: document.getElementById("blackstoneOnly"),
  cuisineChips: document.getElementById("cuisineChips"),
  methodChips: document.getElementById("methodChips"),
  pantryInput: document.getElementById("pantryInput"),
  pantrySuggest: document.getElementById("pantrySuggest"),
  restingSection: document.getElementById("restingSection"),
  resting: document.getElementById("resting"),
  generateBtn: document.getElementById("generateBtn"),
  reshuffleBtn: document.getElementById("reshuffleBtn"),
  planSection: document.getElementById("planSection"),
  plan: document.getElementById("plan"),
  swaps: document.getElementById("swaps"),
  grocerySection: document.getElementById("grocerySection"),
  grocery: document.getElementById("grocery"),
  clearChecksBtn: document.getElementById("clearChecksBtn"),
  modal: document.getElementById("recipeModal"),
  modalBody: document.getElementById("modalBody"),
  modalClose: document.getElementById("modalClose"),
};

// --- App state ---
let state = {
  planIds: [],      // 7 recipe ids, one per day
  swapIds: [],      // 3 alternative recipe ids
  checked: {},      // grocery line key -> bool
  locked: [],       // recipe ids the user wants to keep through a reshuffle
  cooldowns: {},    // recipe id -> generated-week number it's available again
  week: 0,          // how many full weeks have been generated (drives cooldowns)
  filters: {
    cuisines: Object.keys(CUISINE_LABELS),   // all on by default
    methods: Object.keys(METHOD_LABELS),     // all on by default
    kidOnly: false,
    ifMode: false,
    blackstoneOnly: false,
    pantry: [],       // ingredients the user already has (pantry-first mode)
  },
};

// Quick-add suggestions for the pantry box.
const COMMON_PANTRY = [
  "ground beef", "chicken breast", "white rice", "pasta", "tortillas",
  "shredded cheese", "eggs", "onion", "bell pepper", "black beans",
  "marinara sauce", "soy sauce", "frozen vegetables", "garlic",
];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage may be unavailable in private mode — fail silently */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed, filters: { ...state.filters, ...(parsed.filters || {}) } };
    }
  } catch (e) {
    /* ignore corrupt storage */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const recipeById = (id) => RECIPES.find((r) => r.id === id);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A recipe's cooking method: explicit `method`, else inferred from its steps.
function inferMethod(recipe) {
  if (recipe.method) return recipe.method;
  const t = recipe.steps.join(" ").toLowerCase();
  if (/slow cooker|crock/.test(t)) return "slowcooker";
  if (/air fry|air-fry/.test(t)) return "airfryer";
  if (/\bgrill/.test(t)) return "grill";
  if (recipe.blackstone || /flattop|griddle|blackstone/.test(t)) return "flattop";
  if (/preheat oven|\bbake\b|\broast|sheet pan|broil/.test(t)) return "oven";
  return "stovetop";
}
const getMethod = (recipe) => inferMethod(recipe);

// True while a "rested" recipe should stay out of rotation.
function isOnCooldown(id) {
  return (state.cooldowns[id] || 0) > state.week;
}

function matchesFilters(recipe) {
  if (!state.filters.cuisines.includes(recipe.cuisine)) return false;
  const methods = state.filters.methods || Object.keys(METHOD_LABELS);
  if (!methods.includes(getMethod(recipe))) return false;
  if (state.filters.kidOnly && !recipe.kidFriendly) return false;
  if (state.filters.blackstoneOnly && !recipe.blackstone) return false;
  return true;
}

// The pool the generator and swap-picker draw from: passes filters and isn't resting.
function isAvailable(recipe) {
  return matchesFilters(recipe) && !isOnCooldown(recipe.id);
}

// Meaningful (non-staple) ingredient names for a recipe, lowercased.
function getKeyIngredients(recipe) {
  return recipe.ingredients.filter((i) => !i.staple).map((i) => i.item.toLowerCase());
}

// Normalized list of pantry terms the user typed.
function pantryTerms() {
  return state.filters.pantry.map((s) => s.toLowerCase().trim()).filter(Boolean);
}

// Loose match: pantry term contained in the ingredient name or vice versa.
function ingredientMatchesPantry(name) {
  const n = name.toLowerCase();
  return pantryTerms().some((t) => n.includes(t) || t.includes(n));
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
function generatePlan() {
  // Locked meals are kept in place through a reshuffle, regardless of filters.
  const lockedSet = new Set(state.locked);
  const keepByDay = {}; // day index -> recipe id that stays
  state.planIds.forEach((id, i) => {
    if (lockedSet.has(id) && recipeById(id)) keepByDay[i] = id;
  });
  const keptIds = new Set(Object.values(keepByDay));
  const slotsToFill = 7 - keptIds.size;

  // Available pool excludes filtered-out meals, resting meals, and kept meals.
  const pool = RECIPES.filter((r) => isAvailable(r) && !keptIds.has(r.id));

  if (pool.length < slotsToFill) {
    alert(
      `Only ${pool.length} more recipes are available for ${slotsToFill} open night(s). ` +
      `Try turning on more cuisines/methods, or un-rest a meal.`
    );
    return false;
  }

  // Seed the running "used ingredients" and cuisine counts from kept meals so
  // the fills still favor overlap and variety around them.
  const used = new Set();
  const cuisineCount = {};
  keptIds.forEach((id) => {
    const r = recipeById(id);
    getKeyIngredients(r).forEach((k) => used.add(k));
    cuisineCount[r.cuisine] = (cuisineCount[r.cuisine] || 0) + 1;
  });

  // Greedy build that balances three goals each day:
  //   1. Pantry-first — favor meals using ingredients you already have.
  //   2. Variety — a bonus for a cuisine not yet on the plan, a penalty for a
  //      third+ meal of the same cuisine, so the week spans ~6 cuisines.
  //   3. Ingredient overlap — favor meals sharing ingredients with the week so
  //      far, so you buy and waste less.
  // A small random term keeps successive weeks from looking identical.
  const W = { pantry: 3, overlap: 1.2, newCuisine: 4, repeatPenalty: -2 };
  const terms = pantryTerms();
  const fills = [];
  let candidates = [...pool];

  for (let n = 0; n < slotsToFill && candidates.length; n++) {
    let best = null;
    let bestScore = -Infinity;
    for (const r of candidates) {
      const keys = getKeyIngredients(r);
      const pantryHits = terms.length
        ? keys.filter((k) => terms.some((t) => k.includes(t) || t.includes(k))).length
        : 0;
      const overlap = keys.filter((k) => used.has(k)).length;
      const count = cuisineCount[r.cuisine] || 0;
      const varietyBonus = count === 0 ? W.newCuisine : count >= 2 ? W.repeatPenalty : 0;
      const score =
        pantryHits * W.pantry + overlap * W.overlap + varietyBonus + Math.random() * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    fills.push(best);
    cuisineCount[best.cuisine] = (cuisineCount[best.cuisine] || 0) + 1;
    getKeyIngredients(best).forEach((k) => used.add(k));
    candidates = candidates.filter((r) => r !== best);
  }

  // Reassemble the week: kept meals stay on their day, fills drop into the gaps.
  const newPlan = [];
  let fillIdx = 0;
  for (let i = 0; i < 7; i++) {
    if (keepByDay[i]) newPlan.push(keepByDay[i]);
    else newPlan.push(fills[fillIdx++].id);
  }
  state.planIds = newPlan;

  // Swaps: up to 3 available recipes that aren't already in the plan.
  const onPlan = new Set(state.planIds);
  const leftovers = RECIPES.filter((r) => isAvailable(r) && !onPlan.has(r.id));
  state.swapIds = shuffle(leftovers).slice(0, 3).map((r) => r.id);

  state.week += 1;        // advance the calendar so cooldowns tick down
  state.checked = {};     // reset grocery checks for the new plan
  save();
  return true;
}

// ---------------------------------------------------------------------------
// Rendering — plan
// ---------------------------------------------------------------------------
function cuisineTag(cuisine) {
  return `<span class="tag tag-${cuisine}">${CUISINE_LABELS[cuisine]}</span>`;
}

function renderPlan() {
  if (!state.planIds.length) {
    els.planSection.classList.add("hidden");
    els.grocerySection.classList.add("hidden");
    return;
  }

  els.planSection.classList.remove("hidden");
  els.plan.innerHTML = state.planIds
    .map((id, i) => {
      const r = recipeById(id);
      if (!r) return "";
      const locked = state.locked.includes(r.id);
      const badges = [
        `<span class="badge">${METHOD_LABELS[getMethod(r)]}</span>`,
        r.kidFriendly ? `<span class="badge">👶 Kid-friendly</span>` : "",
      ].join("");
      const ifTip = state.filters.ifMode
        ? `<p class="if-tip">💧 IF tip: ${r.ifTip}</p>`
        : "";
      const sides = r.sides && r.sides.length
        ? `<p class="sides-line">🥗 Serve with: ${r.sides.join(" · ")}</p>`
        : "";
      return `
        <li class="meal-card ${locked ? "locked" : ""}" data-id="${r.id}">
          <div class="meal-day">${DAYS[i]}</div>
          <div class="meal-main">
            <div class="meal-title-row">
              <h3>${r.name}</h3>
              ${cuisineTag(r.cuisine)}
              ${locked ? `<span class="lock-flag" title="Kept through reshuffles">🔒</span>` : ""}
            </div>
            <div class="meal-meta">⏱️ ${r.time} min · ${r.calories} cal/serv · serves ${r.servings}</div>
            <div class="badges">${badges}</div>
            ${sides}
            ${ifTip}
            <div class="meal-actions">
              <button class="link-btn view-recipe" data-id="${r.id}">View recipe →</button>
              <button class="link-btn swap-day" data-day="${i}">🔄 Swap</button>
              <button class="link-btn lock-day" data-id="${r.id}">${locked ? "🔓 Unkeep" : "🔒 Keep"}</button>
              <button class="link-btn rest-day" data-day="${i}" title="Won't appear for ${COOLDOWN_WEEKS} weeks">💤 Rest ${COOLDOWN_WEEKS}wk</button>
            </div>
          </div>
        </li>`;
    })
    .join("");

  renderSwaps();
  renderResting();
  renderGrocery();
}

function renderSwaps() {
  if (!state.swapIds.length) {
    els.swaps.innerHTML = `<li class="swap-empty">No extra ideas right now — reshuffle for more.</li>`;
    return;
  }
  els.swaps.innerHTML = state.swapIds
    .map((id) => {
      const r = recipeById(id);
      if (!r) return "";
      return `
        <li class="swap-card" data-id="${r.id}">
          <button class="link-btn view-recipe" data-id="${r.id}">
            ${r.name} ${cuisineTag(r.cuisine)} <small>· ${r.time} min</small>
          </button>
        </li>`;
    })
    .join("");
}

// Drop a specific recipe into a day.
function replaceDay(dayIndex, id) {
  state.planIds[dayIndex] = id;
  state.checked = {}; // ingredients changed
  save();
  renderPlan();
}

// Alternatives available to fill a given day (excludes the rest of the plan).
function candidatesForDay(dayIndex) {
  const onPlan = new Set(state.planIds.filter((_, i) => i !== dayIndex));
  const current = state.planIds[dayIndex];
  const used = new Set();
  state.planIds.forEach((id, i) => {
    if (i === dayIndex) return;
    const r = recipeById(id);
    if (r) getKeyIngredients(r).forEach((k) => used.add(k));
  });
  return RECIPES.filter((r) => isAvailable(r) && !onPlan.has(r.id) && r.id !== current)
    // Rank by ingredient overlap with the rest of the week (cheaper shop first).
    .map((r) => ({ r, overlap: getKeyIngredients(r).filter((k) => used.has(k)).length }))
    .sort((a, b) => b.overlap - a.overlap || a.r.name.localeCompare(b.r.name))
    .map((x) => x.r);
}

// Open a chooser so you can SEE alternatives before replacing a meal.
function openSwapPicker(dayIndex) {
  const current = recipeById(state.planIds[dayIndex]);
  const cands = candidatesForDay(dayIndex);
  if (!cands.length) {
    alert("No other recipes are available with the current filters/methods to swap in.");
    return;
  }
  const rows = cands
    .map((r) => {
      const method = METHOD_LABELS[getMethod(r)];
      return `
        <li>
          <button class="picker-row" data-pick-day="${dayIndex}" data-pick-id="${r.id}">
            <span class="picker-name">${r.name}</span>
            <span class="picker-meta">${cuisineTag(r.cuisine)} <small>${method} · ${r.time} min</small></span>
          </button>
        </li>`;
    })
    .join("");
  els.modalBody.innerHTML = `
    <div class="modal-title-row"><h2>Swap ${DAYS[dayIndex]}</h2></div>
    <p class="modal-meta">Replacing <strong>${current ? current.name : "this meal"}</strong>.
      Sorted so meals that reuse this week's ingredients come first.</p>
    <button class="ghost-btn picker-surprise" data-day="${dayIndex}">🎲 Surprise me</button>
    <ul class="picker-list">${rows}</ul>`;
  els.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

// Keep / un-keep a meal so a reshuffle leaves it alone.
function toggleLock(id) {
  const set = new Set(state.locked);
  set.has(id) ? set.delete(id) : set.add(id);
  state.locked = [...set];
  save();
  renderPlan();
}

// Rest a meal: it leaves the plan now and sits out the next few weeks.
function restMeal(dayIndex) {
  const id = state.planIds[dayIndex];
  if (!id) return;
  state.cooldowns[id] = state.week + COOLDOWN_WEEKS;
  state.locked = state.locked.filter((x) => x !== id); // resting overrides keeping
  const replacement = candidatesForDay(dayIndex)[0];
  if (replacement) {
    state.planIds[dayIndex] = replacement.id;
  } else {
    alert("Rested — but no replacement is available with the current filters.");
  }
  state.checked = {};
  save();
  renderPlan();
}

function unRest(id) {
  delete state.cooldowns[id];
  save();
  renderPlan();
}

// Meals currently resting (won't be picked until their week comes back around).
function renderResting() {
  const resting = Object.keys(state.cooldowns).filter((id) => isOnCooldown(id));
  if (!resting.length) {
    els.restingSection.classList.add("hidden");
    return;
  }
  els.restingSection.classList.remove("hidden");
  els.resting.innerHTML = resting
    .map((id) => {
      const r = recipeById(id);
      if (!r) return "";
      const weeksLeft = state.cooldowns[id] - state.week;
      return `
        <li class="resting-item">
          <span>${r.name} <small>· ${weeksLeft} wk${weeksLeft === 1 ? "" : "s"} left</small></span>
          <button class="link-btn un-rest" data-id="${id}">Bring back</button>
        </li>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Rendering — grocery list
// ---------------------------------------------------------------------------
function buildGrocery() {
  // Aggregate ingredients across the 7 planned meals, grouped by category.
  // Same-named items are combined and we note how many meals use them.
  const map = {}; // key -> { item, category, uses:Set, staple }
  state.planIds.forEach((id) => {
    const r = recipeById(id);
    if (!r) return;
    r.ingredients.forEach((ing) => {
      const key = ing.item.toLowerCase();
      if (!map[key]) {
        map[key] = { item: ing.item, category: ing.category, uses: new Set(), staple: !!ing.staple };
      }
      map[key].uses.add(r.name);
    });
  });

  // Group by category in display order.
  const grouped = {};
  Object.values(map).forEach((entry) => {
    (grouped[entry.category] = grouped[entry.category] || []).push(entry);
  });
  Object.values(grouped).forEach((list) =>
    list.sort((a, b) => a.item.localeCompare(b.item))
  );
  return grouped;
}

function renderGrocery() {
  const grouped = buildGrocery();
  els.grocerySection.classList.remove("hidden");

  const sections = CATEGORY_ORDER.filter((cat) => grouped[cat]).map((cat) => {
    const rows = grouped[cat]
      .map((entry) => {
        const key = entry.item.toLowerCase();
        // Default pantry matches to checked unless the user has explicitly toggled.
        const isChecked = Object.prototype.hasOwnProperty.call(state.checked, key)
          ? state.checked[key]
          : ingredientMatchesPantry(entry.item);
        const overlap =
          entry.uses.size > 1
            ? `<span class="overlap" title="${[...entry.uses].join(", ")}">×${entry.uses.size} meals</span>`
            : "";
        return `
          <li class="grocery-item ${isChecked ? "got-it" : ""}">
            <label>
              <input type="checkbox" class="grocery-check" data-key="${key}" ${isChecked ? "checked" : ""} />
              <span class="g-name">${entry.item}</span>
              ${overlap}
            </label>
          </li>`;
      })
      .join("");
    return `
      <div class="grocery-group">
        <h4>${CATEGORY_LABELS[cat]}</h4>
        <ul>${rows}</ul>
      </div>`;
  });

  els.grocery.innerHTML = sections.join("");
}

// ---------------------------------------------------------------------------
// Rendering — recipe modal
// ---------------------------------------------------------------------------
function openRecipe(id) {
  const r = recipeById(id);
  if (!r) return;
  const ifTip = `<p class="if-tip">💧 IF / calorie-cut: ${r.ifTip}</p>`;
  const ingredients = r.ingredients
    .map((ing) => {
      const qty = ing.qty ? `${ing.qty} ${ing.unit}`.trim() : "";
      return `<li><span class="ing-qty">${qty}</span> ${ing.item}</li>`;
    })
    .join("");
  const steps = r.steps.map((s) => `<li>${s}</li>`).join("");
  const sides = r.sides && r.sides.length
    ? `<h3>🥗 Round it out — serve with</h3>
       <ul class="modal-sides">${r.sides.map((s) => `<li>${s}</li>`).join("")}</ul>`
    : "";

  els.modalBody.innerHTML = `
    <div class="modal-title-row">
      <h2>${r.name}</h2>
      ${cuisineTag(r.cuisine)}
    </div>
    <p class="modal-meta">⏱️ ${r.time} min · ${r.calories} cal/serving · serves ${r.servings}
      · ${METHOD_LABELS[getMethod(r)]}
      ${r.kidFriendly ? " · 👶 Kid-friendly" : ""}</p>
    ${ifTip}
    <h3>Ingredients</h3>
    <ul class="modal-ingredients">${ingredients}</ul>
    <h3>Steps</h3>
    <ol class="modal-steps">${steps}</ol>
    ${sides}`;

  els.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeRecipe() {
  els.modal.classList.add("hidden");
  document.body.style.overflow = "";
}

// ---------------------------------------------------------------------------
// Cuisine chips
// ---------------------------------------------------------------------------
function renderCuisineChips() {
  els.cuisineChips.innerHTML = Object.entries(CUISINE_LABELS)
    .map(([key, label]) => {
      const on = state.filters.cuisines.includes(key);
      return `<button class="chip ${on ? "chip-on" : ""}" data-cuisine="${key}">${label}</button>`;
    })
    .join("");
}

function toggleCuisine(key) {
  const set = new Set(state.filters.cuisines);
  if (set.has(key)) {
    if (set.size === 1) return; // keep at least one on
    set.delete(key);
  } else {
    set.add(key);
  }
  state.filters.cuisines = [...set];
  save();
  renderCuisineChips();
}

// ---------------------------------------------------------------------------
// Cooking-method chips
// ---------------------------------------------------------------------------
function renderMethodChips() {
  const on = new Set(state.filters.methods || Object.keys(METHOD_LABELS));
  els.methodChips.innerHTML = METHOD_ORDER
    .map(
      (key) =>
        `<button class="chip ${on.has(key) ? "chip-on" : ""}" data-method="${key}">${METHOD_LABELS[key]}</button>`
    )
    .join("");
}

function toggleMethod(key) {
  const set = new Set(state.filters.methods || Object.keys(METHOD_LABELS));
  if (set.has(key)) {
    if (set.size === 1) return; // keep at least one on
    set.delete(key);
  } else {
    set.add(key);
  }
  state.filters.methods = [...set];
  save();
  renderMethodChips();
}

// ---------------------------------------------------------------------------
// Pantry-first input
// ---------------------------------------------------------------------------
function renderPantrySuggest() {
  const have = pantryTerms();
  els.pantrySuggest.innerHTML = COMMON_PANTRY
    .filter((c) => !have.some((t) => c.includes(t) || t.includes(c)))
    .map((c) => `<button class="chip" data-add="${c}">+ ${c}</button>`)
    .join("");
}

function setPantryFromText(text) {
  state.filters.pantry = text.split(",").map((s) => s.trim()).filter(Boolean);
  save();
  renderPantrySuggest();
}

// ---------------------------------------------------------------------------
// Wire up events
// ---------------------------------------------------------------------------
function syncControlsFromState() {
  els.kidOnly.checked = state.filters.kidOnly;
  els.ifMode.checked = state.filters.ifMode;
  els.blackstoneOnly.checked = state.filters.blackstoneOnly;
  els.pantryInput.value = state.filters.pantry.join(", ");
  renderCuisineChips();
  renderMethodChips();
  renderPantrySuggest();
}

function init() {
  load();
  syncControlsFromState();
  renderPlan();

  els.kidOnly.addEventListener("change", (e) => {
    state.filters.kidOnly = e.target.checked;
    save();
  });
  els.ifMode.addEventListener("change", (e) => {
    state.filters.ifMode = e.target.checked;
    save();
    renderPlan(); // IF tips show/hide live
  });
  els.blackstoneOnly.addEventListener("change", (e) => {
    state.filters.blackstoneOnly = e.target.checked;
    save();
  });

  els.cuisineChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cuisine]");
    if (btn) toggleCuisine(btn.dataset.cuisine);
  });

  els.methodChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-method]");
    if (btn) toggleMethod(btn.dataset.method);
  });

  // Pantry-first: free-text input plus tap-to-add suggestions.
  els.pantryInput.addEventListener("input", (e) => setPantryFromText(e.target.value));
  els.pantrySuggest.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    const list = [...state.filters.pantry, btn.dataset.add];
    els.pantryInput.value = list.join(", ");
    setPantryFromText(els.pantryInput.value);
  });

  const doGenerate = () => {
    if (generatePlan()) {
      renderPlan();
      els.planSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  els.generateBtn.addEventListener("click", doGenerate);
  els.reshuffleBtn.addEventListener("click", doGenerate);

  // Delegated clicks for the plan, swaps, resting list, and swap-picker modal.
  document.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick-id]");
    if (pick) {
      replaceDay(Number(pick.dataset.pickDay), pick.dataset.pickId);
      closeRecipe();
      return;
    }
    const surprise = e.target.closest(".picker-surprise");
    if (surprise) {
      const day = Number(surprise.dataset.day);
      const first = candidatesForDay(day);
      if (first.length) replaceDay(day, shuffle(first).slice(0, Math.min(8, first.length))[0].id);
      closeRecipe();
      return;
    }
    const view = e.target.closest(".view-recipe");
    if (view) {
      openRecipe(view.dataset.id);
      return;
    }
    const swap = e.target.closest(".swap-day");
    if (swap) {
      openSwapPicker(Number(swap.dataset.day));
      return;
    }
    const lock = e.target.closest(".lock-day");
    if (lock) {
      toggleLock(lock.dataset.id);
      return;
    }
    const rest = e.target.closest(".rest-day");
    if (rest) {
      restMeal(Number(rest.dataset.day));
      return;
    }
    const bringBack = e.target.closest(".un-rest");
    if (bringBack) {
      unRest(bringBack.dataset.id);
      return;
    }
  });

  // Grocery checkboxes (delegated).
  els.grocery.addEventListener("change", (e) => {
    const box = e.target.closest(".grocery-check");
    if (!box) return;
    state.checked[box.dataset.key] = box.checked;
    save();
    box.closest(".grocery-item").classList.toggle("got-it", box.checked);
  });

  els.clearChecksBtn.addEventListener("click", () => {
    state.checked = {};
    save();
    renderGrocery();
  });

  // Modal close interactions.
  els.modalClose.addEventListener("click", closeRecipe);
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal) closeRecipe();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.modal.classList.contains("hidden")) closeRecipe();
  });
}

document.addEventListener("DOMContentLoaded", init);
