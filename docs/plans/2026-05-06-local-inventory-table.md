# Local Inventory Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Google Sheet as the source of truth for item location and category-specific metadata with a local SQLite `inventory` table, and surface location in the shipping modal and sites order rows.

**Architecture:** A new `inventory` table keyed by SKU stores location, category, and a JSON metadata blob. `catalog-intake.js` writes to it on disc entry (in addition to the sheet during transition, then exclusively). A new `/api/inventory` route handles CRUD. The shipping modal and sites view look up location by SKU at order-check time. A minimal inline edit UI lets Geoff correct bad entries without leaving the dashboard.

**Tech Stack:** SQLite via better-sqlite3, Express router, Alpine.js frontend, Google Sheets API (read-only during backfill, then retired from intake).

---

## File Map

| File | Change |
|---|---|
| `server/db.js` | Add `CREATE TABLE IF NOT EXISTS inventory` migration |
| `server/inventory.js` | New router: `GET /api/inventory/:sku`, `PATCH /api/inventory/:sku`, `GET /api/inventory` (list) |
| `server/catalog-intake.js` | Write to `inventory` on `POST /disc` in addition to sheet |
| `server.js` | Mount `/api/inventory` router |
| `scripts/backfill-inventory-from-sheet.js` | One-time: read sheet cols A+B, insert into `inventory` |
| `public/v2/js/views/sites.js` | After `fetchOrders`, batch-fetch locations for visible SKUs; attach to order entries |
| `public/v2/partials/views/sites.html` | Show location chip below SKU in order rows |
| `public/v2/js/modals/shipping-modal.js` | Attach location to in-transit records |
| `public/v2/partials/modals/shipping.html` | Show location column in tracking table |
| `public/v2/partials/views/catalog.html` | Add inventory list section with inline edit form |
| `public/v2/js/views/catalog.js` | Load inventory list; handle inline patch |

---

## Task 1: Add `inventory` table to SQLite

**Files:**
- Modify: `server/db.js`

The table needs to exist before anything else. No migration framework — just `CREATE TABLE IF NOT EXISTS` on startup.

- [ ] **Read `server/db.js`** to find where the db is opened and any existing table setup.

- [ ] **Add the table creation** immediately after the db is opened:

```js
// In server/db.js, after `const db = new Database(...)`
db.exec(`
  CREATE TABLE IF NOT EXISTS inventory (
    sku        TEXT PRIMARY KEY,
    location   TEXT,
    category   TEXT,
    status     TEXT NOT NULL DEFAULT 'intake'
               CHECK(status IN ('intake','listed','sold')),
    metadata   TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
```

- [ ] **Start the server and confirm it starts without error:**

```bash
npm start
```

Expected: server starts on port 3000, no crash.

- [ ] **Verify table exists:**

```bash
sqlite3 data/duckwerks.db ".schema inventory"
```

Expected: prints the CREATE TABLE statement.

- [ ] **Commit:**

```bash
git add server/db.js
git commit -m "feat: add inventory table to SQLite ref #119"
```

---

## Task 2: Inventory API router

**Files:**
- Create: `server/inventory.js`
- Modify: `server.js`

Three routes: get one by SKU, patch one by SKU (location/metadata), list all.

- [ ] **Create `server/inventory.js`:**

```js
// server/inventory.js — GET/PATCH /api/inventory
const router = require('express').Router();
const db     = require('./db');

const getBySku  = db.prepare('SELECT * FROM inventory WHERE sku = ?');
const listAll   = db.prepare('SELECT * FROM inventory ORDER BY created_at DESC');
const upsert    = db.prepare(`
  INSERT INTO inventory (sku, location, category, status, metadata)
  VALUES (@sku, @location, @category, @status, @metadata)
  ON CONFLICT(sku) DO UPDATE SET
    location = excluded.location,
    category = excluded.category,
    status   = excluded.status,
    metadata = excluded.metadata
`);
const patch = db.prepare(`
  UPDATE inventory SET
    location = COALESCE(@location, location),
    category = COALESCE(@category, category),
    status   = COALESCE(@status, status),
    metadata = COALESCE(@metadata, metadata)
  WHERE sku = @sku
`);

// GET /api/inventory — list all
router.get('/', (req, res) => {
  const rows = listAll.all();
  res.json({ inventory: rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })) });
});

// GET /api/inventory/:sku
router.get('/:sku', (req, res) => {
  const row = getBySku.get(req.params.sku);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null });
});

