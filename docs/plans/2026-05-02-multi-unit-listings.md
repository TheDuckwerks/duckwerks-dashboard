# Multi-Unit Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add quantity support to items so a single item row can represent N identical units sold through one eBay listing, with automatic order sync decrement, inventory badge, and a multi-unit detail modal.

**Architecture:** Three columns added to `items` (`quantity`, `quantity_sold`, `oversold`). Order creation logic in `server/orders.js` checks `quantity > 1` and increments instead of hard-flipping to Sold. Frontend adds a quantity badge to the items view, a new multi-unit modal (modeled on lot modal), and per-order rows in the tracking view.

**Tech Stack:** SQLite (better-sqlite3), Express, Alpine.js, vanilla JS — no build step.

---

## File Map

**Modified:**
- `server/db.js` — run schema migrations for new columns
- `server/items.js` — expose `quantity`/`quantity_sold`/`oversold` in responses; accept `quantity` in POST/PATCH
- `server/orders.js` — multi-unit decrement logic in POST handler
- `server/ebay.js` — capture `quantityAvailable` from Browse API listing sync
- `public/v2/js/views/items.js` — quantity badge, click routing to multi-unit modal
- `public/v2/partials/views/items.html` — quantity badge in status column
- `public/v2/js/store.js` — expose `activeMultiUnitItemId`, open/close routing
- `public/v2/js/modals/item-modal.js` — add editable quantity field
- `public/v2/partials/modals/item.html` — quantity field in item edit form

**Created:**
- `public/v2/js/modals/multi-unit-modal.js` — Alpine component for multi-unit detail
- `public/v2/partials/modals/multi-unit.html` — modal HTML (lot layout adapted)

---

## Task 1: Schema migration

**Files:**
- Modify: `server/db.js`

- [ ] **Step 1: Open `server/db.js` and read its current contents**

- [ ] **Step 2: Add migration block after the db.prepare line that opens the database**

Find where the DB is opened (the `new Database(...)` call) and add these ALTER TABLE statements wrapped in a try/catch (SQLite throws if the column already exists):

```js
// Multi-unit listings — quantity columns
['quantity', 'oversold', 'quantity_sold'].forEach(col => {
  const cols = db.pragma('table_info(items)').map(r => r.name);
  if (!cols.includes(col)) {
    const def = col === 'quantity' ? 'INTEGER NOT NULL DEFAULT 1'
              : 'INTEGER NOT NULL DEFAULT 0';
    db.prepare(`ALTER TABLE items ADD COLUMN ${col} ${def}`).run();
  }
});
```

- [ ] **Step 3: Restart server and verify columns exist**

```bash
npm start &
sleep 2
sqlite3 data/duckwerks.db "PRAGMA table_info(items);" | grep -E "quantity|oversold"
```

Expected output — three rows:
```
...|quantity|INTEGER|1||1|
...|quantity_sold|INTEGER|1||0|
...|oversold|INTEGER|1||0|
```

- [ ] **Step 4: Kill dev server, commit**

```bash
kill %1
git add server/db.js
git commit -m "feat: add quantity/quantity_sold/oversold columns to items"
```

---

## Task 2: Server — expose quantity in items API

**Files:**
- Modify: `server/items.js`

- [ ] **Step 1: Update `buildItem()` return object to include the three new fields**

In `buildItem()`, the return statement currently ends with:
```js
return {
  id: row.id, name: row.name, cost: row.cost,
  notes: row.notes, sku: row.sku, status: row.status, created_at: row.created_at,
  category, lot, listings, order, shipment,
};
```

Change it to:
```js
return {
  id: row.id, name: row.name, cost: row.cost,
  notes: row.notes, sku: row.sku, status: row.status, created_at: row.created_at,
  quantity:      row.quantity      ?? 1,
  quantity_sold: row.quantity_sold ?? 0,
  oversold:      row.oversold      ?? 0,
  category, lot, listings, order, shipment,
};
```

- [ ] **Step 2: Update `POST /` to accept `quantity`**

The current insert:
```js
const { name, category_id, lot_id, cost, notes } = req.body;
...
'INSERT INTO items (name, category_id, lot_id, cost, notes) VALUES (?, ?, ?, ?, ?)'
).run(name, category_id || null, lot_id || null, cost || 0, notes || null);
```

