# Inventory Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the inventory table into a mode-aware workbench with dedicated Listed and Sold column sets, date range filter, multi-select site filter, expanded search, and a Forecast stat in the global tape strip.

**Architecture:** Five tasks in dependency order — (1) store gets a `pipeline` getter, (2) `items.js` gets updated state and filter logic, (3) controls row HTML updated (pills, date range, search), (4) Listed table HTML replaced, (5) Sold table HTML replaced. No backend changes. No new files.

**Tech Stack:** Alpine.js, vanilla JS, vanilla CSS (no build step). `public/v2/` frontend only.

**Spec:** `docs/superpowers/specs/2026-04-20-inventory-workbench-design.md`

---

## File Map

| File | What changes |
|---|---|
| `public/v2/js/store.js` | Add `get pipeline()` computed getter after `filteredKpis` block |
| `public/v2/js/views/dashboard.js` | Update `pipeline` getter and `forecastedProfit` to use `$store.dw.pipeline` |
| `public/v2/index.html` | Tape: add forecast item; Controls: site multi-select + date range + search placeholder; Table: split into Listed/Sold/All conditional blocks |
| `public/v2/js/views/items.js` | `siteFilters[]` array, `dateRange` state, expanded search, updated `rows` getter, `_saveFilters`, init loading |

---

## Task 1: Add `pipeline` getter to store + update dashboard

**Files:**
- Modify: `public/v2/js/store.js`
- Modify: `public/v2/js/views/dashboard.js`
- Modify: `public/v2/index.html` (tape strip only)

The `pipeline` getter currently lives in `dashView` (dashboard.js line 65). Move it to the store so the tape and any future view can reference it without a view component.

- [ ] **Step 1: Add `pipeline` getter to `store.js`**

In `public/v2/js/store.js`, find the `filteredKpis` block (around line 257):

```js
filteredKpis: null,
setFilteredKpis(kpis) { this.filteredKpis = kpis; },
clearFilteredKpis()   { this.filteredKpis = null; },
```

Add the `pipeline` getter immediately before `filteredKpis`:

```js
get pipeline() {
  return this.records
    .filter(r => r.status === 'Listed')
    .reduce((s, r) => s + this.estProfit(r), 0);
},

filteredKpis: null,
setFilteredKpis(kpis) { this.filteredKpis = kpis; },
clearFilteredKpis()   { this.filteredKpis = null; },
```

- [ ] **Step 2: Update `dashboard.js` to reference store pipeline**

In `public/v2/js/views/dashboard.js`, replace the existing `pipeline` and `forecastedProfit` getters:

```js
// BEFORE:
get pipeline() {
  const dw = Alpine.store('dw');
  return dw.records.filter(r => r.status === 'Listed').reduce((s, r) => s + dw.estProfit(r), 0);
},
get forecastedProfit() {
  return this.profit + this.pipeline;
},

// AFTER:
get pipeline() {
  return Alpine.store('dw').pipeline;
},
get forecastedProfit() {
  return this.profit + this.pipeline;
},
```

- [ ] **Step 3: Add forecast tape item in `index.html`**

In `public/v2/index.html`, find the "sold" tape item (around line 54):

```html
    <div class="tape-item">sold
      <b x-text="Alpine.store('dw').soldRecords.length"></b>
    </div>
```

Add a forecast item immediately after it:

```html
    <div class="tape-item">sold
      <b x-text="Alpine.store('dw').soldRecords.length"></b>
    </div>
    <div class="tape-item">forecast
      <b class="up" x-text="(()=>{const p=Alpine.store('dw').pipeline;return(p>=0?'+':'')+' $'+Math.round(Math.abs(p)).toLocaleString('en-US',{maximumFractionDigits:0})})()"></b>
    </div>
```

- [ ] **Step 4: Verify in browser**