// PATCH /api/inventory/:sku — partial update
router.patch('/:sku', (req, res) => {
  const { location, category, status, metadata } = req.body;
  const row = getBySku.get(req.params.sku);
  if (!row) return res.status(404).json({ error: 'not found' });
  patch.run({
    sku:      req.params.sku,
    location: location  ?? null,
    category: category  ?? null,
    status:   status    ?? null,
    metadata: metadata !== undefined ? JSON.stringify(metadata) : null,
  });
  const updated = getBySku.get(req.params.sku);
  res.json({ ...updated, metadata: updated.metadata ? JSON.parse(updated.metadata) : null });
});

module.exports = router;
```

- [ ] **Mount in `server.js`** — find where other routers are mounted (e.g. `app.use('/api/items', ...)`) and add:

```js
const inventoryRouter = require('./server/inventory');
// ...
app.use('/api/inventory', inventoryRouter);
```

- [ ] **Restart the server and smoke test:**

```bash
# should 404
curl -s http://localhost:3000/api/inventory/DWG-001 | jq .
# should return empty array
curl -s http://localhost:3000/api/inventory | jq .
```

- [ ] **Commit:**

```bash
git add server/inventory.js server.js
git commit -m "feat: add inventory API router ref #119"
```

---

## Task 3: Backfill from Google Sheet

**Files:**
- Create: `scripts/backfill-inventory-from-sheet.js`

One-time script. Reads cols A (disc num → DWG-NNN) and B (location) from the sheet. Inserts into `inventory` with `category = 'disc'` and `status = 'intake'`. Idempotent (`ON CONFLICT DO UPDATE`). Dry-run by default.

- [ ] **Create `scripts/backfill-inventory-from-sheet.js`:**

```js
// scripts/backfill-inventory-from-sheet.js
// Usage: node scripts/backfill-inventory-from-sheet.js [--confirm]
const { google } = require('googleapis');
const path       = require('path');
const Database   = require('better-sqlite3');

const SHEET_ID   = '1Gmdw2qcHRA_9wz29CXul3pTCT92pX56V4FPLkrhNnHE';
const SHEET_NAME = 'duckwerks-dg-catalog';
const KEY_PATH   = path.join(__dirname, '..', 'docs', 'handicaps-244e5d936e6c.json');
const DB_PATH    = path.join(__dirname, '..', 'data', 'duckwerks.db');
const confirm    = process.argv.includes('--confirm');

const upsert = `
  INSERT INTO inventory (sku, location, category, status)
  VALUES (@sku, @location, 'disc', 'intake')
  ON CONFLICT(sku) DO UPDATE SET
    location = excluded.location,
    category = excluded.category
`;