Change to:
```js
const { name, category_id, lot_id, cost, notes, quantity } = req.body;
const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
...
'INSERT INTO items (name, category_id, lot_id, cost, notes, quantity) VALUES (?, ?, ?, ?, ?, ?)'
).run(name, category_id || null, lot_id || null, cost || 0, notes || null, qty);
```

- [ ] **Step 3: Update `PATCH /:id` allowed fields to include `quantity`**

```js
const allowed = ['name', 'status', 'category_id', 'lot_id', 'cost', 'notes', 'quantity'];
```

- [ ] **Step 4: Verify with curl**

```bash
npm start &
sleep 2
curl -s http://localhost:3000/api/items | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d[0]?.quantity, d[0]?.quantity_sold, d[0]?.oversold)"
```

Expected: `1 0 0` (or similar for first item)

- [ ] **Step 5: Kill dev server, commit**

```bash
kill %1
git add server/items.js
git commit -m "feat: expose quantity fields in items API"
```

---

## Task 3: Order sync — multi-unit decrement logic

**Files:**
- Modify: `server/orders.js`

- [ ] **Step 1: Read the current POST handler in `server/orders.js`**

The status-update block currently reads:
```js
const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
if (listing) {
  db.prepare("UPDATE items SET status = 'Sold' WHERE id = ?").run(listing.item_id);
  db.prepare("UPDATE listings SET status = 'sold', ended_at = datetime('now') WHERE id = ?").run(listing_id);
  ...
}
```

- [ ] **Step 2: Replace the status-update block with multi-unit-aware logic**

Replace the block above with:
```js
const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
if (listing) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(listing.item_id);
  if (item) {
    if (item.quantity > 1) {
      const incomingQty = req.body.quantity || 1;
      const newSold = item.quantity_sold + incomingQty;
      const cappedSold = Math.min(newSold, item.quantity);
      const oversold = newSold > item.quantity ? 1 : 0;
      const newStatus = cappedSold >= item.quantity ? 'Sold' : item.status;
      db.prepare(
        "UPDATE items SET quantity_sold = ?, oversold = ?, status = ? WHERE id = ?"
      ).run(cappedSold, oversold, newStatus, item.id);
      if (cappedSold >= item.quantity) {
        db.prepare("UPDATE listings SET status = 'sold', ended_at = datetime('now') WHERE id = ?").run(listing_id);
      }
    } else {
      db.prepare("UPDATE items SET status = 'Sold' WHERE id = ?").run(listing.item_id);
      db.prepare("UPDATE listings SET status = 'sold', ended_at = datetime('now') WHERE id = ?").run(listing_id);
    }
  }
  // Fire-and-forget: sync sold status to Google Sheet for DWG items
  if (item?.sku) markDiscSold(item.sku).catch(e => console.error('markDiscSold failed:', e.message));
}
```

- [ ] **Step 3: Accept `quantity` in the POST destructure**

Update the top of the POST handler:
```js
const { listing_id, platform_order_num, sale_price, date_sold, quantity } = req.body;
```

- [ ] **Step 4: Manual smoke test**

```bash
npm start &
sleep 2
# Find a test listing_id from your DB
sqlite3 data/duckwerks.db "SELECT id FROM listings LIMIT 1;"
# Create a test item with quantity=3
curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Multi","cost":10,"quantity":3}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('item id:', d.id, 'qty:', d.quantity)"
```

Note the item id. Create a listing for it, then POST an order and verify `quantity_sold` increments and status stays `Listed` until units run out.

- [ ] **Step 5: Kill dev server, commit**

```bash
kill %1
git add server/orders.js
git commit -m "feat: multi-unit order decrement in orders POST handler"
```

---

## Task 4: Listing sync — capture quantityAvailable from Browse API

**Files:**
- Modify: `server/ebay.js`

- [ ] **Step 1: Find the Browse API listing push in `server/ebay.js`**

In `GET /listings`, the listings push currently reads:
```js
listings.push({ title: item.title, legacyItemId, price: item.price?.value, watchCount: item.watchCount ?? null });
```

- [ ] **Step 2: Add `quantityAvailable` to the push**

```js
listings.push({
  title:             item.title,
  legacyItemId,
  price:             item.price?.value,
  watchCount:        item.watchCount ?? null,
  quantityAvailable: item.quantityAvailable ?? 1,
});
```

- [ ] **Step 3: Find where the frontend uses `GET /api/ebay/listings` to import listings**

Search the frontend for where the sync response is consumed and an item/listing is created:

```bash
grep -rn "ebay/listings\|legacyItemId\|quantityAvailable" public/v2/js/
```