Start the server (`npm start`) and open http://localhost:3000. The tape strip should now show a "forecast" item after "sold" with a `+$X,XXX` value. The dashboard Forecast KPI cell should still work. Check browser console for errors.

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/store.js public/v2/js/views/dashboard.js public/v2/index.html
git commit -m "feat: add pipeline getter to store, forecast stat to tape ref #102"
```

---

## Task 2: Update `items.js` — state, filter logic, search expansion

**Files:**
- Modify: `public/v2/js/views/items.js`

This is the logic layer. No HTML changes yet — those come in Tasks 3–5.

- [ ] **Step 1: Replace `siteFilter` with `siteFilters` array and add `dateRange`**

In `public/v2/js/views/items.js`, replace the top-of-component state block:

```js
// BEFORE:
statusFilter: 'Listed',
siteFilter:   'All',
nameSearch:   '',
openStatusId: null,
sortKey:      'createdTime',
sortDir:      'desc',
trackingData:    {},
trackingLoading: false,

// AFTER:
statusFilter: 'Listed',
siteFilters:  [],          // empty = All sites
dateRange:    'all',       // 'all' | '24h' | '7d' | '30d'
nameSearch:   '',
openStatusId: null,
sortKey:      'createdTime',
sortDir:      'desc',
trackingData:    {},
trackingLoading: false,
```

- [ ] **Step 2: Update `init()` to load saved filters and set up watchers**

In `init()`, replace the localStorage filter loading and the `$watch` calls for filters:

```js
// BEFORE (find these two blocks):
try {
  const f = JSON.parse(localStorage.getItem('dw_filter_items') || '{}');
  if (f.status) this.statusFilter = f.status;
  if (f.site)   this.siteFilter   = f.site;
} catch {}
this.$watch('statusFilter',              () => { this._saveFilters(); this._pushFilteredKpis(); });
this.$watch('siteFilter',                () => { this._saveFilters(); this._pushFilteredKpis(); });
this.$watch('$store.dw.categoryFilter',  () => this._pushFilteredKpis());
this.$watch('$store.dw.activeView',      v  => { if (v !== 'items') Alpine.store('dw').clearFilteredKpis(); });