async function main() {
  const auth   = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const resp   = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SHEET_NAME}!A:B` });
  const rows   = (resp.data.values || []).slice(1).filter(r => r[0]);

  const records = rows.map(r => ({
    sku:      `DWG-${String(parseInt(r[0], 10)).padStart(3, '0')}`,
    location: r[1] || null,
  }));

  console.log(`Found ${records.length} disc rows`);
  records.forEach(r => console.log(`  ${r.sku}  →  ${r.location || '(no location)'}`));

  if (!confirm) {
    console.log('\nDry run — pass --confirm to write');
    return;
  }

  const db   = new Database(DB_PATH);
  const stmt = db.prepare(upsert);
  const run  = db.transaction(() => records.forEach(r => stmt.run(r)));
  run();
  console.log(`\nInserted/updated ${records.length} rows in inventory`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Dry run first:**

```bash
node scripts/backfill-inventory-from-sheet.js
```

Expected: prints all disc rows with SKU and location, ends with "Dry run".

- [ ] **If output looks right, confirm:**

```bash
node scripts/backfill-inventory-from-sheet.js --confirm
```

Expected: "Inserted/updated N rows in inventory"

- [ ] **Verify in SQLite:**

```bash
sqlite3 data/duckwerks.db "SELECT sku, location FROM inventory LIMIT 10"
```

- [ ] **Commit:**

```bash
git add scripts/backfill-inventory-from-sheet.js
git commit -m "chore: backfill inventory table from DG sheet ref #119"
```

---

## Task 4: Wire catalog intake to write to `inventory`

**Files:**
- Modify: `server/catalog-intake.js`

On `POST /disc`, after appending to the sheet, also insert into `inventory`. Keep the sheet write — it stays as backup during transition.

- [ ] **Add the upsert statement** near the top of `catalog-intake.js`, after `const db = require('./db')`:

```js
const upsertInventory = db.prepare(`
  INSERT INTO inventory (sku, location, category, metadata)
  VALUES (@sku, @location, 'disc', @metadata)
  ON CONFLICT(sku) DO UPDATE SET
    location = excluded.location,
    metadata = excluded.metadata
`);
```

- [ ] **In the `POST /disc` handler**, after `res.json({ discNum })` — actually before it, after the sheet append succeeds — add the inventory write:

```js
const sku      = `DWG-${String(discNum).padStart(3, '0')}`;
const metadata = JSON.stringify({
  manufacturer, mold, type, plastic,
  run:       run || null,
  condition, weight, color,
  listPrice,
  speed:     flight.speed     ?? null,
  glide:     flight.glide     ?? null,
  turn:      flight.turn      ?? null,
  fade:      flight.fade      ?? null,
  stability: flight.stability ?? null,
});
upsertInventory.run({ sku, location: box || null, metadata });
```

- [ ] **Restart and test with the catalog intake form** — add a disc, then verify:

```bash
sqlite3 data/duckwerks.db "SELECT sku, location, metadata FROM inventory ORDER BY created_at DESC LIMIT 3"
```

Expected: the new disc appears with correct SKU, box, and metadata JSON.

- [ ] **Commit:**

```bash
git add server/catalog-intake.js
git commit -m "feat: catalog intake writes to inventory table ref #119"
```

---

## Task 5: Location lookup in sites view order rows

**Files:**
- Modify: `public/v2/js/views/sites.js`
- Modify: `public/v2/partials/views/sites.html`

After orders are fetched, collect all SKUs from matched recs and batch-lookup locations. Attach `location` to each order entry item. Show it below the SKU in the order row.

The lookup is one request per unique SKU — small number (typically 1-5 per order check). No caching layer needed; the data is local SQLite, response is instant.

- [ ] **Add `locations` map to `sitesView` state** (top of the Alpine data object, with other state):

```js
locations: {},  // { [sku]: location string | null }
```

- [ ] **Add `_fetchLocations` method** to `sitesView`, after `_fetchReverbOrders`:

```js
async _fetchLocations(skus) {
  const unique = [...new Set(skus.filter(Boolean))];
  const results = await Promise.all(unique.map(async sku => {
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`);
      if (!res.ok) return { sku, location: null };
      const data = await res.json();
      return { sku, location: data.location || null };
    } catch { return { sku, location: null }; }
  }));
  const map = {};
  results.forEach(({ sku, location }) => { map[sku] = location; });
  this.locations = map;
},
```

- [ ] **Call `_fetchLocations` at the end of `fetchOrders`**, after the allSettled block, before `this.ordersLoading = false`:

```js
const allSkus = [
  ...this.ebayOrders.flatMap(e => e.items.map(i => i.rec?.sku).filter(Boolean)),
  ...this.reverbOrders.map(e => e.rec?.sku).filter(Boolean),
];
if (allSkus.length) await this._fetchLocations(allSkus);
```

- [ ] **In `sites.html`, eBay order item block** — find the line that shows SKU:

```html
<template x-if="item.rec?.sku">
  <span style="color:var(--muted);margin-left:6px" x-text="'· ' + item.rec.sku"></span>
</template>
```

Replace with:

```html
<template x-if="item.rec?.sku">
  <span style="color:var(--muted);margin-left:6px">
    <span x-text="'· ' + item.rec.sku"></span>
    <template x-if="locations[item.rec.sku]">
      <span style="margin-left:6px;background:var(--ink-4);color:var(--ink-1);font:700 9px/1 var(--mono);letter-spacing:.1em;padding:2px 5px" x-text="locations[item.rec.sku]"></span>
    </template>
  </span>
</template>
```

- [ ] **In `sites.html`, Reverb order block** — find the SKU line:

```html
<template x-if="entry.rec?.sku">
  <div style="font-size:10px;color:var(--muted);margin-top:2px" x-text="entry.rec.sku"></div>
```

Replace with:

```html
<template x-if="entry.rec?.sku">
  <div style="font-size:10px;color:var(--muted);margin-top:2px">
    <span x-text="entry.rec.sku"></span>
    <template x-if="locations[entry.rec.sku]">
      <span style="margin-left:6px;background:var(--ink-4);color:var(--ink-1);font:700 9px/1 var(--mono);letter-spacing:.1em;padding:2px 5px" x-text="locations[entry.rec.sku]"></span>
    </template>
  </div>
```

- [ ] **Test:** open the sites view, click "Check for New Orders". If there are orders with DWG SKUs that have locations in inventory, the box label should appear inline.

- [ ] **Commit:**

```bash
git add public/v2/js/views/sites.js public/v2/partials/views/sites.html
git commit -m "feat: show item location in sites order rows ref #119"
```

---

## Task 6: Location in shipping (in-transit) modal

**Files:**
- Modify: `public/v2/js/modals/shipping-modal.js`
- Modify: `public/v2/partials/modals/shipping.html`

The shipping modal shows sold+in-transit records. Records have `r.sku` at the top level (from `buildItem` in `server/items.js`). Fetch locations for all visible SKUs on open; show in the table.

- [ ] **Add `locations` to `shippingModal` state:**

```js
locations: {},
```

- [ ] **Add `_fetchLocations` method** to `shippingModal`, after `refreshAll`:

```js
async _fetchLocations(records) {
  const skus = [...new Set(records.map(r => r.sku).filter(Boolean))];
  const results = await Promise.all(skus.map(async sku => {
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`);
      if (!res.ok) return { sku, location: null };
      const data = await res.json();
      return { sku, location: data.location || null };
    } catch { return { sku, location: null }; }
  }));
  const map = {};
  results.forEach(({ sku, location }) => { map[sku] = location; });
  this.locations = map;
},
```

- [ ] **Call it in `_open`**, after `await this._loadAll()`:

```js
await this._fetchLocations(this.inTransitRecords);
```

- [ ] **In `shipping.html`**, add a Location column header after the existing `<th>` headers:

```html
<th style="white-space:nowrap;width:80px">Location</th>
```

- [ ] **In `shipping.html`**, add the location cell in the `<tr>` for each record, after the Est. Delivery cell:

```html
<td style="color:var(--muted);font-size:12px">
  <span x-show="locations[r.sku]" style="background:var(--ink-4);color:var(--ink-1);font:700 9px/1 var(--mono);letter-spacing:.1em;padding:2px 5px" x-text="locations[r.sku]"></span>
  <span x-show="!locations[r.sku]" style="color:var(--muted)">—</span>