- [ ] **Step 4: Pass `quantity` when creating the item during sync import**

In whichever JS file handles the import (likely `items.js` view or `store.js`), when POSTing to `/api/items` for a newly synced listing, include `quantity: listing.quantityAvailable` if it's > 1.

Find the `fetch('/api/items', { method: 'POST', body: JSON.stringify({...}) })` call and add:
```js
quantity: listing.quantityAvailable > 1 ? listing.quantityAvailable : 1,
```

- [ ] **Step 5: Commit**

```bash
git add server/ebay.js public/v2/js/views/items.js  # or whichever file was modified
git commit -m "feat: capture quantityAvailable from eBay Browse API on listing sync"
```

---

## Task 5: Item edit modal — add quantity field

**Files:**
- Modify: `public/v2/js/modals/item-modal.js`
- Modify: `public/v2/partials/modals/item.html`

- [ ] **Step 1: Add `quantity` to the item modal JS state**

In `item-modal.js`, find where item fields are set in `reset()` or `init()` (wherever the modal populates from the item record). Add:
```js
this.quantity = item.quantity ?? 1;
```

- [ ] **Step 2: Add `quantity` to the save/patch call**

In the PATCH call body, add:
```js
quantity: this.quantity,
```

- [ ] **Step 3: Add quantity input to `item.html` modal form**

Find a logical spot in the edit section of the item modal (near cost or notes). Add:
```html
<div class="form-row" x-show="item && item.quantity > 1">
  <label class="form-label">QUANTITY AVAILABLE</label>
  <input type="number" x-model.number="quantity" min="1" step="1"
    style="width:80px; background:var(--surface); border:1px solid var(--border2); color:var(--white); font-family:'Space Mono',monospace; font-size:12px; padding:4px 8px; text-align:right">
</div>
```

This field only shows for existing multi-unit items (`item.quantity > 1`). For new items and single-unit items it stays hidden.

- [ ] **Step 4: Verify in browser**

Start the server, open the Bask towel item modal, confirm the quantity field appears and saves correctly.

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/modals/item-modal.js public/v2/partials/modals/item.html
git commit -m "feat: add editable quantity field to item modal for multi-unit items"
```

---

## Task 6: Items view — quantity badge

**Files:**
- Modify: `public/v2/js/views/items.js`
- Modify: `public/v2/partials/views/items.html`

- [ ] **Step 1: Add `isMultiUnit(r)` helper to items view JS**

In `public/v2/js/views/items.js`, add a helper method to the component:
```js
isMultiUnit(r) { return r.quantity > 1; },

quantityBadgeClass(r) {
  const remaining = r.quantity - r.quantity_sold;
  if (remaining <= 0) return 'badge badge-sold';
  if (remaining / r.quantity <= 0.2) return 'badge badge-prepping'; // amber = low stock
  return 'badge badge-listed';
},

quantityBadgeText(r) {
  const remaining = r.quantity - r.quantity_sold;
  return `${remaining} / ${r.quantity}`;
},
```

- [ ] **Step 2: Update the status cell in `items.html` to show badge vs pill**

Find the status column `<td>` in the items table. It currently renders a badge like:
```html
<span class="badge" :class="badgeClass(r.status)" x-text="r.status"></span>
```

Replace with:
```html
<template x-if="isMultiUnit(r)">
  <span :class="quantityBadgeClass(r)" x-text="quantityBadgeText(r)"></span>
</template>
<template x-if="!isMultiUnit(r)">
  <span class="badge" :class="badgeClass(r.status)" x-text="r.status"></span>
</template>
```

- [ ] **Step 3: Route multi-unit item clicks to multi-unit modal**

Find the row click handler (likely `@click="openItem(r)"` or similar). Update `openItem` in `items.js`:
```js
openItem(r) {
  const dw = Alpine.store('dw');
  if (r.quantity > 1) {
    dw.openModal('multi-unit', r.id);
  } else {
    dw.openModal('item', r.id);
  }
},
```

- [ ] **Step 4: Verify in browser**

Start server, go to INV view, confirm the towel row shows "18 / 18" badge in listed color instead of a status pill.

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/views/items.js public/v2/partials/views/items.html
git commit -m "feat: quantity badge for multi-unit items in inventory view"
```

---

## Task 7: Store — multi-unit modal routing

**Files:**
- Modify: `public/v2/js/store.js`

