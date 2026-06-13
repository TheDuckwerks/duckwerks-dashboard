# Catalog Inventory Analytics Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sortable columns (Manufacturer, Mold, Views, Impressions, CTR) to the catalog page's DG inventory list, with traffic data fetched from a shared Alpine store cache so the analytics page can reuse it.

**Architecture:** `server/inventory.js` gains a join that returns `ebay_listing_id` per row. `Alpine.store('dw')` gets a `trafficMap` cache (`{ [listingId]: { views, impressions, ctr } }`). The catalog view fetches traffic on load (using the cached map if already populated by the analytics view), and displays all columns in a sortable row. The analytics view writes its traffic fetch result into `trafficMap` so both pages share the same data. Sort state lives in `catalogView` (key + dir), applied via a computed getter over `inventory`.

**Tech Stack:** Alpine.js (existing), Express/better-sqlite3 (existing), eBay Sell Analytics API (`/api/ebay/traffic` — existing route)

---

## File Map

| File | Change |
|---|---|
| `server/inventory.js` | Add LEFT JOIN to `items`/`listings` to return `ebay_listing_id` on each row |
| `public/v2/js/store.js` | Add `trafficMap: {}` and `trafficLoading: false` to store state |
| `public/v2/js/views/analytics.js` | Write traffic fetch result into `$store.dw.trafficMap` instead of local `ebayMap` |
| `public/v2/js/views/catalog.js` | Add sort state, `sortedInventory` getter, `loadTraffic()` method |
| `public/v2/partials/views/catalog.html` | Add sort bar + Manufacturer, Mold, Views, Impressions, CTR columns to each row |

---

## Task 1: Add `ebay_listing_id` to inventory API response

**Files:**
- Modify: `server/inventory.js`

The `inventory` table has no listing ID — it links to `items` via `items.sku = inventory.sku`, and `items` links to `listings` via `listings.item_id = items.id`. We need a LEFT JOIN so rows without a listing return `null`.

- [ ] **Step 1: Replace the two prepared statements that list rows**

In `server/inventory.js`, replace the `listAll` prepared statement (line 7) and the `GET /` handler body with versions that join listings. The `getBySku` statement used by GET `/:sku` and PATCH doesn't need to change — only list endpoints need the listing ID.

Replace:
```js
const listAll  = db.prepare('SELECT * FROM inventory ORDER BY created_at DESC');
```
With:
```js
const listAll  = db.prepare(`
  SELECT inv.*,
         l.platform_listing_id AS ebay_listing_id
  FROM   inventory inv
  LEFT JOIN items it   ON it.sku = inv.sku
  LEFT JOIN listings l ON l.item_id = it.id AND l.status = 'active'
  ORDER BY inv.created_at DESC
`);
```

- [ ] **Step 2: Expose `ebay_listing_id` through `parseRow`**

`parseRow` currently does `{ ...r, metadata: JSON.parse(...) }`. The join adds `ebay_listing_id` to `r` automatically — no change needed to `parseRow`. Verify by checking: the spread `...r` will include `ebay_listing_id` as a top-level string (or null).

- [ ] **Step 3: Smoke-test on the NUC**

```bash
ssh geoff@fedora.local "curl -s 'http://localhost:3000/api/inventory?excludeStatus=sold' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const r=d.inventory[0]; console.log(r.sku, r.ebay_listing_id);\""
```
Expected: something like `DWG-001 168287964990`

- [ ] **Step 4: Commit**

```bash
git add server/inventory.js
git commit -m "feat: return ebay_listing_id from GET /api/inventory via items join

ref #catalog-analytics"
```

---

## Task 2: Add `trafficMap` to Alpine store

**Files:**
- Modify: `public/v2/js/store.js`

`trafficMap` is a session-scoped cache: `{ [legacyListingId]: { views, impressions, ctr } }`. Once populated by either the analytics or catalog view, both can read from it without re-fetching.

- [ ] **Step 1: Add two fields to the store state block**

In `public/v2/js/store.js`, find the `// ── State` block (around line 8). Add after the existing `shippingProvider` line:

```js
trafficMap:       {},   // { [legacyListingId]: { views, impressions, ctr } } — session cache
trafficLoading:   false,
```

- [ ] **Step 2: Verify the store loads without errors**