</td>
```

- [ ] **Test:** open a sold+shipped order's shipping modal. If the record has a SKU with an inventory location, it should appear in the Location column.

- [ ] **Commit:**

```bash
git add public/v2/js/modals/shipping-modal.js public/v2/partials/modals/shipping.html
git commit -m "feat: show item location in shipping modal ref #119"
```

---

## Task 7: Inventory list + inline edit in Catalog view

**Files:**
- Modify: `public/v2/partials/views/catalog.html`
- Modify: `public/v2/js/views/catalog.js`

Add a section below the existing catalog content showing all inventory rows. Each row shows SKU, location, category, status, and a simple inline edit for location (the field most likely to need correction). Edit saves via `PATCH /api/inventory/:sku`. This is intentionally ugly — it's a correction tool, not a polished UI.

- [ ] **Read `public/v2/js/views/catalog.js`** to understand existing state and init pattern before editing.

- [ ] **Add inventory state** to the `catalogView` Alpine data object:

```js
inventory:        [],
inventoryLoading: false,
inventoryErr:     '',
editingSku:       null,
editLocation:     '',
editSaving:       false,
```

- [ ] **Add `loadInventory` method:**

```js
async loadInventory() {
  this.inventoryLoading = true;
  this.inventoryErr     = '';
  try {
    const res  = await fetch('/api/inventory');
    const data = await res.json();
    this.inventory = data.inventory || [];
  } catch (e) {
    this.inventoryErr = e.message;
  }
  this.inventoryLoading = false;
},
```

- [ ] **Add `startEdit`, `cancelEdit`, `saveEdit` methods:**

```js
startEdit(row) {
  this.editingSku  = row.sku;
  this.editLocation = row.location || '';
},

cancelEdit() {
  this.editingSku  = null;
  this.editLocation = '';
},