- [ ] **Step 1: Add `activeMultiUnitItemId` to store state**

In `Alpine.store('dw')`, find where other `activeXxx` properties are defined (e.g. `activeLotName`, `activeModal`) and add:
```js
activeMultiUnitItemId: null,
```

- [ ] **Step 2: Update `openModal` to handle `'multi-unit'`**

Find the `openModal` method in store.js. Add a case for `'multi-unit'`:
```js
if (name === 'multi-unit') {
  this.activeMultiUnitItemId = id;
}
```

- [ ] **Step 3: Update `closeModal` / `resetModal` to clear `activeMultiUnitItemId`**

In the modal close logic, add:
```js
this.activeMultiUnitItemId = null;
```

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/store.js
git commit -m "feat: add multi-unit modal routing to store"
```

---

## Task 8: Multi-unit modal — HTML

**Files:**
- Create: `public/v2/partials/modals/multi-unit.html`
- Modify: `public/v2/index.html` (add partial placeholder)

- [ ] **Step 1: Create `multi-unit.html` partial**

```html
<div x-show="$store.dw.activeModal === 'multi-unit'" x-data="multiUnitModal" class="modal-overlay" x-cloak>
  <div class="modal-box modal-box-wide" x-show="item" @keydown.escape.window="$store.dw.activeModal === 'multi-unit' && $store.dw.closeModal()">

    <div class="modal-header">
      <div class="modal-title" x-text="item ? item.name : ''"></div>
      <button class="modal-close" @click="$store.dw.closeModal()">✕</button>
    </div>

    <div class="modal-body">

      <!-- Oversold warning -->
      <div x-show="item && item.oversold" style="background:var(--red);color:#fff;padding:8px 12px;border-radius:4px;font-size:12px;margin-bottom:16px">
        Warning: more units were sold than inventory tracked. Review orders manually.
      </div>

      <!-- Stat cards -->
      <div class="stat-grid stat-grid-compact" style="margin-bottom:16px">
        <div class="stat-card" :class="totalCost() > 0 ? 'red' : ''">
          <div class="stat-card-label">TOTAL COST</div>
          <div class="stat-card-value" x-text="totalCost() > 0 ? $store.dw.fmt0(totalCost()) : '—'"></div>
          <div class="stat-card-sub" x-text="item ? item.quantity + ' units @ ' + $store.dw.fmt0(item.cost) : ''"></div>
        </div>
        <div class="stat-card green">
          <div class="stat-card-label">RECOVERED</div>
          <div class="stat-card-value" x-text="$store.dw.fmt0(recovered())"></div>
          <div class="stat-card-sub">gross sold revenue</div>
        </div>
        <div class="stat-card" :class="realizedProfit() >= 0 ? 'green' : 'red'">
          <div class="stat-card-label">REALIZED PROFIT</div>
          <div class="stat-card-value" x-text="(realizedProfit() >= 0 ? '+' : '') + $store.dw.fmt0(realizedProfit())"></div>
          <div class="stat-card-sub">sold after fees</div>
        </div>
        <div class="stat-card" :class="forecastedProfit() >= 0 ? 'green' : 'red'">
          <div class="stat-card-label">FORECASTED PROFIT</div>
          <div class="stat-card-value" x-text="(forecastedProfit() >= 0 ? '+' : '') + $store.dw.fmt0(forecastedProfit())"></div>
          <div class="stat-card-sub" x-text="remaining() + ' units remaining'"></div>
        </div>
      </div>

      <!-- Progress bar -->
      <div style="margin-bottom:16px">
        <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-bottom:6px">
          <span>UNITS SOLD</span>
          <span :class="progressClass()" x-text="progressPct() + '%'"></span>
        </div>
        <div class="progress-bar" style="height:10px">
          <div class="progress-fill" :class="progressClass()" :style="'width:' + progressPct() + '%'"></div>
        </div>
        <div style="font-size:11px; color:var(--muted); margin-top:4px">
          <span x-text="item ? item.quantity_sold + ' sold · ' + remaining() + ' remaining' : ''"></span>
        </div>
      </div>

      <!-- Orders table -->
      <div class="modal-section-label" style="margin-bottom:8px">Sales</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align:left">Order #</th>
            <th style="text-align:left">Date</th>
            <th class="num-col">Sale Price</th>
            <th>Shipment</th>
          </tr>
        </thead>
        <tbody>
          <template x-for="o in orders()" :key="o.id">
            <tr>
              <td style="text-align:left; font-size:11px" x-text="o.platform_order_num || '—'"></td>
              <td style="text-align:left; font-size:11px" x-text="o.date_sold || '—'"></td>
              <td class="num-col green" x-text="o.sale_price ? $store.dw.fmt0(o.sale_price) : '—'"></td>
              <td style="text-align:center">
                <span class="badge"
                  :class="shipmentBadgeClass(o)"
                  x-text="shipmentStatus(o)"></span>
              </td>
            </tr>
          </template>
          <tr x-show="orders().length === 0">
            <td colspan="4" style="color:var(--muted); text-align:center">No sales yet</td>
          </tr>
          <tr x-show="remaining() > 0">
            <td colspan="4" style="color:var(--muted); font-size:11px; text-align:left"
              x-text="remaining() + ' units remaining · Listed at ' + listPrice()"></td>
          </tr>
        </tbody>
      </table>

    </div><!-- .modal-body -->
  </div>