Start the app locally (`npm start`) and open the browser console. Check that `Alpine.store('dw').trafficMap` returns `{}` with no errors. (Or just deploy and refresh — no automated test suite.)

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/store.js
git commit -m "feat: add trafficMap session cache to Alpine store

ref #catalog-analytics"
```

---

## Task 3: Analytics view writes to shared `trafficMap`

**Files:**
- Modify: `public/v2/js/views/analytics.js`

Currently analytics stores traffic in a local `const ebayMap = ebayTraffic.listings || {}`. We need it to also write into `Alpine.store('dw').trafficMap` so the catalog view can read it without a second API round-trip.

- [ ] **Step 1: After building `ebayMap`, write it into the store**

In `public/v2/js/views/analytics.js`, find the line (around line 155):
```js
const ebayMap = ebayTraffic.listings || {};
```

Add immediately after it:
```js
// Populate shared cache so catalog view can read without re-fetching
Object.assign(Alpine.store('dw').trafficMap, ebayMap);
```

That's the entire change. `ebayMap` is still used locally in analytics as before; we're just also writing it to the store.

- [ ] **Step 2: Commit**

```bash
git add public/v2/js/views/analytics.js
git commit -m "feat: write eBay traffic fetch result into shared store trafficMap

ref #catalog-analytics"
```

---

## Task 4: Add sort state and `loadTraffic()` to catalog view JS

**Files:**
- Modify: `public/v2/js/views/catalog.js`

This is the largest JS change. We add:
1. Sort state fields (`invSortKey`, `invSortDir`)
2. `sortedInventory` getter — returns `inventory` sorted by the active key
3. `loadTraffic()` — checks store cache first, fetches if empty, writes result into store

- [ ] **Step 1: Add sort state fields to the data object**

In `public/v2/js/views/catalog.js`, find the inventory state block (around line 33–48). Add after `ebayBatchProgress`:

```js
invSortKey: 'sku',
invSortDir: 'asc',
```

- [ ] **Step 2: Add `sortedInventory` getter**

After the `get mfgFiltered()` getter (around line 57), add:

```js
get sortedInventory() {
  const dir = this.invSortDir === 'asc' ? 1 : -1;
  return [...this.inventory].sort((a, b) => {
    let av, bv;
    const k = this.invSortKey;
    if (k === 'sku') {
      // numeric sort by disc number
      const an = parseInt((a.sku || '').replace(/^DWG-0*/i, ''), 10);
      const bn = parseInt((b.sku || '').replace(/^DWG-0*/i, ''), 10);
      return dir * (an - bn);
    }
    if (k === 'location')     { av = a.location || ''; bv = b.location || ''; }
    if (k === 'manufacturer') { av = a.metadata?.manufacturer || ''; bv = b.metadata?.manufacturer || ''; }
    if (k === 'mold')         { av = a.metadata?.mold || '';         bv = b.metadata?.mold || ''; }
    if (k === 'title')        { av = this.inventoryDisplayTitle(a);  bv = this.inventoryDisplayTitle(b); }
    if (k === 'price')        { return dir * ((a.metadata?.listPrice || 0) - (b.metadata?.listPrice || 0)); }
    if (k === 'views')        { return dir * ((_traffic(a, this) ?.views ?? -1) - (_traffic(b, this)?.views ?? -1)); }
    if (k === 'impressions')  { return dir * ((_traffic(a, this)?.impressions ?? -1) - (_traffic(b, this)?.impressions ?? -1)); }
    if (k === 'ctr')          { return dir * ((_traffic(a, this)?.ctr ?? -1) - (_traffic(b, this)?.ctr ?? -1)); }
    if (av === undefined) return 0;
    return dir * av.localeCompare(bv);
  });
},
```

Also add this helper function **outside** the Alpine.data object, at the top of the file after the opening comment line:

```js
function _traffic(row, ctx) {
  const lid = row.ebay_listing_id;
  return lid ? (Alpine.store('dw').trafficMap[lid] || null) : null;
}
```

- [ ] **Step 3: Add `invSortBy()` method**

After `cancelEdit()` (around line 248), add:

```js
invSortBy(key) {
  if (this.invSortKey === key) {
    this.invSortDir = this.invSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    this.invSortKey = key;
    this.invSortDir = key === 'sku' ? 'asc' : 'desc'; // default desc for metrics
  }
},

