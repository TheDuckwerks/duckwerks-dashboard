# Cross-Cutting Design Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 10 cross-cutting design primitives from spec #107 — empty-state helpers, localStorage-backed sort, slim hero-band, filter chip labels, filter-aware tape KPIs, auto-hide columns, toast, and inventory export — before the per-view tickets (#102–#106) land.

**Architecture:** Sequential tasks grouped by file layer. Tasks 1–2 build the shared primitives in `store.js` and `components.css`. Tasks 3–4 wire sort persistence and slim hero-band. Tasks 5–9 apply each remaining feature in priority order. All tasks are independently commit-able.

**Tech Stack:** Alpine.js v3, vanilla CSS, no build step. `Alpine.store('dw')` is the global reactive store defined in `public/v2/js/store.js`. Views are `Alpine.data(...)` components in `public/v2/js/views/*.js`. All HTML is in `public/v2/index.html` (2258 lines — always grep before reading, never read in full).

**Important note on sort:** `items.js`, `lots.js`, and `analytics.js` already have `sortKey`, `sortDir`, `sortBy(key)`, and `sortIndicator(key)` defined. Task 3 adds localStorage persistence to these existing methods and renames `sortIndicator` → `sortGlyph` (adding `↕` for inactive). `comps.js` has no sort — Task 3 adds it there from scratch.

---

## File Map

| File | Changes |
|---|---|
| `public/v2/js/store.js` | Add: `fmtMoney`, `isZero`, `allSame`, `filteredKpis`, `setFilteredKpis`, `clearFilteredKpis`, `toastMsg`, `toastType`, `notify`, `dismissToast` |
| `public/v2/js/sortable.js` | **New** — `window.dwSortable` utility: `load(view, defaultCol, defaultDir)` / `save(view, col, dir)` |
| `public/v2/js/views/items.js` | Update `sortBy` + `sortIndicator`→`sortGlyph` for localStorage; add `_pushFilteredKpis`; add `exportCsv` |
| `public/v2/js/views/lots.js` | Update `sortBy` + `sortIndicator`→`sortGlyph` for localStorage |
| `public/v2/js/views/analytics.js` | Update `sortBy` + `sortIndicator`→`sortGlyph` for localStorage; add `_pushFilteredKpis` |
| `public/v2/js/views/comps.js` | Add `sortKey`, `sortDir`, `sortBy`, `sortGlyph` with localStorage; add `showTypeCol` |
| `public/v2/css/components.css` | Add: `.hero-band.slim`, `.filter-group-label`, row-click affordance CSS, `.toast` styles |
| `public/v2/index.html` | Apply `slim` to non-dashboard hero-bands; add filter chip labels; update tape for filtered KPIs; add toast markup; add export button; update `sortIndicator(` → `sortGlyph(`; add `x-show` on comps type column |

---

## Task 1: Store primitives — `fmtMoney`, `isZero`, `allSame`, toast, filteredKpis

**Files:**
- Modify: `public/v2/js/store.js`

