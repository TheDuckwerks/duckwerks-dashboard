# Cross-Cutting Design Foundations — Spec
> Implements GitHub issue #107. Prerequisite for per-view tickets #102–#106.

**Date:** 2026-04-20
**Status:** Approved

---

## Scope

System-wide primitives and conventions that appear across multiple views. Implemented once here; per-view tickets consume them. Covers:

1. Empty-state convention
2. Sortable column header component
3. Row-click affordance
4. Slim hero-band (non-dashboard views)
5. Filter chip labeling
6. Filter-aware KPI tape
7. Auto-hide uniform columns
8. Toast notification component
9. Page shell consistency (Catalog)
10. Inventory export button

**Deferred / Won't Do:**
- Row selection + bulk actions → replaced by export button
- Search upgrade → separate ticket
- Analytics row selection → deferred pending view split

---

## 1. Empty-State Convention

**Rule:**
- `—` (em dash, `&mdash;`) for "not applicable yet": no cost entered, no sale price, field has no value
- `n/a` for "truly unknown / not tracked": field conceptually doesn't exist for this item (rare)
- Zero values (`$0`, `0%`, `0`) displayed in `--ink-4` gray — never red, never styled as a loss

**Implementation:**
Add a `fmtMoney(val)` helper to `Alpine.store('dw')` in `store.js`:
- `null` / `undefined` → returns `'—'`
- `0` → returns `'$0'` (string only; template applies `--ink-4` color via `:class="{ muted: val === 0 }"`)
- Positive/negative numbers → formatted normally with sign handling per existing patterns

Add a companion `isZero(val)` boolean helper for binding the muted class. Replace inline Alpine money-formatting expressions in `index.html` with `$store.dw.fmtMoney(val)` + `:class="{ muted: $store.dw.isZero(val) }"` wherever a dash or zero is possible. Applies to: inventory table, lots table, analytics table, dashboard tables.

---

## 2. Sortable Column Header Component

**Behavior:**
- Any table can opt in via `x-data="sortable({ view: 'items', default: { col: 'name', dir: 'asc' } })"`
- State shape: `{ col: String, dir: 'asc'|'desc' }`
- Persisted to localStorage under key `dw_sort_<viewName>` (e.g. `dw_sort_items`, `dw_sort_lots`)
- Exposes `sortedRows(rows)` method — takes the raw row array, returns sorted copy
- `sort(colKey)`: if already sorting by this col, flip dir; otherwise set col + default to `asc`

**Header markup pattern:**
```html
<th @click="sort('name')" style="cursor:pointer">
  Name <span x-text="sortGlyph('name')"></span>
</th>
```
`sortGlyph(col)` returns `↑` (asc active), `↓` (desc active), or muted `↕` (inactive).

**Applied to:** Inventory (`items`), Lots (`lots`), Analytics (`analytics`), Comps (`comps`).

**File:** New file `public/v2/js/sortable.js`, registered via `Alpine.data('sortable', ...)` and loaded in `index.html` alongside other view scripts.

---

## 3. Row-Click Affordance

Pure CSS. No JS changes.

Add to `components.css`:
```css
table.tb tbody tr,
table.tbl tbody tr {
  cursor: pointer;
}
table.tb tbody tr:hover,
table.tbl tbody tr:hover {
  background: #111;  /* already exists on .tb, confirm on .tbl */
}
```

A `→` chevron in the last `<td>` of clickable rows appears on hover via a CSS `::after` pseudo-element on `tr:hover td:last-child`. Only applied to tables where rows open a modal (inventory, lots) — not to read-only tables (dashboard recently sold, recently listed).

---

## 4. Slim Hero-Band (Non-Dashboard Views)

**Full hero-band** (dashboard only): existing `.hero-band` — 100px, photo left column, stacked layout.

**Slim hero-band** (all other views): `.hero-band.slim`
- Height: `44px`
- Layout: `flex-row`
- Photo: `80px` wide thumbnail strip, `background-size: cover`, `border-right: 1px solid var(--line)`
- Breadcrumb + title: single line, inline, `--ink-3` / bold `--ink`
- CTAs: right-aligned, same `.tool-btn` pattern

Add `.hero-band.slim` CSS to `components.css`. Update `index.html` — replace `class="hero-band"` with `class="hero-band slim"` on all non-dashboard views (items, lots, analytics, comps, catalog).

---

## 5. Filter Chip Labeling

Add a short label before each filter group in `index.html` filter rows:

```html
<span class="filter-group-label">Status:</span>
<!-- existing filter chips -->
<span class="filter-group-label">Sites:</span>
<!-- existing site chips -->
```

CSS for `.filter-group-label`:
```css
.filter-group-label {
  font: 500 10px/1 var(--mono);
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--ink-4);
  align-self: center;
  padding-right: 4px;
}
```

Applied to: Inventory, Analytics (wherever multiple filter groups appear unlabeled).

---

## 6. Filter-Aware KPI Tape

**Behavior:**
- Tape strip always shows global totals (current behavior)
- When a filter is active in the current view, append a secondary filtered value inline: `$8,366 · $1,301 filtered`
- The `·` separator and `filtered` label use `--ink-4`; the filtered value uses the same color as the global value
- Only shown when a filter is active — no secondary value when viewing all items
- Only the tape items relevant to the current view get the secondary label (cost, recov, profit, inv, listed)