invSortGlyph(key) {
  if (this.invSortKey !== key) return '';
  return this.invSortDir === 'asc' ? ' ↑' : ' ↓';
},
```

- [ ] **Step 4: Add `loadTraffic()` method**

After `loadInventory()` (around line 240), add:

```js
async loadTraffic() {
  const dw = Alpine.store('dw');
  if (Object.keys(dw.trafficMap).length > 0) return; // already cached
  const ids = this.inventory
    .map(r => r.ebay_listing_id)
    .filter(Boolean);
  if (!ids.length) return;
  dw.trafficLoading = true;
  try {
    const data = await fetch('/api/ebay/traffic', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ listingIds: ids }),
    }).then(r => r.json());
    Object.assign(dw.trafficMap, data.listings || {});
  } catch (e) {
    console.warn('[catalog] traffic fetch failed:', e.message);
  }
  dw.trafficLoading = false;
},
```

- [ ] **Step 5: Call `loadTraffic()` after inventory loads**

In `loadInventory()`, after `this.inventory = data.inventory || [];` (around line 235), add:

```js
this.loadTraffic();
```

- [ ] **Step 6: Commit**

```bash
git add public/v2/js/views/catalog.js
git commit -m "feat: add sort state, sortedInventory getter, and loadTraffic() to catalog view

ref #catalog-analytics"
```

---

## Task 5: Update catalog HTML — sort bar and new columns

**Files:**
- Modify: `public/v2/partials/views/catalog.html`

Replace the `x-for="row in inventory"` loop and add a sort bar above it. Also add the new columns inline in each row.

- [ ] **Step 1: Add sort bar above the inventory list**

In `catalog.html`, find (around line 196):
```html
<template x-if="!inventoryLoading && inventory.length > 0">
  <div>
    <template x-for="row in inventory" :key="row.sku">
```

Replace with:
```html
<template x-if="!inventoryLoading && inventory.length > 0">
  <div>
    <!-- Sort bar -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <template x-for="col in [
        {key:'sku',label:'SKU'},
        {key:'location',label:'LOC'},
        {key:'manufacturer',label:'MFG'},
        {key:'mold',label:'MOLD'},
        {key:'title',label:'TITLE'},
        {key:'price',label:'PRICE'},
        {key:'views',label:'VIEWS'},
        {key:'impressions',label:'IMP'},
        {key:'ctr',label:'CTR'}
      ]" :key="col.key">
        <button @click="invSortBy(col.key)"
          :style="invSortKey === col.key ? 'border-color:var(--blue);color:var(--blue)' : ''"
          style="font:700 9px/1 var(--mono);letter-spacing:.08em;padding:3px 8px;background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);cursor:pointer"
          x-text="col.label + invSortGlyph(col.key)"></button>
      </template>
      <span x-show="$store.dw.trafficLoading"
            style="font:700 9px/1 var(--mono);letter-spacing:.08em;color:var(--muted);padding:3px 0">
        LOADING TRAFFIC...
      </span>
    </div>

    <template x-for="row in sortedInventory" :key="row.sku">