</div>
```

- [ ] **Step 2: Add partial placeholder to `index.html`**

In `public/v2/index.html`, find the block of `<!-- partial: modals/xxx -->` comments and add:
```html
<!-- partial: modals/multi-unit -->
```

- [ ] **Step 3: Commit**

```bash
git add public/v2/partials/modals/multi-unit.html public/v2/index.html
git commit -m "feat: multi-unit modal HTML partial"
```

---

## Task 9: Multi-unit modal — JS component

**Files:**
- Create: `public/v2/js/modals/multi-unit-modal.js`
- Modify: `public/v2/index.html` (add script tag)

- [ ] **Step 1: Create `multi-unit-modal.js`**

```js
// ── Multi-Unit Modal ───────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('multiUnitModal', () => ({
    init() {
      this.$watch('$store.dw.activeModal', val => {
        if (val === 'multi-unit') this.reset();
      });
    },

    reset() {},

    get item() {
      const dw = Alpine.store('dw');
      return dw.records.find(r => r.id === dw.activeMultiUnitItemId) || null;
    },

    orders() {
      if (!this.item) return [];
      return (this.item.listings || [])
        .flatMap(l => l.order ? [l.order] : [])
        .sort((a, b) => (a.date_sold || '').localeCompare(b.date_sold || ''));
    },

    remaining() {
      if (!this.item) return 0;
      return Math.max(0, this.item.quantity - this.item.quantity_sold);
    },

    totalCost() {
      if (!this.item) return 0;
      return this.item.quantity * (this.item.cost || 0);
    },

    recovered() {
      return this.orders().reduce((s, o) => s + (o.sale_price || 0), 0);
    },

    realizedProfit() {
      return this.orders().reduce((s, o) => s + (o.profit || 0), 0);
    },

    forecastedProfit() {
      const dw = Alpine.store('dw');
      const remaining = this.remaining();
      const listP = dw.activeListing(this.item)?.list_price || 0;
      const estPerUnit = listP > 0 ? dw.estProfit(this.item) : 0;
      return this.realizedProfit() + (remaining * estPerUnit);
    },

    progressPct() {
      if (!this.item || this.item.quantity === 0) return 0;
      return Math.min(100, Math.round((this.item.quantity_sold / this.item.quantity) * 100));
    },

    progressClass() {
      const pct = this.progressPct();
      if (pct >= 100) return 'green';
      if (pct >= 50)  return 'yellow';
      return 'red';
    },

    listPrice() {
      const dw = Alpine.store('dw');
      const lp = dw.activeListing(this.item)?.list_price;
      return lp ? dw.fmt0(lp) : '—';
    },

    shipmentStatus(order) {
      const s = order.shipment;
      if (!s) return 'Pending';
      if (s.delivered_at) return 'Delivered';
      if (s.tracking_id)  return 'Shipped';
      return 'Pending';
    },

    shipmentBadgeClass(order) {
      const st = this.shipmentStatus(order);
      if (st === 'Delivered') return 'badge badge-sold';
      if (st === 'Shipped')   return 'badge badge-listed';
      return 'badge badge-prepping';
    },
  }));
});
```

- [ ] **Step 2: Add script tag to `index.html`**

Find the block of `<script src="...modals/...">` tags and add:
```html
<script src="/v2/js/modals/multi-unit-modal.js"></script>
```

- [ ] **Step 3: Verify in browser**

Start server, go to INV, click the Bask towel row. The multi-unit modal should open with the stat cards, progress bar, and empty orders table (no sales yet). Close with Escape or ✕.

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/modals/multi-unit-modal.js public/v2/index.html
git commit -m "feat: multi-unit modal Alpine component"
```