async saveEdit() {
  this.editSaving = true;
  try {
    const res = await fetch(`/api/inventory/${encodeURIComponent(this.editingSku)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ location: this.editLocation }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();
    const idx = this.inventory.findIndex(r => r.sku === this.editingSku);
    if (idx !== -1) this.inventory[idx] = updated;
    this.cancelEdit();
  } catch (e) {
    this.inventoryErr = e.message;
  }
  this.editSaving = false;
},
```

- [ ] **Call `loadInventory()` from `init`** — add it to the existing `init()` method (or watchlist if catalog view has one):

```js
// inside init(), after existing setup:
this.$watch('$store.dw.activeView', val => {
  if (val === 'catalog') this.loadInventory();
});
if (this.$store.dw.activeView === 'catalog') this.loadInventory();
```

- [ ] **Add inventory section to `catalog.html`** — append at the bottom of the catalog view div, before the closing tag:

```html
<!-- ── Inventory ─────────────────────────────────────────────────────────── -->
<div style="margin-top:48px">
  <div class="modal-section-label" style="margin-bottom:12px">Inventory</div>
  <div x-show="inventoryLoading" style="color:var(--muted);font-size:11px;letter-spacing:1px">Loading...</div>
  <div x-show="inventoryErr" x-text="inventoryErr" style="color:var(--red);font-size:11px"></div>
  <template x-if="!inventoryLoading && inventory.length === 0">
    <div style="color:var(--muted);font-size:11px">No inventory records.</div>
  </template>
  <template x-if="!inventoryLoading && inventory.length > 0">
    <table class="data-table" style="width:100%;table-layout:fixed">
      <thead>
        <tr>
          <th style="text-align:left;width:100px">SKU</th>
          <th style="text-align:left;width:80px">Category</th>
          <th style="text-align:left">Location</th>
          <th style="text-align:left;width:70px">Status</th>
          <th style="width:80px"></th>
        </tr>
      </thead>
      <tbody>
        <template x-for="row in inventory" :key="row.sku">
          <tr>
            <td style="font:700 11px/1 var(--mono)" x-text="row.sku"></td>
            <td style="font-size:11px;color:var(--muted)" x-text="row.category || '—'"></td>
            <td>
              <template x-if="editingSku !== row.sku">
                <span style="font-size:12px" x-text="row.location || '—'"></span>
              </template>
              <template x-if="editingSku === row.sku">
                <input type="text" x-model="editLocation"
                  style="width:100%;font-size:12px;padding:2px 6px;border:1px solid var(--border);background:var(--bg);color:var(--ink-1)"
                  @keydown.enter="saveEdit()" @keydown.escape="cancelEdit()">
              </template>
            </td>
            <td style="font-size:11px;color:var(--muted)" x-text="row.status || '—'"></td>
            <td style="text-align:right">
              <template x-if="editingSku !== row.sku">
                <button @click="startEdit(row)"
                  style="font:700 9px/1 var(--mono);letter-spacing:.1em;padding:3px 8px;background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);cursor:pointer">
                  EDIT
                </button>
              </template>
              <template x-if="editingSku === row.sku">
                <span style="display:flex;gap:6px;justify-content:flex-end">
                  <button @click="saveEdit()" :disabled="editSaving"
                    style="font:700 9px/1 var(--mono);letter-spacing:.1em;padding:3px 8px;background:var(--blue);color:#fff;border:none;cursor:pointer"
                    x-text="editSaving ? '...' : 'SAVE'"></button>
                  <button @click="cancelEdit()"
                    style="font:700 9px/1 var(--mono);letter-spacing:.1em;padding:3px 8px;background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);cursor:pointer">
                    ✕
                  </button>
                </span>
              </template>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </template>
</div>
```

- [ ] **Test:** navigate to the Catalog view. The inventory table should appear below existing content, showing all backfilled disc rows. Click EDIT on a row, change the location, press Enter or SAVE — should update inline without a page reload.

- [ ] **Commit:**

```bash
git add public/v2/partials/views/catalog.html public/v2/js/views/catalog.js
git commit -m "feat: inventory list with inline edit in catalog view ref #119"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `inventory` table with sku, location, category, status, metadata | Task 1 |
| API: get by SKU, patch, list all | Task 2 |
| Backfill DWG discs from sheet | Task 3 |
| Catalog intake writes to inventory | Task 4 |
| Location in sites order rows | Task 5 |
| Location in shipping modal | Task 6 |
| Edit UI for corrections | Task 7 |
| SKU format (DWG-NNN padded) | Task 3 backfill, Task 4 intake |

**No placeholders confirmed.** All steps have actual code or commands.

**Type consistency:** `locations` map used consistently as `{ [sku]: string | null }` in both sites view and shipping modal. API returns `location` field directly. `inventory` list returns array with `sku`, `location`, `category`, `status` fields — all referenced consistently in Task 7 template.

**One gap noted and handled:** the backfill pads disc numbers to 3 digits (`DWG-042`) matching the pattern in `markDiscSold`. Catalog intake should do the same — Task 4 uses `String(discNum).padStart(3, '0')`.
