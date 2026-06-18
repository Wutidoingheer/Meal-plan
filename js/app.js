/*
 * Family Dinner Planner — app logic.
 * Pure vanilla JS, no build step. State persists in localStorage so the plan
 * and grocery checkmarks survive a page refresh.
 */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STORAGE_KEY = "dinnerPlanner.v1";

// --- DOM refs ---
const els = {
  kidOnly: document.getElementById("kidOnly"),
  ifMode: document.getElementById("ifMode"),
  blackstoneOnly: document.getElementById("blackstoneOnly"),
  cuisineChips: document.getElementById("cuisineChips"),
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
  filters: {
    cuisines: Object.keys(CUISINE_LABELS), // all on by default
    kidOnly: false,
    ifMode: false,
    blackstoneOnly: false,
  },
};

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

function matchesFilters(recipe) {
  if (!state.filters.cuisines.includes(recipe.cuisine)) return false;
  if (state.filters.kidOnly && !recipe.kidFriendly) return false;
  if (state.filters.blackstoneOnly && !recipe.blackstone) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
function generatePlan() {
  const pool = RECIPES.filter(matchesFilters);

  if (pool.length < 7) {
    alert(
      `Only ${pool.length} recipes match these filters — need at least 7 for a week. ` +
      `Try turning a filter off or adding more cuisines.`
    );
    return false;
  }

  // Spread cuisines so the week feels varied: round-robin pick from shuffled
  // per-cuisine buckets before falling back to whatever's left.
  const buckets = {};
  shuffle(pool).forEach((r) => {
    (buckets[r.cuisine] = buckets[r.cuisine] || []).push(r);
  });

  const picked = [];
  const cuisineKeys = shuffle(Object.keys(buckets));
  let exhausted = false;
  while (picked.length < 7 && !exhausted) {
    exhausted = true;
    for (const key of cuisineKeys) {
      if (buckets[key].length) {
        picked.push(buckets[key].shift());
        exhausted = false;
        if (picked.length === 7) break;
      }
    }
  }

  state.planIds = picked.map((r) => r.id);

  // Swaps: up to 3 recipes from the pool that aren't already in the plan.
  const leftovers = pool.filter((r) => !state.planIds.includes(r.id));
  state.swapIds = shuffle(leftovers).slice(0, 3).map((r) => r.id);

  // Reset grocery checks for the new plan.
  state.checked = {};
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
      const badges = [
        r.blackstone ? `<span class="badge">🔥 Blackstone</span>` : "",
        r.kidFriendly ? `<span class="badge">👶 Kid-friendly</span>` : "",
      ].join("");
      const ifTip = state.filters.ifMode
        ? `<p class="if-tip">💧 IF tip: ${r.ifTip}</p>`
        : "";
      return `
        <li class="meal-card" data-id="${r.id}">
          <div class="meal-day">${DAYS[i]}</div>
          <div class="meal-main">
            <div class="meal-title-row">
              <h3>${r.name}</h3>
              ${cuisineTag(r.cuisine)}
            </div>
            <div class="meal-meta">⏱️ ${r.time} min · ${r.calories} cal/serv · serves ${r.servings}</div>
            <div class="badges">${badges}</div>
            ${ifTip}
            <div class="meal-actions">
              <button class="link-btn view-recipe" data-id="${r.id}">View recipe →</button>
              <button class="link-btn swap-day" data-day="${i}">🔄 Swap this day</button>
            </div>
          </div>
        </li>`;
    })
    .join("");

  renderSwaps();
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

// Swap a single day with a fresh recipe not already used anywhere.
function swapDay(dayIndex) {
  const used = new Set([...state.planIds, ...state.swapIds]);
  const candidates = RECIPES.filter((r) => matchesFilters(r) && !used.has(r.id));
  if (!candidates.length) {
    alert("No other recipes available with the current filters to swap in.");
    return;
  }
  const pick = shuffle(candidates)[0];
  state.planIds[dayIndex] = pick.id;
  state.checked = {}; // ingredients changed
  save();
  renderPlan();
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
        const isChecked = !!state.checked[key];
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

  els.modalBody.innerHTML = `
    <div class="modal-title-row">
      <h2>${r.name}</h2>
      ${cuisineTag(r.cuisine)}
    </div>
    <p class="modal-meta">⏱️ ${r.time} min · ${r.calories} cal/serving · serves ${r.servings}
      ${r.blackstone ? " · 🔥 Blackstone-friendly" : ""}
      ${r.kidFriendly ? " · 👶 Kid-friendly" : ""}</p>
    ${ifTip}
    <h3>Ingredients</h3>
    <ul class="modal-ingredients">${ingredients}</ul>
    <h3>Steps</h3>
    <ol class="modal-steps">${steps}</ol>`;

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
// Wire up events
// ---------------------------------------------------------------------------
function syncControlsFromState() {
  els.kidOnly.checked = state.filters.kidOnly;
  els.ifMode.checked = state.filters.ifMode;
  els.blackstoneOnly.checked = state.filters.blackstoneOnly;
  renderCuisineChips();
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

  const doGenerate = () => {
    if (generatePlan()) {
      renderPlan();
      els.planSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  els.generateBtn.addEventListener("click", doGenerate);
  els.reshuffleBtn.addEventListener("click", doGenerate);

  // Delegated clicks for view/swap buttons across plan + swaps.
  document.addEventListener("click", (e) => {
    const view = e.target.closest(".view-recipe");
    if (view) {
      openRecipe(view.dataset.id);
      return;
    }
    const swap = e.target.closest(".swap-day");
    if (swap) {
      swapDay(Number(swap.dataset.day));
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