// AFTER:
try {
  const f = JSON.parse(localStorage.getItem('dw_filter_items') || '{}');
  if (f.status)     this.statusFilter = f.status;
  if (f.siteFilters && Array.isArray(f.siteFilters)) this.siteFilters = f.siteFilters;
  if (f.dateRange)  this.dateRange    = f.dateRange;
} catch {}
this.$watch('statusFilter',              () => { this._saveFilters(); this._pushFilteredKpis(); });
this.$watch('siteFilters',               () => { this._saveFilters(); this._pushFilteredKpis(); });
this.$watch('dateRange',                 () => { this._saveFilters(); this._pushFilteredKpis(); });
this.$watch('$store.dw.categoryFilter',  () => this._pushFilteredKpis());
this.$watch('$store.dw.activeView',      v  => { if (v !== 'items') Alpine.store('dw').clearFilteredKpis(); });
```

- [ ] **Step 3: Replace the `rows` getter with updated filter logic**

Replace the entire `get rows()` method:

```js
get rows() {
  const dw = Alpine.store('dw');
  let recs = dw.records;

  // Category filter
  if (dw.categoryFilter) {
    recs = recs.filter(r => r.category?.name === dw.categoryFilter);
  }

  // Status filter
  if (this.statusFilter !== 'All') {
    recs = recs.filter(r => r.status === this.statusFilter);
  }

  // Site filter (multi-select: empty array = All)
  if (this.siteFilters.length > 0) {
    const sites = dw.sites || [];
    recs = recs.filter(r =>
      this.siteFilters.some(siteName => {
        const target = sites.find(s => s.name === siteName);
        return target && (r.listings || []).some(l => l.site?.id === target.id);
      })
    );
  }

  // Date range filter (Listed → created_at, Sold → date_sold, others → created_at)
  if (this.dateRange !== 'all') {
    const hours = { '24h': 24, '7d': 168, '30d': 720 }[this.dateRange];
    const cutoff = new Date(Date.now() - hours * 3600 * 1000);
    if (this.statusFilter === 'Sold') {
      recs = recs.filter(r => r.order?.date_sold && new Date(r.order.date_sold) >= cutoff);
    } else {
      recs = recs.filter(r => r.created_at && new Date(r.created_at) >= cutoff);
    }
  }

  // Search (name, sku, lot name, notes)
  const q = this.nameSearch.trim().toLowerCase();
  if (q) {
    recs = recs.filter(r =>
      (r.name        || '').toLowerCase().includes(q) ||
      (r.sku         || '').toLowerCase().includes(q) ||
      (r.lot?.name   || '').toLowerCase().includes(q) ||
      (r.notes       || '').toLowerCase().includes(q)
    );
  }

  // Sort
  const key = this.sortKey, dir = this.sortDir;
  recs = [...recs].sort((a, b) => {
    let av, bv;
    if      (key === 'createdTime') { av = new Date(a.created_at).getTime(); bv = new Date(b.created_at).getTime(); }
    else if (key === 'name')       { av = a.name.toLowerCase();             bv = b.name.toLowerCase(); }
    else if (key === 'lot')        { av = (a.lot?.name||'').toLowerCase();  bv = (b.lot?.name||'').toLowerCase(); }
    else if (key === 'category')   { av = (a.category?.name||'').toLowerCase(); bv = (b.category?.name||'').toLowerCase(); }
    else if (key === 'site')       { av = dw.siteLabel(a).toLowerCase();   bv = dw.siteLabel(b).toLowerCase(); }
    else if (key === 'status')     { av = a.status.toLowerCase();          bv = b.status.toLowerCase(); }
    else if (key === 'listPrice')  { av = dw.activeListing(a)?.list_price || 0; bv = dw.activeListing(b)?.list_price || 0; }
    else if (key === 'eaf')        { av = dw.payout(a);  bv = dw.payout(b); }
    else if (key === 'profit')     { av = dw.estProfit(a); bv = dw.estProfit(b); }
    else if (key === 'shipping')   { av = dw.activeListing(a)?.shipping_estimate || 0; bv = dw.activeListing(b)?.shipping_estimate || 0; }
    else if (key === 'soldDate')   { av = a.order?.date_sold || ''; bv = b.order?.date_sold || ''; }
    else return 0;
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ?  1 : -1;
    return 0;
  });
  return recs;
},
```

- [ ] **Step 4: Update `_saveFilters()`**

Replace the `_saveFilters` method:

```js
// BEFORE:
_saveFilters() {
  try { localStorage.setItem('dw_filter_items', JSON.stringify({ status: this.statusFilter, site: this.siteFilter })); } catch {}
},

// AFTER:
_saveFilters() {
  try {
    localStorage.setItem('dw_filter_items', JSON.stringify({
      status:     this.statusFilter,
      siteFilters: this.siteFilters,
      dateRange:   this.dateRange,
    }));
  } catch {}
},
```

- [ ] **Step 5: Update `_pushFilteredKpis()` to use `siteFilters`**

Replace the `noFilter` check in `_pushFilteredKpis`:

```js
// BEFORE:
const noFilter = this.statusFilter === 'All' && this.siteFilter === 'All' && !dw.categoryFilter;