**Implementation:**
The tape renders from `Alpine.store('dw')`, but filtered rows live inside each view component. Views push their filtered aggregates into the store whenever filters change.

Add to `Alpine.store('dw')` in `store.js`:
```js
filteredKpis: null,   // null = no filter active
setFilteredKpis(kpis) { this.filteredKpis = kpis; },  // called by view on filter change
clearFilteredKpis()  { this.filteredKpis = null; },    // called by view when filters cleared
```

Each view with filters (items, analytics) calls `$store.dw.setFilteredKpis({ cost, revenue, profit, inv, listed })` in its filter watcher, and `$store.dw.clearFilteredKpis()` when all filters are cleared. Views without filters never touch this.

Update tape HTML in `index.html` to conditionally render the secondary value:
```html
<div class="tape-item">cost
  <b class="dn" x-text="...global..."></b>
  <template x-if="$store.dw.filteredKpis">
    <span class="tape-filtered"> · <b x-text="'$' + $store.dw.filteredKpis.cost.toLocaleString()"></b> <span>flt</span></span>
  </template>
</div>
```

---

## 7. Auto-Hide Uniform Columns

**Utility:** Add `allSame(rows, field)` to `Alpine.store('dw')` — returns `true` if every row has an identical value for `field` (or field is absent on all rows).

**Usage in view components:** Each view that opts in computes a boolean:
```js
get showSiteCol() { return !Alpine.store('dw').allSame(this.visibleRows, 'site_id'); }
```

**Applied to:**
- Lots view: `site_id` column (hidden when all lots are from one platform), `status` column (hidden when all lots are SOLD)
- Comps view: `type` column (hidden when all results are BIN)

Columns use `x-show="showSiteCol"` on both `<th>` and `<td>`. The `allSame` utility lives in `store.js`.

---

## 8. Toast Notification Component

**Markup:** Single `<div id="toast" x-data x-show="$store.dw.toastMsg" ...>` appended before `</body>` in `index.html`. CSS: fixed bottom-right, `z-index: 500`, slide-up entry transition.

**Store API:**
```js
// In Alpine.store('dw'):
toastMsg: null,
toastType: 'success',   // 'success' | 'error'
_toastTimer: null,

notify(msg, type = 'success') {
  clearTimeout(this._toastTimer);
  this.toastMsg = msg;
  this.toastType = type;
  if (type === 'success') {
    this._toastTimer = setTimeout(() => this.toastMsg = null, 3000);
  }
},
dismissToast() { this.toastMsg = null; }
```

**Error toasts:** no auto-dismiss, click anywhere on toast to dismiss.

**Usage across app:** Replace any existing `alert()` calls or inline save feedback with `$store.dw.notify('Saved', 'success')` / `$store.dw.notify('Error: ' + e.message, 'error')`.

**CSS:** `.toast` positioned `bottom: 24px; right: 24px`, `padding: 10px 16px`, `background: var(--panel-2)`, `border: 1px solid var(--line-2)`, success gets a `var(--pos)` left border accent, error gets `var(--neg)`.

---

## 9. Page Shell Consistency — Catalog

Catalog currently has no hero-band. Add the slim hero-band:

```html
<div class="hero-band slim">
  <div class="hero-photo"></div>
  <div class="hero-head">
    <div class="hero-crumbs">DW<span class="sep">/</span><b>catalog</b></div>
    <div class="hero-title">Catalog</div>
    <div class="hero-tools">
      <!-- existing catalog Add button moves here -->
    </div>
  </div>
</div>
```

Move any existing catalog primary CTA into `.hero-tools`.

---

## 10. Inventory Export Button

A `⬇ Export` button in the Inventory hero-band `.hero-tools`. Exports whatever rows are currently visible (post-filter) as a CSV download. Fields: SKU, Name, Category, Status, Site, Cost, List Price, Sale Price, Profit, Date Added.

**Implementation:** Click handler calls `exportCsv(rows)` defined in `public/v2/js/views/items.js` (view-specific, not shared). Uses `Blob` + `URL.createObjectURL` to trigger a browser download — no server round-trip.

---

## File Map

| File | Changes |
|---|---|
| `public/v2/css/components.css` | Slim hero-band, filter-group-label, row-click affordance, toast styles |
| `public/v2/js/store.js` | `fmtMoney()`, `allSame()`, `filteredKpis` getter, `notify()` / toast state |
| `public/v2/js/sortable.js` | New file — `Alpine.data('sortable', ...)` component |
| `public/v2/js/views/items.js` | Wire sortable, export CSV, `showSiteCol` (if applicable) |
| `public/v2/js/views/lots.js` | Wire sortable, `showSiteCol`, `showStatusCol` |
| `public/v2/js/views/analytics.js` | Wire sortable |
| `public/v2/js/views/comps.js` | Wire sortable, `showTypeCol` |
| `public/v2/index.html` | Slim hero-band on all non-dashboard views, filter chip labels, tape filter secondaries, toast markup, catalog hero-band |