---

## Task 10: Tracking view — per-order rows for multi-unit items

**Files:**
- Modify: `public/v2/js/views/items.js`
- Modify: `public/v2/partials/views/items.html`

- [ ] **Step 1: Update the tracking row data to expand multi-unit items**

In `items.js`, find where the tracking rows are built (likely a computed property or filter on `dw.records` that produces rows for the Sold/tracking table). The current logic produces one row per item. Update it to expand multi-unit items into one row per order:

```js
trackingRows() {
  const dw = Alpine.store('dw');
  const rows = [];
  for (const r of dw.records) {
    if (r.quantity > 1) {
      // Expand: one row per order
      const orders = (r.listings || []).flatMap(l => l.order ? [{ ...l.order, _item: r }] : []);
      for (const o of orders) {
        rows.push({
          _isMultiUnitRow: true,
          _item:           r,
          _order:          o,
          _label:          `${r.name} · Order #${o.platform_order_num || o.id}`,
          shipment:        o.shipment || null,
        });
      }
    } else if (r.shipment?.tracking_id || r.status === 'Sold') {
      rows.push({ _isMultiUnitRow: false, _item: r, shipment: r.shipment });
    }
  }
  return rows;
},
```

- [ ] **Step 2: Update the tracking table in `items.html` to use `_label` for multi-unit rows**

In the tracking table row template, update the name cell:
```html
<td x-text="row._isMultiUnitRow ? row._label : row._item.name"></td>
```

And the shipment status/tracking cells to use `row.shipment` directly (which already works since both paths set `shipment`).

- [ ] **Step 3: Verify in browser**

After an order comes in against the towel listing (or manually create a test order), confirm the tracking view shows "Bask Disc Golf Towel Kaleidoscope 3 2025... · Order #XXXXX" as the row label.

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/views/items.js public/v2/partials/views/items.html
git commit -m "feat: expand multi-unit items to per-order rows in tracking view"
```

---

## Task 11: End-to-end validation — delete and reimport towel listing

This task validates the full import path using the Bask towel as the test case.

- [ ] **Step 1: Note the current towel item ID and listing ID**

```bash
sqlite3 data/duckwerks.db "SELECT i.id, i.name, i.quantity, l.id as listing_id, l.platform_listing_id FROM items i LEFT JOIN listings l ON l.item_id = i.id WHERE i.name LIKE '%Bask%';"
```

- [ ] **Step 2: Delete the existing towel item (cascades to listing)**

In the dashboard item modal, delete the towel item. Or via API:
```bash
curl -X DELETE http://fedora.local:3000/api/items/<item_id>
```

- [ ] **Step 3: Trigger listing sync**

Go to the dashboard INV view and trigger the eBay listing sync (the sync button that calls `GET /api/ebay/listings` and imports new listings). The towel listing (item 168349612758) should be reimported.

- [ ] **Step 4: Verify quantity was captured**

```bash
sqlite3 data/duckwerks.db "SELECT name, quantity, quantity_sold FROM items WHERE name LIKE '%Bask%';"
```

Expected: `quantity = 18`, `quantity_sold = 0`

- [ ] **Step 5: Verify badge in INV view**

Go to INV, confirm towel row shows "18 / 18" badge in green.

- [ ] **Step 6: Commit version bump**

```bash
# Bump APP_VERSION in public/v2/js/config.js and package.json
git add public/v2/js/config.js package.json
git commit -m "chore: bump to v2.0.15 — multi-unit listings"
git push origin main
bash scripts/deploy-nuc.sh
```

---

## Self-Review Notes

- Task 4 Step 3 tells the implementer to grep for where the sync is consumed — the exact file location depends on what the grep finds. This is intentional: the sync import UI lives in the items view but the exact call site needs to be confirmed at implementation time.
- The `forecastedProfit()` in the multi-unit modal uses `dw.estProfit(this.item)` per-unit — this depends on `estProfit` in store.js working from the active listing's list_price. Confirm `dw.activeListing(item)` returns the listing correctly for a multi-unit item with no sold listing (it should — `activeListing` finds the active listing, not the sold one).
- Tracking view Task 10 shows the structure; the implementer must confirm how the existing tracking table is built in `items.js` before wiring in the new `trackingRows()` computed property.