// AFTER:
const noFilter = this.statusFilter === 'All' && this.siteFilters.length === 0 && this.dateRange === 'all' && !dw.categoryFilter;
```

- [ ] **Step 6: Add site toggle helpers**

Add these two methods anywhere in the component (e.g. after `sortGlyph`):

```js
toggleSite(name) {
  const idx = this.siteFilters.indexOf(name);
  if (idx === -1) this.siteFilters = [...this.siteFilters, name];
  else            this.siteFilters = this.siteFilters.filter(s => s !== name);
},
clearSites() {
  this.siteFilters = [];
},
```

- [ ] **Step 7: Verify no console errors**

Reload http://localhost:3000, go to Inventory view. Open browser console — no errors. The table should still filter by status and the existing sort should work. Searching should now also match lot names and SKUs (test with a lot name you know exists).

- [ ] **Step 8: Commit**

```bash
git add public/v2/js/views/items.js
git commit -m "feat: multi-select sites, date range filter, expanded search in items view ref #102 #110"
```

---

## Task 3: Update controls row HTML

**Files:**
- Modify: `public/v2/index.html` (controls-row section only, lines ~406–423)

- [ ] **Step 1: Replace the controls row**

Find the entire `<!-- Controls -->` block in the items view (starts around line 406):

```html
<!-- Controls -->
<div class="controls-row">
  <span class="filter-group-label">Status:</span>
  <div class="pill-row">
    <template x-for="s in ['All','Listed','Sold','Prepping']" :key="s">
      <button class="pill" :class="{ active: statusFilter === s }" @click="statusFilter = s; $store.dw.categoryFilter = null" x-text="s"></button>
    </template>
  </div>
  <span class="filter-group-label">Sites:</span>
  <div class="pill-row">
    <button class="pill" :class="{ active: siteFilter === 'All' }" @click="siteFilter = 'All'; $store.dw.categoryFilter = null">All</button>
    <template x-for="s in $store.dw.sites" :key="s.id">
      <button class="pill" :class="{ active: siteFilter === s.name }" @click="siteFilter = s.name; $store.dw.categoryFilter = null" x-text="s.name"></button>
    </template>
  </div>
  <input class="controls-search" type="text" placeholder="search name..." x-model="nameSearch">
  <button class="btn btn-ghost" x-show="$store.dw.categoryFilter" @click="$store.dw.categoryFilter = null" style="font-size:11px; padding:4px 10px">✕ Category</button>
</div>
```

Replace with:

```html
<!-- Controls -->
<div class="controls-row">
  <span class="filter-group-label">Status:</span>
  <div class="pill-row">
    <template x-for="s in ['All','Listed','Sold','Prepping']" :key="s">
      <button class="pill" :class="{ active: statusFilter === s }"
        @click="statusFilter = s; $store.dw.categoryFilter = null; dateRange = 'all'" x-text="s"></button>
    </template>
  </div>
  <span class="filter-group-label">Sites:</span>
  <div class="pill-row">
    <button class="pill" :class="{ active: siteFilters.length === 0 }" @click="clearSites()">All</button>
    <template x-for="s in $store.dw.sites" :key="s.id">
      <button class="pill" :class="{ active: siteFilters.includes(s.name) }"
        @click="toggleSite(s.name)" x-text="s.name"></button>
    </template>
  </div>
  <template x-if="statusFilter === 'Listed' || statusFilter === 'Sold'">
    <div class="pill-row">
      <span class="filter-group-label">When:</span>
      <template x-for="d in ['all','24h','7d','30d']" :key="d">
        <button class="pill" :class="{ active: dateRange === d }" @click="dateRange = d"
          x-text="d === 'all' ? 'All time' : d"></button>
      </template>
    </div>
  </template>
  <input class="controls-search" type="text" placeholder="search name, SKU, lot…" x-model="nameSearch">
  <button class="btn btn-ghost" x-show="$store.dw.categoryFilter" @click="$store.dw.categoryFilter = null" style="font-size:11px; padding:4px 10px">✕ Category</button>