```

Note: change `x-for="row in inventory"` to `x-for="row in sortedInventory"` — that's the only change to the loop itself.

- [ ] **Step 2: Add Manufacturer and Mold columns to each summary row**

In the summary row div (around line 204), find:
```html
<span style="font-size:11px;color:var(--muted);flex-shrink:0" x-text="row.category || '—'"></span>
<span style="font-size:11px;color:var(--muted);flex-shrink:0" x-text="row.location || '—'"></span>
```

Replace with:
```html
<span style="font-size:11px;color:var(--muted);flex-shrink:0" x-text="row.location || '—'"></span>
<span style="font-size:11px;color:var(--muted);flex-shrink:0" x-text="row.metadata?.manufacturer || '—'"></span>
<span style="font-size:11px;color:var(--muted);flex-shrink:0" x-text="row.metadata?.mold || '—'"></span>
```

(Category is dropped — this view is DG-only, it's noise.)

- [ ] **Step 3: Add Views, Impressions, CTR columns to each summary row**

After the title span (around line 237):
```html
<span style="font-size:11px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" x-text="inventoryDisplayTitle(row)"></span>
```

Add immediately after it:
```html
<template x-if="row.ebay_listing_id">
  <span style="display:flex;gap:10px;flex-shrink:0">
    <span style="font-size:11px;color:var(--muted)" :title="'Views: ' + ($store.dw.trafficMap[row.ebay_listing_id]?.views ?? '...')">
      <span style="font:700 9px/1 var(--mono);letter-spacing:.06em;color:var(--ink-3)">V </span><span x-text="$store.dw.trafficLoading && !$store.dw.trafficMap[row.ebay_listing_id] ? '…' : ($store.dw.trafficMap[row.ebay_listing_id]?.views ?? '—')"></span>
    </span>
    <span style="font-size:11px;color:var(--muted)">
      <span style="font:700 9px/1 var(--mono);letter-spacing:.06em;color:var(--ink-3)">IMP </span><span x-text="$store.dw.trafficLoading && !$store.dw.trafficMap[row.ebay_listing_id] ? '…' : ($store.dw.trafficMap[row.ebay_listing_id]?.impressions ?? '—')"></span>
    </span>
    <span style="font-size:11px;color:var(--muted)">
      <span style="font:700 9px/1 var(--mono);letter-spacing:.06em;color:var(--ink-3)">CTR </span><span x-text="$store.dw.trafficLoading && !$store.dw.trafficMap[row.ebay_listing_id] ? '…' : ($store.dw.trafficMap[row.ebay_listing_id] ? Math.round($store.dw.trafficMap[row.ebay_listing_id].ctr * 100) + '%' : '—')"></span>
    </span>
  </span>
</template>
<template x-if="!row.ebay_listing_id">
  <span style="font-size:11px;color:var(--ink-3);flex-shrink:0">not listed</span>
</template>
```

- [ ] **Step 4: Deploy and verify**

```bash
git add public/v2/partials/views/catalog.html
git commit -m "feat: add sort bar and analytics columns to catalog inventory list

ref #catalog-analytics"
git push origin main && bash scripts/deploy-nuc.sh
```

Open `dash.duckwerks.com`, go to the Catalog page, scroll to the Inventory section. Verify:
- Sort bar appears with SKU / LOC / MFG / MOLD / TITLE / PRICE / VIEWS / IMP / CTR buttons
- "LOADING TRAFFIC..." appears briefly then disappears
- Each row shows manufacturer, mold, and traffic metrics
- Clicking sort buttons reorders the list; clicking again toggles asc/desc
- Active sort button is highlighted blue
- Price edit + QUEUE + UPDATE EBAY flows are unchanged
- Rows without a listing ID show "not listed" instead of traffic cols

---

## Self-Review

**Spec coverage:**
- SKU, Location, Title, Price columns: already present — sort added ✓
- Manufacturer, Mold columns: added in Task 5 step 2 ✓
- Views, Impressions, CTR columns: added in Task 5 step 3 ✓
- All columns sortable: `invSortBy()` + `sortedInventory` in Task 4 ✓
- Shared `trafficMap` cache: Tasks 2 + 3 + 4 ✓
- Spinner while loading: `trafficLoading` flag + "LOADING TRAFFIC..." in sort bar ✓
- Rows without listing ID show `—` / "not listed": Task 5 step 3 ✓
- Price edit + eBay queue untouched: loop changed to `sortedInventory` only, all button handlers unchanged ✓
- Analytics view also writes to shared cache: Task 3 ✓

**Placeholder scan:** No TBDs or vague steps found.

**Type consistency:**
- `_traffic(row, ctx)` defined in Task 4 step 2, used in `sortedInventory` getter in same step ✓
- `invSortBy(key)` defined in Task 4 step 3, called in HTML in Task 5 step 1 ✓
- `invSortGlyph(key)` defined in Task 4 step 3, called in HTML in Task 5 step 1 ✓
- `sortedInventory` getter defined in Task 4 step 2, used in HTML in Task 5 step 1 ✓
- `ebay_listing_id` returned by API in Task 1, read in `loadTraffic()` (Task 4 step 4) and HTML (Task 5 step 3) ✓
- `trafficMap` added to store in Task 2, written by analytics in Task 3, written by catalog in Task 4, read in HTML in Task 5 ✓
- `trafficLoading` added to store in Task 2, set in Task 4 `loadTraffic()`, read in HTML Task 5 ✓