Read `store.js` in full before editing (it's 380 lines, safe to read).

- [ ] **Step 1: Read `store.js`** to find the end of the store's data object (just before the closing `}`). You'll be adding new properties and methods there.

- [ ] **Step 2: Add `fmtMoney` and `isZero` to the store object**

Find the line with `fmtK(n)` in `store.js` (around line 241). After that line, add:

```js
fmtMoney(val) {
  if (val == null) return '—';
  if (val === 0)   return '$0';
  return '$' + Math.abs(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
},
isZero(val) { return val === 0; },
```

- [ ] **Step 3: Add `allSame` utility**

After `isZero`, add:

```js
allSame(rows, field) {
  if (!rows || rows.length === 0) return true;
  const first = rows[0]?.[field];
  return rows.every(r => r[field] === first);
},
```

- [ ] **Step 4: Add `filteredKpis` state and methods**

After `allSame`, add:

```js
filteredKpis: null,
setFilteredKpis(kpis) { this.filteredKpis = kpis; },
clearFilteredKpis()   { this.filteredKpis = null; },
```

- [ ] **Step 5: Add toast state and methods**

After `clearFilteredKpis`, add:

```js
toastMsg:    null,
toastType:   'success',
_toastTimer: null,

notify(msg, type = 'success') {
  clearTimeout(this._toastTimer);
  this.toastMsg  = msg;
  this.toastType = type;
  if (type === 'success') {
    this._toastTimer = setTimeout(() => { this.toastMsg = null; }, 3000);
  }
},
dismissToast() { this.toastMsg = null; },
```

- [ ] **Step 6: Verify — open browser console and test**

```bash
npm start
```

Open http://localhost:3000, then in browser console:
```js
Alpine.store('dw').fmtMoney(null)    // → '—'
Alpine.store('dw').fmtMoney(0)       // → '$0'
Alpine.store('dw').fmtMoney(1234)    // → '$1,234'
Alpine.store('dw').allSame([{a:1},{a:1}], 'a')   // → true
Alpine.store('dw').allSame([{a:1},{a:2}], 'a')   // → false
Alpine.store('dw').notify('Test', 'success')     // toastMsg should be 'Test'
Alpine.store('dw').toastMsg                      // → 'Test'
```

- [ ] **Step 7: Commit**

```bash
git add public/v2/js/store.js
git commit -m "feat: add fmtMoney, isZero, allSame, filteredKpis, toast to store ref #107"
git push
```

---

## Task 2: CSS primitives — slim hero-band, filter labels, row-click, toast styles

**Files:**
- Modify: `public/v2/css/components.css`

Append all new rules to the end of `components.css` in one edit.

- [ ] **Step 1: Append new CSS to `components.css`**

```css
/* ── Slim hero-band (non-dashboard views) ─────────────────────────────── */

.hero-band.slim {
  height: 44px;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  grid-template-columns: unset;
}
.hero-band.slim .hero-photo {
  width: 80px;
  height: 44px;
  flex-shrink: 0;
  background-size: cover;
  border-right: 1px solid var(--line);
}
.hero-band.slim .hero-head {
  flex-direction: row;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
  flex: 1;
}
.hero-band.slim .hero-crumbs {
  white-space: nowrap;
}
.hero-band.slim .hero-title {
  font-size: 16px;
  white-space: nowrap;
}
.hero-band.slim .hero-tools {
  margin-left: auto;
}

/* ── Filter group label ───────────────────────────────────────────────── */

.filter-group-label {
  font: 500 10px/1 var(--mono);
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--ink-4);
  align-self: center;
  padding-right: 4px;
  white-space: nowrap;
}

/* ── Row-click affordance (interactive tables only) ───────────────────── */

table.tbl tbody tr.clickable,
table.data-table tbody tr.clickable {
  cursor: pointer;
}
table.tbl tbody tr.clickable:hover,
table.data-table tbody tr.clickable:hover {
  background: #111;
}
table.tbl tbody tr.clickable:hover td:last-child::after,
table.data-table tbody tr.clickable:hover td:last-child::after {
  content: ' →';
  color: var(--ink-4);
  font-size: 11px;
}

/* ── Tape filtered secondary value ───────────────────────────────────── */

.tape-filtered {
  color: var(--ink-4);
  font-size: 10px;
  letter-spacing: .08em;
  margin-left: 4px;
}
.tape-filtered b {
  color: var(--ink-2);
}

/* ── Toast notification ───────────────────────────────────────────────── */

#toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 500;
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  border-left: 3px solid var(--pos);
  padding: 10px 16px;
  font: 500 12px/1.4 var(--mono);
  letter-spacing: .06em;
  color: var(--ink);
  min-width: 200px;
  max-width: 360px;
  cursor: pointer;
  transition: opacity .2s, transform .2s;
}
#toast.error {
  border-left-color: var(--neg);
}
#toast[x-cloak], #toast[style*="display: none"] {
  display: none !important;
}
```

- [ ] **Step 2: Verify app still loads**

```bash
npm start
```

Open http://localhost:3000. No visual regressions — the new CSS classes aren't applied anywhere yet so nothing should change.

- [ ] **Step 3: Commit**

```bash
git add public/v2/css/components.css
git commit -m "style: add slim hero-band, filter-group-label, row-click, toast CSS ref #107"
git push
```

---

## Task 3: Sort localStorage persistence + `sortGlyph`

**Files:**
- Create: `public/v2/js/sortable.js`
- Modify: `public/v2/js/views/items.js`
- Modify: `public/v2/js/views/lots.js`
- Modify: `public/v2/js/views/analytics.js`
- Modify: `public/v2/js/views/comps.js`
- Modify: `public/v2/index.html` (script tag + `sortIndicator` → `sortGlyph`)

- [ ] **Step 1: Create `public/v2/js/sortable.js`**

```js
// Shared localStorage-backed sort state utility.
// Usage: call dwSortable.load(view, defaultCol, defaultDir) in init()
//        call dwSortable.save(view, col, dir) in sortBy()
window.dwSortable = {
  load(view, defaultCol, defaultDir) {
    try {
      const saved = JSON.parse(localStorage.getItem('dw_sort_' + view));
      if (saved?.col) return { col: saved.col, dir: saved.dir || defaultDir };
    } catch {}
    return { col: defaultCol, dir: defaultDir };
  },
  save(view, col, dir) {
    try { localStorage.setItem('dw_sort_' + view, JSON.stringify({ col, dir })); } catch {}
  },
};
```

- [ ] **Step 2: Update `items.js` — load sort from localStorage in `init`, save in `sortBy`, rename `sortIndicator` → `sortGlyph`**

In `items.js`, in the `init()` method, after the existing `$watch` calls, add:

```js
const saved = dwSortable.load('items', 'createdTime', 'desc');
this.sortKey = saved.col;
this.sortDir = saved.dir;
```

Replace the existing `sortBy` method:

```js
sortBy(key) {
  if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
  else { this.sortKey = key; this.sortDir = 'asc'; }
  dwSortable.save('items', this.sortKey, this.sortDir);
},
```

Replace the existing `sortIndicator` method with `sortGlyph`:

```js
sortGlyph(key) {
  if (this.sortKey !== key) return '↕';
  return this.sortDir === 'asc' ? '↑' : '↓';
},
```

- [ ] **Step 3: Update `lots.js` — same pattern**

In `lots.js` `init()` (it currently has no `init` — add one, or if there's only a sort-related block at the top, add an init that loads state):

Read `lots.js` fully first (68 lines). Add an `init()` method:

```js
init() {
  const saved = dwSortable.load('lots', 'name', 'asc');
  this.sortKey = saved.col;
  this.sortDir = saved.dir;
},
```

Replace `sortBy`:

```js
sortBy(key) {
  if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
  else { this.sortKey = key; this.sortDir = 'asc'; }
  dwSortable.save('lots', this.sortKey, this.sortDir);
},
```

Replace `sortIndicator` with `sortGlyph`:

```js
sortGlyph(key) {
  if (this.sortKey !== key) return '↕';
  return this.sortDir === 'asc' ? '↑' : '↓';
},
```

- [ ] **Step 4: Update `analytics.js` — same pattern**

`analytics.js` is 289 lines — grep first:

```bash
grep -n "sortKey\|sortBy\|sortIndicator\|init()" public/v2/js/views/analytics.js
```

In `analytics.js` `init()`, after existing code, add:

```js
const saved = dwSortable.load('analytics', 'views', 'desc');
this.sortKey = saved.col;
this.sortDir = saved.dir;
```

Replace `sortBy`:

```js
sortBy(key) {
  if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
  else { this.sortKey = key; this.sortDir = 'asc'; }
  dwSortable.save('analytics', this.sortKey, this.sortDir);
},
```

Replace `sortIndicator` with `sortGlyph`:

```js
sortGlyph(key) {
  if (this.sortKey !== key) return '↕';
  return this.sortDir === 'asc' ? '↑' : '↓';
},
```

- [ ] **Step 5: Add sort to `comps.js`**

`comps.js` has no sort. The results table (each `result.csv` parsed into rows) has columns: `row.title`, `row.sold_price`, `row.sale_type`, `row.sold_date`. We sort the parsed rows.

In `comps.js`, add these properties at the top of the data object (alongside `items`, `results`, `running`):

```js
sortKey: 'sold_price',
sortDir: 'desc',
```

Add an `init()` method (comps currently has one — add to it):

```js
// In existing init(), add:
const saved = dwSortable.load('comps', 'sold_price', 'desc');
this.sortKey = saved.col;
this.sortDir = saved.dir;
```

Add `sortBy` and `sortGlyph` methods to `compsView`:

```js
sortBy(key) {
  if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
  else { this.sortKey = key; this.sortDir = 'asc'; }
  dwSortable.save('comps', this.sortKey, this.sortDir);
},
sortGlyph(key) {
  if (this.sortKey !== key) return '↕';
  return this.sortDir === 'asc' ? '↑' : '↓';
},
sortedComps(rows) {
  if (!rows?.length) return [];
  const key = this.sortKey, dir = this.sortDir;
  return [...rows].sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === 'sold_price') { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ?  1 : -1;
    return 0;
  });
},
```

Also add `showTypeCol` computed (auto-hide when all rows are same `sale_type`):

```js
get showTypeCol() {
  const allRows = this.results.flatMap(r => {
    const lines = (r.csv || '').split('\n').filter(Boolean);
    return lines.slice(1).map(line => {
      const cols = line.split(',');
      return { sale_type: cols[3]?.trim() || '' };
    });
  });
  return !Alpine.store('dw').allSame(allRows, 'sale_type');
},
```

- [ ] **Step 6: Add `<script>` tag for `sortable.js` in `index.html`**

Grep for where the other view scripts are loaded:

```bash
grep -n "<script src=" public/v2/index.html | tail -15
```

Add `sortable.js` before the view scripts (it must load before any view that calls `dwSortable`):

```html
<script src="js/sortable.js"></script>
```

Place it immediately before the first `<script src="js/views/` tag.

- [ ] **Step 7: Update `sortIndicator` → `sortGlyph` in `index.html`**

There are multiple `sortIndicator(` calls in `index.html`. Replace all occurrences:

```bash
grep -n "sortIndicator" public/v2/index.html
```

For each occurrence, change `sortIndicator(` to `sortGlyph(`. Use str_replace for each unique surrounding context, or verify they're identical and replace all.

- [ ] **Step 8: Verify sort + persistence**

```bash
npm start
```

Open http://localhost:3000. Go to Inventory, click "Name" column header — rows should sort alphabetically, `↑` glyph appears. Click again — `↓`. Reload page — sort should be preserved (localStorage). Repeat on Lots and Analytics views. No console errors.

- [ ] **Step 9: Commit**

```bash
git add public/v2/js/sortable.js public/v2/js/views/items.js public/v2/js/views/lots.js public/v2/js/views/analytics.js public/v2/js/views/comps.js public/v2/index.html
git commit -m "feat: localStorage sort persistence + sortGlyph across all table views ref #107"
git push
```

---

## Task 4: Slim hero-band on non-dashboard views

**Files:**
- Modify: `public/v2/index.html`

- [ ] **Step 1: Identify all non-dashboard `hero-band` occurrences**

```bash
grep -n "class=\"hero-band\"" public/v2/index.html
```

Expected output: lines for dashboard (leave alone), items, lots, analytics, comps, catalog.

- [ ] **Step 2: Add `slim` class to non-dashboard hero-bands**

For each non-dashboard `hero-band`, change `class="hero-band"` to `class="hero-band slim"`. Leave the dashboard hero-band untouched (it's inside `x-show="$store.dw.activeView === 'dashboard'"`).

Use str_replace for each view section. Example for items (line ~377):

```html
<!-- Before -->
<div class="hero-band">

<!-- After -->
<div class="hero-band slim">
```

Repeat for lots (~471), analytics (~520), comps (~624), catalog (~752).

- [ ] **Step 3: Verify slim hero-band visually**

```bash
npm start
```

Navigate to Inventory, Lots, Analytics, Comps, Catalog — each should show a 44px-tall header strip with the photo thumbnail on the left and the breadcrumb inline. Dashboard should still show the full 100px hero. No layout breakage.

- [ ] **Step 4: Commit**

```bash
git add public/v2/index.html
git commit -m "style: slim hero-band on all non-dashboard views ref #107"
git push
```

---

## Task 5: Filter chip labels

**Files:**
- Modify: `public/v2/index.html`

- [ ] **Step 1: Locate filter pill rows in items view**

```bash
grep -n "pill-row\|pill\|filter\|controls-row" public/v2/index.html | head -20
```

The items view has two `.pill-row` groups inside `.controls-row` — one for status, one for sites.

- [ ] **Step 2: Add labels to items filter groups**

Find the `.controls-row` div in the items section (around line 392). Add a `.filter-group-label` span before each `.pill-row`:

```html
<!-- Before -->
<div class="controls-row">
  <div class="pill-row">
    <template x-for="s in ['All','Listed','Sold','Prepping']" :key="s">

<!-- After -->
<div class="controls-row">
  <span class="filter-group-label">Status:</span>
  <div class="pill-row">
    <template x-for="s in ['All','Listed','Sold','Prepping']" :key="s">
```

And before the sites pill-row:

```html
<!-- Before -->
  <div class="pill-row">
    <button class="pill" :class="{ active: siteFilter === 'All' }"

<!-- After -->
  <span class="filter-group-label">Sites:</span>
  <div class="pill-row">
    <button class="pill" :class="{ active: siteFilter === 'All' }"
```

- [ ] **Step 3: Locate and label analytics filter groups**

```bash
grep -n "pill-row\|pill\|listedSiteFilter\|soldSiteFilter\|controls" public/v2/index.html | grep -A2 -B2 "analytics\|520\|521\|522\|523\|524\|525"
```

Find the analytics filter pills and add `<span class="filter-group-label">Sites:</span>` before each site filter group.

- [ ] **Step 4: Verify labels appear**

```bash
npm start
```

In Inventory and Analytics, the filter bar should show `Status:` before the status pills and `Sites:` before the site pills. Labels should be uppercase, muted gray, small.

- [ ] **Step 5: Commit**

```bash
git add public/v2/index.html
git commit -m "style: add Status/Sites labels to filter chip groups ref #107"
git push
```

---

## Task 6: Row-click affordance

**Files:**
- Modify: `public/v2/index.html`

The CSS already exists (Task 2). This task adds the `clickable` class to the correct table rows.

- [ ] **Step 1: Find inventory table rows**

```bash
grep -n "data-table\|<tr\|openItem\|openLot" public/v2/index.html | grep -v "thead\|sortable\|th " | head -20
```

- [ ] **Step 2: Add `clickable` class to inventory item rows**

Find the `<tr>` tag in the items table that has `@click="openItem(r)"` (or similar). Add `class="clickable"` to it. If it uses `:class`, merge: `:class="{ ... }" class="clickable"` → move to `:class="{ clickable: true, ... }"` or just add `class="clickable"` alongside.

Example:
```html
<!-- Before -->
<tr @click="openItem(r)">

<!-- After -->
<tr class="clickable" @click="openItem(r)">
```

- [ ] **Step 3: Add `clickable` class to lots table rows**

Find the `<tr>` in the lots table that opens the lot modal. Add `class="clickable"` similarly.

- [ ] **Step 4: Verify hover affordance**

```bash
npm start
```

In Inventory, hover over a row — cursor should change to pointer, background should darken, `→` should appear in the last cell. Dashboard "Recently Sold" and "Recently Listed" tables should NOT show the pointer (they don't have `clickable`).

- [ ] **Step 5: Commit**

```bash
git add public/v2/index.html
git commit -m "style: row-click affordance on inventory and lots tables ref #107"
git push
```

---

## Task 7: Filter-aware KPI tape

**Files:**
- Modify: `public/v2/js/views/items.js`
- Modify: `public/v2/js/views/analytics.js`
- Modify: `public/v2/index.html`

- [ ] **Step 1: Add `_pushFilteredKpis` to `items.js`**

Add a new method `_pushFilteredKpis` to `itemsView`:

```js
_pushFilteredKpis() {
  const dw = Alpine.store('dw');
  const noFilter = this.statusFilter === 'All' && this.siteFilter === 'All' && !dw.categoryFilter;
  if (noFilter) {
    dw.clearFilteredKpis();
    return;
  }
  const rows = this.rows;
  dw.setFilteredKpis({
    cost:    rows.reduce((s, r) => s + (r.cost || 0), 0),
    revenue: rows.filter(r => r.status === 'Sold').reduce((s, r) => s + (r.order?.sale_price || 0), 0),
    profit:  rows.filter(r => r.status === 'Sold').reduce((s, r) => s + (r.order?.profit || 0), 0),
    inv:     rows.length,
    listed:  rows.filter(r => r.status === 'Listed').length,
  });
},
```

- [ ] **Step 2: Wire `_pushFilteredKpis` into `items.js` init**

In `itemsView.init()`, after the existing `$watch` calls, add:

```js
this.$watch('statusFilter',              () => this._pushFilteredKpis());
this.$watch('siteFilter',                () => this._pushFilteredKpis());
this.$watch('$store.dw.categoryFilter',  () => this._pushFilteredKpis());
this.$watch('$store.dw.activeView',      v  => { if (v !== 'items') Alpine.store('dw').clearFilteredKpis(); });
this._pushFilteredKpis();
```

- [ ] **Step 3: Add `_pushFilteredKpis` to `analytics.js`**

Read analytics.js around the filter state (lines 11–75). Add `_pushFilteredKpis` method:

```js
_pushFilteredKpis() {
  const dw = Alpine.store('dw');
  const defaultSites = ['eBay', 'Reverb'];
  const listedFiltered = this.listedSiteFilter.length !== defaultSites.length
    || this.soldSiteFilter.length !== defaultSites.length;
  if (!listedFiltered) {
    dw.clearFilteredKpis();
    return;
  }
  const listed = this.sortedListedRows;
  const sold   = this.sortedSoldRows;
  dw.setFilteredKpis({
    cost:    0,
    revenue: sold.reduce((s, r) => s + (r.sale_price || 0), 0),
    profit:  sold.reduce((s, r) => s + (r.profit || 0), 0),
    inv:     listed.length + sold.length,
    listed:  listed.length,
  });
},
```

In `analytics.js` init(), add:

```js
this.$watch('listedSiteFilter', () => this._pushFilteredKpis());
this.$watch('soldSiteFilter',   () => this._pushFilteredKpis());
this.$watch('$store.dw.activeView', v => { if (v !== 'analytics') Alpine.store('dw').clearFilteredKpis(); });
```

- [ ] **Step 4: Update tape HTML in `index.html` for filtered secondary values**

Grep tape section lines:
```bash
grep -n "tape-item\|tape-live\|tape-filtered" public/v2/index.html | head -20
```

For each of the 5 relevant tape items (cost, recov, profit, inv, listed), add a conditional filtered secondary. The tape is around lines 23–42. Replace those tape items:

```html
<div class="tape-item">cost
  <b class="dn" x-text="'$' + Alpine.store('dw').records.reduce((s,r)=>s+(r.cost||0),0).toLocaleString('en-US',{maximumFractionDigits:0})"></b>
  <template x-if="Alpine.store('dw').filteredKpis">
    <span class="tape-filtered">· <b x-text="'$' + Alpine.store('dw').filteredKpis.cost.toLocaleString('en-US',{maximumFractionDigits:0})"></b> flt</span>
  </template>
</div>
<div class="tape-item">recov
  <b class="up" x-text="'$' + Alpine.store('dw').soldRecords.reduce((s,r)=>s+(r.order?.sale_price||0),0).toLocaleString('en-US',{maximumFractionDigits:0})"></b>
  <template x-if="Alpine.store('dw').filteredKpis">
    <span class="tape-filtered">· <b x-text="'$' + Alpine.store('dw').filteredKpis.revenue.toLocaleString('en-US',{maximumFractionDigits:0})"></b> flt</span>
  </template>
</div>
<div class="tape-item">profit
  <b class="up" x-text="(()=>{const p=Alpine.store('dw').soldRecords.reduce((s,r)=>s+(r.order?.profit||0),0);return(p>=0?'+':'')+' $'+Math.abs(p).toLocaleString('en-US',{maximumFractionDigits:0})})()"></b>
  <template x-if="Alpine.store('dw').filteredKpis">
    <span class="tape-filtered">· <b x-text="(Alpine.store('dw').filteredKpis.profit >= 0 ? '+' : '-') + '$' + Math.abs(Alpine.store('dw').filteredKpis.profit).toLocaleString('en-US',{maximumFractionDigits:0})"></b> flt</span>
  </template>
</div>
<div class="tape-item">inv
  <b x-text="Alpine.store('dw').records.length"></b>
  <template x-if="Alpine.store('dw').filteredKpis">
    <span class="tape-filtered">· <b x-text="Alpine.store('dw').filteredKpis.inv"></b> flt</span>
  </template>
</div>
<div class="tape-item">listed
  <b x-text="Alpine.store('dw').listedRecords.length"></b>
  <template x-if="Alpine.store('dw').filteredKpis">
    <span class="tape-filtered">· <b x-text="Alpine.store('dw').filteredKpis.listed"></b> flt</span>
  </template>
</div>
```

Leave the `sold` tape item (6th) unchanged — no filtered equivalent.

- [ ] **Step 5: Verify filtered KPIs**

```bash
npm start
```

In Inventory, set Status filter to "Listed" — tape should show e.g. `cost $8,366 · $1,301 flt`. Set status back to "All" — secondary disappears. Navigate to Analytics, toggle a site filter — tape should update. Navigate away — secondary disappears.

- [ ] **Step 6: Commit**

```bash
git add public/v2/js/views/items.js public/v2/js/views/analytics.js public/v2/index.html
git commit -m "feat: filter-aware KPI tape shows filtered secondary on items/analytics ref #107"
git push
```

---

## Task 8: Auto-hide uniform columns (Comps `type` column)

**Files:**
- Modify: `public/v2/index.html`

The `allSame` utility was added in Task 1. The `showTypeCol` getter was added to `comps.js` in Task 3. This task wires the `x-show` in HTML.

- [ ] **Step 1: Find the comps results table type column**

```bash
grep -n "sale_type\|row\.sale_type\|type.*col\|BIN\|Auction" public/v2/index.html | head -10
```

Find the `<th>` for the type column and the corresponding `<td>`.

- [ ] **Step 2: Add `x-show="showTypeCol"` to comps type column**

For the `<th>`:
```html
<!-- Before -->
<th>Type</th>

<!-- After -->
<th x-show="showTypeCol">Type</th>
```

For the `<td>`:
```html
<!-- Before -->
<td x-text="row.sale_type" style="color:var(--muted)"></td>

<!-- After -->
<td x-show="showTypeCol" x-text="row.sale_type" style="color:var(--muted)"></td>
```

Also add sortable headers to the comps results table now that `sortBy`/`sortGlyph` are available in `compsView`. Update the `<template x-for>` that iterates comp rows to use `sortedComps(result.parsedRows)` instead of raw `result.parsedRows` (or however the template iterates comps rows — read that section first).

```bash
grep -n "x-for.*row\|parsedRows\|csv.*row\|result.*row" public/v2/index.html | head -10
```

- [ ] **Step 3: Verify auto-hide**

```bash
npm start
```

Run a comp search that returns all BIN results. The Type column should be hidden. Run one with mixed types — column should appear.

- [ ] **Step 4: Commit**

```bash
git add public/v2/index.html public/v2/js/views/comps.js
git commit -m "feat: auto-hide uniform type column in comps results ref #107"
git push
```

---

## Task 9: Toast markup in `index.html` + wire existing `alert()` calls

**Files:**
- Modify: `public/v2/index.html`
- Modify: `public/v2/js/views/items.js` (if any alert() present)
- Modify: `public/v2/js/views/comps.js` (if any alert() present)
- Modify: `public/v2/js/store.js` (if any alert() present)

- [ ] **Step 1: Add toast markup to `index.html`**

Find the closing `</body>` tag. Add just before it:

```html
<!-- Toast notification -->
<div id="toast"
     x-data
     x-show="$store.dw.toastMsg"
     :class="{ error: $store.dw.toastType === 'error' }"
     @click="$store.dw.dismissToast()"
     x-transition:enter="transition ease-out duration-200"
     x-transition:enter-start="opacity-0 translate-y-2"
     x-transition:enter-end="opacity-100 translate-y-0"
     x-transition:leave="transition ease-in duration-150"
     x-transition:leave-start="opacity-100"
     x-transition:leave-end="opacity-0"
     x-text="$store.dw.toastMsg"
     style="display:none">
</div>
```

- [ ] **Step 2: Find any existing `alert()` calls**

```bash
grep -rn "alert(" public/v2/js/
```

For each `alert('...')` found, replace with `Alpine.store('dw').notify('...', 'error')` or `'success'` depending on context.

- [ ] **Step 3: Wire save success toasts in `store.js`**

In `store.js`, find the `updateItem`, `createItem`, `deleteLot` (or similar save methods). After successful saves, add:

```bash
grep -n "updateItem\|createItem\|deleteItem\|updateLot\|createLot\|deleteLot\|fetch.*PUT\|fetch.*POST\|fetch.*DELETE" public/v2/js/store.js | head -20
```

For each mutation method that currently doesn't give feedback, add a `this.notify('Saved', 'success')` call after the successful response. For error catch blocks, add `this.notify('Error: ' + (e.message || 'save failed'), 'error')`.

Example pattern for a save method:
```js
async updateItem(id, fields) {
  try {
    const res = await fetch(`/api/items/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(fields) });
    if (!res.ok) throw new Error(await res.text());
    // ... existing store update logic ...
    this.notify('Saved', 'success');
  } catch (e) {
    this.notify('Error: ' + e.message, 'error');
  }
},
```

Only add toasts to methods that currently have no user feedback. Don't double-up on views that already display inline errors.

- [ ] **Step 4: Verify toast**

```bash
npm start
```

Edit an item and save — a green-accented "Saved" toast should appear bottom-right and auto-dismiss after 3 seconds. Click it to dismiss early. Test an error case if possible (e.g., disconnect network or trigger a known error path).

- [ ] **Step 5: Commit**

```bash
git add public/v2/index.html public/v2/js/store.js public/v2/js/views/items.js public/v2/js/views/comps.js
git commit -m "feat: toast notification component — success auto-dismiss, error on click ref #107"
git push
```

---

## Task 10: Catalog page shell + Inventory export button

**Files:**
- Modify: `public/v2/index.html`
- Modify: `public/v2/js/views/items.js`

- [ ] **Step 1: Verify catalog hero-band**

```bash
grep -n "catalog\|hero-band" public/v2/index.html | grep -A3 "catalogView\|activeView.*catalog"
```

Catalog already has a `.hero-band`. Verify it now has `slim` (from Task 4). Check if the primary CTA (Add button) is in `.hero-tools`. If it's outside the hero-band, move it inside `.hero-tools`.

- [ ] **Step 2: Add `exportCsv` to `items.js`**

Add to `itemsView`:

```js
exportCsv() {
  const dw    = Alpine.store('dw');
  const rows  = this.rows;
  const headers = ['SKU','Name','Category','Status','Site','Cost','List Price','Sale Price','Profit','Date Added'];
  const escape  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines   = [
    headers.join(','),
    ...rows.map(r => [
      escape(r.sku || ''),
      escape(r.name || ''),
      escape(r.category?.name || ''),
      escape(r.status || ''),
      escape(dw.siteLabel(r) || ''),
      r.cost ?? '',
      dw.activeListing(r)?.list_price ?? '',
      r.order?.sale_price ?? '',
      r.order?.profit ?? '',
      escape(r.created_at ? new Date(r.created_at).toLocaleDateString('en-US') : ''),
    ].join(','))
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dw-inventory-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
},
```

- [ ] **Step 3: Add Export button to inventory hero-band in `index.html`**

Find the items view hero-band `.hero-tools` div (around line 383). Add the export button:

```html
<div class="hero-tools">
  <button class="tool-btn" @click="exportCsv()">⬇ Export</button>
  <button class="tool-btn primary" @click="$store.dw.openModal('add')">+ Add Item</button>
</div>
```

- [ ] **Step 4: Verify export**

```bash
npm start
```

Go to Inventory. Click "⬇ Export" — a CSV file should download named `dw-inventory-YYYY-MM-DD.csv`. Open it — should have headers and rows matching what's visible in the table. Apply a filter (e.g. Status: Listed), click Export again — only filtered rows should appear in the CSV.

- [ ] **Step 5: Bump version**

```bash
grep -n "APP_VERSION" public/v2/js/config.js
```

Increment the patch version in `public/v2/js/config.js` and `package.json`.

- [ ] **Step 6: Commit**

```bash
git add public/v2/index.html public/v2/js/views/items.js public/v2/js/config.js package.json
git commit -m "feat: inventory CSV export + catalog page shell ref #107"
git push
```

---

## Self-Review

**Spec coverage check:**

| Spec item | Covered by |
|---|---|
| 1. Empty-state convention (`fmtMoney`, `isZero`) | Task 1 |
| 2. Sortable column component + localStorage | Tasks 3 |
| 3. Row-click affordance | Tasks 2 + 6 |
| 4. Slim hero-band | Tasks 2 + 4 |
| 5. Filter chip labeling | Task 5 |
| 6. Filter-aware KPI tape | Tasks 1 + 7 |
| 7. Auto-hide uniform columns (`allSame`, comps type col) | Tasks 1 + 3 + 8 |
| 8. Toast component | Tasks 1 + 2 + 9 |
| 9. Page shell consistency (catalog) | Task 10 |
| 10. Inventory export button | Task 10 |

**Placeholder scan:** No TBDs. All code blocks are complete. Step 7 of Task 3 (`sortIndicator` → `sortGlyph` replacement) directs a grep-first approach because there are multiple occurrences — this is appropriate for a 2258-line file.

**Note on `fmtMoney` wire-up:** Task 1 adds `fmtMoney` and `isZero` to the store but the plan does not include a pass to replace inline money expressions in `index.html`. The per-view tickets (#102–#106) will apply `fmtMoney` as they touch each view's table HTML. This is intentional scope control — the helpers exist and are ready; blanket replacement of 2258 lines of HTML is out of scope for this ticket.

**Type consistency:**
- `dwSortable.load()` → used in `init()` of items/lots/analytics/comps ✓
- `dwSortable.save()` → used in `sortBy()` of all four views ✓
- `sortGlyph(key)` → replaces `sortIndicator(key)` everywhere ✓
- `Alpine.store('dw').setFilteredKpis({ cost, revenue, profit, inv, listed })` → matches the shape read in tape HTML ✓
- `Alpine.store('dw').notify(msg, type)` → used in store save methods and `alert()` replacements ✓
- `exportCsv()` → defined in `itemsView`, called via `@click="exportCsv()"` in hero-band ✓