</div>
```

- [ ] **Step 2: Verify controls render correctly**

Reload the Inventory view. Confirm:
- Status pills work (All/Listed/Sold/Prepping)
- Site pills are now multi-select: clicking eBay toggles it on/off, clicking All resets
- "When:" pill row appears only when Listed or Sold status is active, disappears for All/Prepping
- Search placeholder reads "search name, SKU, lot…"
- Switching from Listed → All resets dateRange to 'all' (When row disappears cleanly)

- [ ] **Step 3: Commit**

```bash
git add public/v2/index.html
git commit -m "feat: multi-select site pills, date range pills, search placeholder ref #102 #110"
```

---

## Task 4: Listed mode table HTML

**Files:**
- Modify: `public/v2/index.html` (table section, ~lines 425–484)

Replace the single `<table class="data-table">` block with three conditional blocks: Listed, Sold, and All/Prepping. This task covers the Listed block.

- [ ] **Step 1: Replace the table block**

Find the entire table block starting at `<!-- Table -->` and ending at the closing `</table>` plus the empty-state div (around lines 425–483). Replace the whole thing with:

```html
<!-- Table: Listed mode -->
<template x-if="statusFilter === 'Listed'">
  <div>
    <table class="tb" style="width:100%">
      <thead>
        <tr>
          <th class="sortable" :class="{'sort-active': sortKey==='createdTime'}" @click="sortBy('createdTime')" style="width:64px">Added<span x-text="sortGlyph('createdTime')"></span></th>
          <th class="sortable" :class="{'sort-active': sortKey==='name'}" @click="sortBy('name')">Name<span x-text="sortGlyph('name')"></span></th>
          <th style="width:32px"></th>
          <th class="sortable" :class="{'sort-active': sortKey==='site'}" @click="sortBy('site')" style="width:72px">Site<span x-text="sortGlyph('site')"></span></th>
          <th style="width:80px">Status</th>
          <th class="sortable r" :class="{'sort-active': sortKey==='listPrice'}" @click="sortBy('listPrice')" style="width:90px">List<span x-text="sortGlyph('listPrice')"></span></th>
          <th class="sortable r" :class="{'sort-active': sortKey==='eaf'}" @click="sortBy('eaf')" style="width:90px">Payout<span x-text="sortGlyph('eaf')"></span></th>
          <th class="sortable r" :class="{'sort-active': sortKey==='profit'}" @click="sortBy('profit')" style="width:90px">Profit<span x-text="sortGlyph('profit')"></span></th>
          <th class="r" style="width:54px">Days</th>
        </tr>
      </thead>
      <tbody>
        <template x-for="r in rows" :key="r.id">
          <tr @click="openItem(r)" style="cursor:pointer">
            <td class="date" x-text="dateAdded(r)"></td>
            <td class="nm">
              <span x-text="r.name"></span>
              <span x-show="needsAttention(r)" :title="daysListed(r) + ' days listed'" style="margin-left:6px;color:var(--warn);font-size:11px;cursor:default">⚑</span>
            </td>
            <td><span class="badge" :class="r.category?.badge_class" x-text="r.category?.name"></span></td>
            <td><span class="badge" :class="$store.dw.siteBadgeClass($store.dw.siteLabel(r))" x-text="$store.dw.siteLabel(r)"></span></td>
            <td style="position:relative">
              <span class="badge" :class="badgeClass(r.status)" x-text="r.status"
                @click.stop="toggleStatusMenu(r.id, $event)" style="cursor:pointer" title="Click to change status"></span>
              <div x-show="openStatusId === r.id" class="status-dropdown" @click.stop>
                <template x-for="s in ['Listed','Sold','Prepping']" :key="s">
                  <div class="status-option" x-text="s" @click="changeStatus(r, s, $event)"></div>
                </template>
              </div>
            </td>
            <td class="num r" x-text="$store.dw.activeListing(r)?.list_price > 0 ? $store.dw.fmt0($store.dw.activeListing(r).list_price) : '—'"></td>
            <td class="num r est" x-text="eafDisplay(r)"></td>
            <td class="num r" :class="$store.dw.estProfit(r) >= 0 ? 'pos' : 'neg'"
              style="font-weight:600" x-text="profitDisplay(r)"></td>
            <td class="num r" style="color:var(--ink-4)" x-text="daysListed(r) + 'd'"></td>
          </tr>
        </template>
      </tbody>
    </table>
    <div x-show="rows.length === 0" style="padding:40px;text-align:center;color:var(--ink-4);font:500 13px/1 var(--mono)">No items match your filters</div>
  </div>
</template>
```

- [ ] **Step 2: Verify Listed table**

Reload, ensure Listed is the active status pill. Table should show the new columns: Added, Name, cat badge, Site, Status, List, Payout, Profit (accented), Days. Click a row — item modal should open. Toggle status dropdown should still work (click status badge, not the row).

- [ ] **Step 3: Commit**

```bash
git add public/v2/index.html
git commit -m "feat: Listed mode table — tb class, dedicated columns, profit accent ref #102"
```

---

## Task 5: Sold mode and All/Prepping fallback table HTML

**Files:**
- Modify: `public/v2/index.html` (immediately after the Listed `<template x-if>` block)

- [ ] **Step 1: Add Sold mode table**

Immediately after the closing `</template>` of the Listed block, add:

```html
<!-- Table: Sold mode -->
<template x-if="statusFilter === 'Sold'">
  <div>
    <table class="tb" style="width:100%">
      <thead>
        <tr>
          <th class="sortable" :class="{'sort-active': sortKey==='soldDate'}" @click="sortBy('soldDate')" style="width:72px">Sold<span x-text="sortGlyph('soldDate')"></span></th>
          <th class="sortable" :class="{'sort-active': sortKey==='name'}" @click="sortBy('name')">Name<span x-text="sortGlyph('name')"></span></th>
          <th style="width:32px"></th>
          <th class="sortable" :class="{'sort-active': sortKey==='site'}" @click="sortBy('site')" style="width:72px">Site<span x-text="sortGlyph('site')"></span></th>
          <th class="sortable r" :class="{'sort-active': sortKey==='listPrice'}" @click="sortBy('listPrice')" style="width:90px">Sale<span x-text="sortGlyph('listPrice')"></span></th>
          <th class="r" style="width:90px">Profit</th>
          <th class="r" style="width:90px">Shipping</th>
          <th style="width:110px">Tracking</th>
        </tr>
      </thead>
      <tbody>
        <template x-for="r in rows" :key="r.id">
          <tr @click="openItem(r)" style="cursor:pointer">
            <td class="date" x-text="r.order?.date_sold ? new Date(r.order.date_sold + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'"></td>
            <td class="nm" x-text="r.name"></td>
            <td><span class="badge" :class="r.category?.badge_class" x-text="r.category?.name"></span></td>
            <td><span class="badge" :class="$store.dw.siteBadgeClass($store.dw.siteLabel(r))" x-text="$store.dw.siteLabel(r)"></span></td>
            <td class="num r pos" x-text="r.order?.sale_price ? $store.dw.fmt0(r.order.sale_price) : '—'"></td>
            <td class="num r" :class="(r.order?.profit || 0) >= 0 ? 'pos' : 'neg'"
              style="font-weight:600"
              x-text="r.order?.profit != null ? ((r.order.profit >= 0 ? '+' : '') + $store.dw.fmt0(r.order.profit)) : '—'"></td>
            <td class="num r" x-text="r.shipment?.shipping_cost != null ? $store.dw.fmt0(r.shipment.shipping_cost) : '—'"></td>
            <td>
              <span x-show="r.shipment?.tracking_id && trackingData[r.id]"
                :class="'badge ' + trackStatusBadge(trackingData[r.id]?.status)"
                x-text="trackStatusLabel(trackingData[r.id]?.status)"></span>
              <span x-show="r.shipment?.tracking_id && !trackingData[r.id] && !trackingLoading"
                style="color:var(--ink-4);font-size:11px">—</span>
              <span x-show="!r.shipment?.tracking_id"
                style="color:var(--ink-4);font-size:11px">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <div x-show="rows.length === 0" style="padding:40px;text-align:center;color:var(--ink-4);font:500 13px/1 var(--mono)">No items match your filters</div>
  </div>
</template>
```

- [ ] **Step 2: Add All/Prepping fallback table**

Immediately after the Sold `</template>`, add the fallback for All and Prepping (this is the existing table, preserved as-is):

```html
<!-- Table: All / Prepping fallback -->
<template x-if="statusFilter === 'All' || statusFilter === 'Prepping'">
  <div>
    <table class="data-table">
      <thead>
        <tr>
          <th class="sortable" :class="{'sort-active': sortKey==='createdTime'}" @click="sortBy('createdTime')">Added<span x-text="sortGlyph('createdTime')"></span></th>
          <th class="sortable" :class="{'sort-active': sortKey==='name'}" @click="sortBy('name')">Name<span x-text="sortGlyph('name')"></span></th>
          <th class="sortable" :class="{'sort-active': sortKey==='lot'}" @click="sortBy('lot')">Lot<span x-text="sortGlyph('lot')"></span></th>
          <th class="sortable" :class="{'sort-active': sortKey==='category'}" @click="sortBy('category')">Cat<span x-text="sortGlyph('category')"></span></th>
          <th class="sortable" :class="{'sort-active': sortKey==='site'}" @click="sortBy('site')">Site<span x-text="sortGlyph('site')"></span></th>
          <th class="sortable" :class="{'sort-active': sortKey==='status'}" @click="sortBy('status')">Status<span x-text="sortGlyph('status')"></span></th>
          <th class="num sortable" :class="{'sort-active': sortKey==='listPrice'}" @click="sortBy('listPrice')">List Price<span x-text="sortGlyph('listPrice')"></span></th>
          <th class="num sortable" :class="{'sort-active': sortKey==='eaf'}" @click="sortBy('eaf')">EAF Payout<span x-text="sortGlyph('eaf')"></span></th>
          <th class="num sortable" :class="{'sort-active': sortKey==='profit'}" @click="sortBy('profit')">Est. Profit<span x-text="sortGlyph('profit')"></span></th>
          <th class="num sortable" :class="{'sort-active': sortKey==='shipping'}" @click="sortBy('shipping')">Shipping<span x-text="sortGlyph('shipping')"></span></th>
          <th x-show="statusFilter === 'All'" class="num sortable" :class="{'sort-active': sortKey==='soldDate'}" @click="sortBy('soldDate')">Date Sold<span x-text="sortGlyph('soldDate')"></span></th>
          <th x-show="statusFilter === 'All'" style="white-space:nowrap">Tracking</th>
        </tr>
      </thead>
      <tbody>
        <template x-for="r in rows" :key="r.id">
          <tr class="clickable" @click="openItem(r)">
            <td style="color:var(--muted);white-space:nowrap" x-text="dateAdded(r)"></td>
            <td style="text-align:left">
              <span x-text="r.name"></span>
              <span x-show="needsAttention(r)" :title="daysListed(r) + ' days listed'" style="margin-left:6px;color:var(--orange);font-size:11px;cursor:default">⚑</span>
            </td>
            <td style="color:var(--muted);font-size:11px" x-text="r.lot?.name"></td>
            <td><span class="badge" :class="r.category?.badge_class" x-text="r.category?.name"></span></td>
            <td><span class="badge" :class="$store.dw.siteBadgeClass($store.dw.siteLabel(r))" x-text="$store.dw.siteLabel(r)"></span></td>
            <td style="position:relative">
              <span class="badge" :class="badgeClass(r.status)" x-text="r.status"
                @click.stop="toggleStatusMenu(r.id, $event)" style="cursor:pointer" title="Click to change status"></span>
              <div x-show="openStatusId === r.id" class="status-dropdown" @click.stop>
                <template x-for="s in ['Listed','Sold','Prepping']" :key="s">
                  <div class="status-option" x-text="s" @click="changeStatus(r, s, $event)"></div>
                </template>
              </div>
            </td>
            <td class="num" x-text="$store.dw.activeListing(r)?.list_price > 0 ? $store.dw.fmt0($store.dw.activeListing(r).list_price) : 'n/a'"></td>
            <td class="num est" x-text="eafDisplay(r)"></td>
            <td class="num est" x-text="profitDisplay(r)"></td>
            <td class="num" :class="shipIsEst(r) ? 'est' : 'act'" x-text="shipDisplay(r)"></td>
            <td x-show="statusFilter === 'All'" style="color:var(--muted);white-space:nowrap"
              x-text="r.order?.date_sold ? new Date(r.order.date_sold + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '-'"></td>
            <td x-show="statusFilter === 'All'" class="num">
              <span x-show="r.shipment?.tracking_id">
                <span x-show="trackingData[r.id]" :class="'badge ' + trackStatusBadge(trackingData[r.id]?.status)" x-text="trackStatusLabel(trackingData[r.id]?.status)"></span>
                <span x-show="!trackingData[r.id] && !trackingLoading" style="color:var(--muted);font-size:11px">—</span>
              </span>
              <span x-show="!r.shipment?.tracking_id" style="color:var(--muted);font-size:11px">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <div x-show="rows.length === 0" style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No items match your filters</div>
  </div>
</template>
```

- [ ] **Step 3: Verify all three modes**

Test each mode in the browser:

**Listed:** Columns = Added, Name, badge, Site, Status, List, Payout, Profit (accented gold), Days. Profit is accent color + bold. Row click opens item modal. Status badge dropdown still works (click badge, not row).

**Sold:** Columns = Date Sold, Name, badge, Site, Sale Price, Profit (accented gold + bold), Shipping (real number or —), Tracking badge. No `~$7` estimates. Row click opens item modal.

**All:** Existing full table renders as before. Date Sold and Tracking columns visible.

**Prepping:** Same as All table, Date Sold and Tracking hidden.

- [ ] **Step 4: Bump version**

In `public/v2/js/config.js`, increment `APP_VERSION` (e.g. `1.1.49` → `1.1.50`).
In `package.json`, increment `version` to match.

- [ ] **Step 5: Final commit**

```bash
git add public/v2/index.html public/v2/js/config.js package.json
git commit -m "feat: Sold + All/Prepping mode tables; v1.1.50 ref #102 #110"
git push
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| §1 View modes (Listed/Sold/All) | Tasks 4 + 5 |
| §2 Listed columns | Task 4 |
| §3 Sold columns (actual profit, no estimates) | Task 5 |
| §4 All/Prepping unchanged | Task 5 Step 2 |
| §5 Date range filter | Task 2 Step 3 (logic) + Task 3 Step 1 (pills) |
| §6 Site multi-select | Task 2 Steps 1/5/6 (logic) + Task 3 Step 1 (pills) |
| §7 Search expansion (name, sku, lot, notes) | Task 2 Step 3 |
| §8 Tape forecast | Task 1 Steps 1–3 |
| §9 Visual (tb class, profit accent) | Tasks 4 + 5 |

**Placeholder scan:** No TBDs, no "handle edge cases", no "similar to Task N" repetition. All code blocks are complete.

**Type consistency:**
- `siteFilters` (array) introduced Task 2 Step 1 — used in Task 2 Steps 3/4/5/6, Task 3 Step 1. Consistent.
- `dateRange` (string) introduced Task 2 Step 1 — used in Task 2 Steps 3/4/5, Task 3 Step 1. Consistent.
- `toggleSite(name)` / `clearSites()` defined Task 2 Step 6 — called in Task 3 Step 1. Consistent.
- `pipeline` getter added to store Task 1 Step 1 — referenced in dashboard Task 1 Step 2, tape Task 1 Step 3. Consistent.
- `trackStatusBadge` / `trackStatusLabel` / `trackingData` — already exist in items.js, referenced in Task 5 Sold table. Consistent.
