# SQLite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Airtable with a local SQLite database — full schema, server routes, migration script, and frontend cutover.

**Architecture:** `server/db.js` opens a single `better-sqlite3` connection used by all route files. New Express route files replace the generic Airtable proxy. The frontend store switches from `r.fields[F.fieldId]` access to clean direct field access on a normalized record shape.

**Tech Stack:** Node/Express, better-sqlite3 (sync), Alpine.js (no build step), SQLite3 CLI for manual queries

**Spec:** `docs/superpowers/specs/2026-03-23-sqlite-migration-design.md`

---

## Field Access Change Reference

This migration fundamentally changes how frontend code accesses record data. Every view and modal needs updating.

**Before (Airtable):**
```js
dw.str(r, F.name)          // r.fields['fldY4lOcgWYz1Xh7f']
dw.num(r, F.cost)          // parseFloat(r.fields['fld6gdPNNaCMmeZU4'])
dw.str(r, F.status)        // r.fields['fldE6NtzEZzAVH5TC']
dw.siteLabel(r)            // derives from r.fields[F.site]
r.createdTime              // Airtable metadata field
dw.str(r, F.lot)           // lot name string
dw.num(r, F.listPrice)     // r.fields[F.listPrice]
dw.str(r, F.trackingId)    // r.fields[F.trackingId]
```

**After (SQLite):**
```js
r.name                     // direct
r.cost                     // direct
r.status                   // direct
r.listings[0]?.site?.name  // from listings array
r.created_at               // ISO string
r.lot?.name                // nullable object
r.listings[0]?.list_price  // from active listing
r.shipment?.tracking_id    // from shipment object
```

**`str()` and `num()` helpers are removed.** Replace all calls with direct field access.

---

## File Map

**Create:**
- `server/db.js` — SQLite connection, schema DDL, seed data
- `server/items.js` — GET/POST/PATCH /api/items
- `server/lots.js` — GET/POST/PATCH /api/lots
- `server/listings.js` — POST/PATCH /api/listings
- `server/orders.js` — POST/PATCH /api/orders
- `server/shipments.js` — POST/PATCH /api/shipments
- `server/catalog.js` — GET /api/sites, GET /api/categories
- `scripts/migrate-airtable-to-sqlite.js` — one-shot Airtable → SQLite migration

**Modify:**
- `server.js` — mount new routers, remove Airtable router, simplify /api/config
- `public/v2/js/config.js` — remove F{}, BASE_ID, TABLE_ID; keep CAT_COLOR/CAT_BADGE (updated shape)
- `public/v2/js/store.js` — new fetchAll, createItem, updateItem, createListing, createOrder, createShipment, estProfit, lots getter, remove str/num/SITE_FEES/siteLabel/updateRecord/createRecord
- `public/v2/js/views/dashboard.js` — update all F.* field accesses
- `public/v2/js/views/items.js` — update all F.* field accesses + sort keys
- `public/v2/js/views/lots.js` — update all F.* field accesses
- `public/v2/js/modals/add-modal.js` — simplified form + post-save navigation to item detail
- `public/v2/js/modals/item-modal.js` — update all F.* field accesses
- `public/v2/js/modals/lot-modal.js` — update all F.* field accesses, profit from order.profit
- `public/v2/js/modals/label-modal.js` — saveShipping uses createOrder + createShipment
- `public/v2/js/modals/reverb-modal.js` — update field accesses + updateListing/updateOrder
- `public/v2/js/modals/shipping-modal.js` — update F.* field accesses

**Delete:**
- `server/airtable.js` — removed at cutover

---

## Task 1: Install better-sqlite3 and create server/db.js

**Files:**
- Modify: `package.json`
- Create: `server/db.js`
- Create: `data/` directory (gitignored)

- [ ] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
```

- [ ] **Step 2: Add data/ to .gitignore**

Add to `.gitignore`:
```
data/
```

- [ ] **Step 3: Create server/db.js**

```js
// server/db.js — SQLite connection, schema, and seed data
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = new Database(path.join(DATA_DIR, 'duckwerks.db'));

// Enable foreign keys (off by default in SQLite)
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    fee_rate        REAL NOT NULL DEFAULT 0,
    fee_flat        REAL NOT NULL DEFAULT 0,
    fee_on_shipping INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT,
    badge_class TEXT
  );

  CREATE TABLE IF NOT EXISTS lots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    purchase_date TEXT,
    total_cost    REAL NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    lot_id      INTEGER REFERENCES lots(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    cost        REAL NOT NULL DEFAULT 0,
    notes       TEXT,
    status      TEXT NOT NULL DEFAULT 'Prepping'
                     CHECK(status IN ('Prepping', 'Listed', 'Sold')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS listings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    site_id             INTEGER NOT NULL REFERENCES sites(id),
    platform_listing_id TEXT,
    list_price          REAL,
    shipping_estimate   REAL,
    url                 TEXT,
    status              TEXT NOT NULL DEFAULT 'active'
                             CHECK(status IN ('active', 'sold', 'ended', 'draft')),
    listed_at           TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at            TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id         INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    platform_order_num TEXT,
    sale_price         REAL,
    date_sold          TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    carrier          TEXT,
    service          TEXT,
    tracking_id      TEXT,
    tracking_number  TEXT,
    tracker_url      TEXT,
    label_url        TEXT,
    shipping_cost    REAL,
    shipped_at       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Seed reference data (idempotent) ──────────────────────────────────────────

const seedSites = db.prepare(
  'INSERT OR IGNORE INTO sites (name, fee_rate, fee_flat, fee_on_shipping) VALUES (?, ?, ?, ?)'
);
const seedCategory = db.prepare(
  'INSERT OR IGNORE INTO categories (name, color, badge_class) VALUES (?, ?, ?)'
);

db.transaction(() => {
  seedSites.run('Reverb',     0.0819, 0.49, 0);
  seedSites.run('eBay',       0.1325, 0.40, 1);
  seedSites.run('Facebook',   0,      0,    0);
  seedSites.run('Craigslist', 0,      0,    0);

  seedCategory.run('Music',    'var(--blue)',   'badge-music');
  seedCategory.run('Computer', 'var(--purple)', 'badge-comp');
  seedCategory.run('Gaming',   'var(--orange)', 'badge-gaming');
})();

module.exports = db;
```

- [ ] **Step 4: Verify schema created**

```bash
node -e "require('./server/db'); const D = require('better-sqlite3'); const db = D('./data/duckwerks.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());"
```

Expected output: array with `sites`, `categories`, `lots`, `items`, `listings`, `orders`, `shipments`

- [ ] **Step 5: Commit**

```bash
git add server/db.js package.json package-lock.json .gitignore
git commit -m "ref #33: add server/db.js with SQLite schema and seed data"
```

---

## Task 2: Create server/catalog.js (sites + categories)

**Files:**
- Create: `server/catalog.js`

- [ ] **Step 1: Create server/catalog.js**

```js
// server/catalog.js — GET /api/sites, GET /api/categories
const express = require('express');
const router  = express.Router();
const db      = require('./db');

router.get('/sites', (_req, res) => {
  res.json(db.prepare('SELECT * FROM sites WHERE active = 1 ORDER BY name').all());
});

router.get('/categories', (_req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

module.exports = router;
```

- [ ] **Step 2: Mount in server.js (temporary — add alongside existing routes for now)**

Add to `server.js` after existing `app.use` lines:
```js
app.use('/api', require('./server/catalog'));
```

- [ ] **Step 3: Start server and verify**

```bash
npm start
```

In a new terminal:
```bash
curl -s http://localhost:3000/api/sites | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).map(s=>s.name)))"
```

Expected: `[ 'Craigslist', 'eBay', 'Facebook', 'Reverb' ]`

- [ ] **Step 4: Commit**

```bash
git add server/catalog.js server.js
git commit -m "ref #33: add catalog routes for sites and categories"
```

---

## Task 3: Create server/lots.js

**Files:**
- Create: `server/lots.js`

- [ ] **Step 1: Create server/lots.js**

```js
// server/lots.js — GET/POST/PATCH /api/lots
const express = require('express');
const router  = express.Router();
const db      = require('./db');

// GET all lots with item summary derived from items table
router.get('/', (_req, res) => {
  const lots = db.prepare('SELECT * FROM lots ORDER BY name').all();
  const itemSummary = db.prepare(`
    SELECT lot_id,
      COUNT(*) as item_count,
      SUM(CASE WHEN status = 'Sold' THEN 1 ELSE 0 END) as items_sold,
      SUM(CASE WHEN status = 'Listed' THEN 1 ELSE 0 END) as items_listed,
      SUM(CASE WHEN status = 'Prepping' THEN 1 ELSE 0 END) as items_prepping
    FROM items WHERE lot_id IS NOT NULL GROUP BY lot_id
  `);
  const summaryMap = {};
  itemSummary.all().forEach(s => { summaryMap[s.lot_id] = s; });
  res.json(lots.map(l => ({
    ...l,
    item_count:     summaryMap[l.id]?.item_count     || 0,
    items_sold:     summaryMap[l.id]?.items_sold     || 0,
    items_listed:   summaryMap[l.id]?.items_listed   || 0,
    items_prepping: summaryMap[l.id]?.items_prepping || 0,
  })));
});

// POST create lot
router.post('/', (req, res) => {
  const { name, purchase_date, total_cost, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = db.prepare(
      'INSERT INTO lots (name, purchase_date, total_cost, notes) VALUES (?, ?, ?, ?)'
    ).run(name, purchase_date || null, total_cost || 0, notes || null);
    const lot = db.prepare('SELECT * FROM lots WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(lot);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'lot name already exists' });
    throw e;
  }
});

// PATCH update lot
router.patch('/:id', (req, res) => {
  const { name, purchase_date, total_cost, notes } = req.body;
  const sets = [], vals = [];
  if (name          !== undefined) { sets.push('name = ?');          vals.push(name); }
  if (purchase_date !== undefined) { sets.push('purchase_date = ?'); vals.push(purchase_date); }
  if (total_cost    !== undefined) { sets.push('total_cost = ?');    vals.push(total_cost); }
  if (notes         !== undefined) { sets.push('notes = ?');         vals.push(notes); }
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE lots SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const lot = db.prepare('SELECT * FROM lots WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'not found' });
  res.json(lot);
});

module.exports = router;
```

- [ ] **Step 2: Mount in server.js**

Add: `app.use('/api/lots', require('./server/lots'));`

- [ ] **Step 3: Verify (server must be running)**

```bash
curl -s http://localhost:3000/api/lots
```

Expected: `[]` (empty — no lots yet, that's correct)

- [ ] **Step 4: Commit**

```bash
git add server/lots.js server.js
git commit -m "ref #33: add lots routes"
```

---

## Task 4: Create server/items.js

This is the most complex route — it builds the full nested response shape with listings, orders, and shipments joined.

**Files:**
- Create: `server/items.js`

- [ ] **Step 1: Create the item builder helper function**

```js
// server/items.js — GET/POST/PATCH /api/items
const express = require('express');
const router  = express.Router();
const db      = require('./db');

// Build the full nested item response shape
function buildItem(row) {
  const category = row.category_id ? {
    id: row.category_id, name: row.cat_name,
    color: row.cat_color, badge_class: row.cat_badge
  } : null;

  const lot = row.lot_id ? { id: row.lot_id, name: row.lot_name } : null;

  // Fetch all listings for this item with site data
  const listingRows = db.prepare(`
    SELECT li.*, s.name as site_name, s.fee_rate, s.fee_flat, s.fee_on_shipping
    FROM listings li
    JOIN sites s ON s.id = li.site_id
    WHERE li.item_id = ?
    ORDER BY li.listed_at DESC
  `).all(row.id);

  const listings = listingRows.map(l => {
    const order = db.prepare('SELECT * FROM orders WHERE listing_id = ?').get(l.id);
    let orderObj = null;
    if (order) {
      const shipment = db.prepare('SELECT * FROM shipments WHERE order_id = ?').get(order.id);
      orderObj = {
        ...order,
        profit: order.sale_price - row.cost - (shipment?.shipping_cost || 0),
        shipment: shipment || null,
      };
    }
    return {
      id:                  l.id,
      item_id:             l.item_id,
      platform_listing_id: l.platform_listing_id,
      list_price:          l.list_price,
      shipping_estimate:   l.shipping_estimate,
      url:                 l.url,
      status:              l.status,
      listed_at:           l.listed_at,
      ended_at:            l.ended_at,
      site: {
        id:             l.site_id,
        name:           l.site_name,
        fee_rate:       l.fee_rate,
        fee_flat:       l.fee_flat,
        fee_on_shipping: l.fee_on_shipping,
      },
      order: orderObj,
    };
  });

  // Convenience top-level order/shipment (from the sold/active listing)
  const soldListing = listings.find(l => l.order);
  const order   = soldListing?.order   || null;
  const shipment = order?.shipment     || null;

  return {
    id: row.id, name: row.name, cost: row.cost,
    notes: row.notes, status: row.status, created_at: row.created_at,
    category, lot, listings, order, shipment,
  };
}
```

- [ ] **Step 2: Add GET, POST, PATCH routes**

```js
// GET all items
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT i.*,
      c.name as cat_name, c.color as cat_color, c.badge_class as cat_badge,
      l.name as lot_name
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN lots l ON l.id = i.lot_id
    ORDER BY i.created_at DESC
  `).all();
  res.json(rows.map(buildItem));
});

// POST create item
router.post('/', (req, res) => {
  const { name, category_id, lot_id, cost, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare(
    'INSERT INTO items (name, category_id, lot_id, cost, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(name, category_id || null, lot_id || null, cost || 0, notes || null);
  const row = db.prepare(`
    SELECT i.*, c.name as cat_name, c.color as cat_color, c.badge_class as cat_badge, l.name as lot_name
    FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN lots l ON l.id = i.lot_id
    WHERE i.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(buildItem(row));
});

// PATCH update item fields
router.patch('/:id', (req, res) => {
  const allowed = ['name', 'status', 'category_id', 'lot_id', 'cost', 'notes'];
  const sets = [], vals = [];
  allowed.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const row = db.prepare(`
    SELECT i.*, c.name as cat_name, c.color as cat_color, c.badge_class as cat_badge, l.name as lot_name
    FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN lots l ON l.id = i.lot_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(buildItem(row));
});

module.exports = router;
```

- [ ] **Step 3: Mount in server.js**

Add: `app.use('/api/items', require('./server/items'));`

- [ ] **Step 4: Verify**

```bash
curl -s http://localhost:3000/api/items | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{ const a=JSON.parse(d); console.log('count:', a.length, 'shape:', Object.keys(a[0]||{})); })"
```

Expected: `count: 0 shape: [ 'id', 'name', 'cost', 'notes', 'status', 'created_at', 'category', 'lot', 'listings', 'order', 'shipment' ]`

- [ ] **Step 5: Commit**

```bash
git add server/items.js server.js
git commit -m "ref #33: add items routes with nested listing/order/shipment shape"
```

---

## Task 5: Create server/listings.js, server/orders.js, server/shipments.js

**Files:**
- Create: `server/listings.js`
- Create: `server/orders.js`
- Create: `server/shipments.js`

- [ ] **Step 1: Create server/listings.js**

```js
// server/listings.js — POST/PATCH /api/listings
const express = require('express');
const router  = express.Router();
const db      = require('./db');

// POST create listing (also sets item.status = 'Listed')
router.post('/', (req, res) => {
  const { item_id, site_id, platform_listing_id, list_price, shipping_estimate, url } = req.body;
  if (!item_id || !site_id) return res.status(400).json({ error: 'item_id and site_id are required' });
  const result = db.prepare(`
    INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(item_id, site_id, platform_listing_id || null, list_price || null, shipping_estimate || null, url || null);
  // Set item status to Listed
  db.prepare("UPDATE items SET status = 'Listed' WHERE id = ?").run(item_id);
  res.status(201).json(db.prepare('SELECT * FROM listings WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH update listing
router.patch('/:id', (req, res) => {
  const allowed = ['platform_listing_id', 'list_price', 'shipping_estimate', 'url', 'status', 'ended_at'];
  const sets = [], vals = [];
  allowed.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE listings SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'not found' });
  res.json(listing);
});

module.exports = router;
```

- [ ] **Step 2: Create server/orders.js**

```js
// server/orders.js — POST/PATCH /api/orders
const express = require('express');
const router  = express.Router();
const db      = require('./db');

// POST create order (sale received — also sets item.status = 'Sold' and listing.status = 'sold')
router.post('/', (req, res) => {
  const { listing_id, platform_order_num, sale_price, date_sold } = req.body;
  if (!listing_id) return res.status(400).json({ error: 'listing_id is required' });
  const result = db.prepare(`
    INSERT INTO orders (listing_id, platform_order_num, sale_price, date_sold)
    VALUES (?, ?, ?, ?)
  `).run(listing_id, platform_order_num || null, sale_price || null,
         date_sold || new Date().toISOString().split('T')[0]);
  // Update item and listing status
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
  if (listing) {
    db.prepare("UPDATE items SET status = 'Sold' WHERE id = ?").run(listing.item_id);
    db.prepare("UPDATE listings SET status = 'sold', ended_at = datetime('now') WHERE id = ?").run(listing_id);
  }
  res.status(201).json(db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH update order (e.g. save platform_order_num from Reverb Sync)
router.patch('/:id', (req, res) => {
  const allowed = ['platform_order_num', 'sale_price', 'date_sold'];
  const sets = [], vals = [];
  allowed.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  res.json(order);
});

module.exports = router;
```

- [ ] **Step 3: Create server/shipments.js**

```js
// server/shipments.js — POST/PATCH /api/shipments
const express = require('express');
const router  = express.Router();
const db      = require('./db');

// POST create shipment (label purchased)
router.post('/', (req, res) => {
  const { order_id, carrier, service, tracking_id, tracking_number,
          tracker_url, label_url, shipping_cost } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id is required' });
  const result = db.prepare(`
    INSERT INTO shipments
      (order_id, carrier, service, tracking_id, tracking_number, tracker_url, label_url, shipping_cost, shipped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(order_id, carrier || null, service || null, tracking_id || null,
         tracking_number || null, tracker_url || null, label_url || null, shipping_cost || null);
  res.status(201).json(db.prepare('SELECT * FROM shipments WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH update shipment (tracking updates, label reprint)
router.patch('/:id', (req, res) => {
  const allowed = ['carrier', 'service', 'tracking_id', 'tracking_number',
                   'tracker_url', 'label_url', 'shipping_cost', 'shipped_at'];
  const sets = [], vals = [];
  allowed.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE shipments SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

module.exports = router;
```

- [ ] **Step 4: Mount all three in server.js**

```js
app.use('/api/listings',  require('./server/listings'));
app.use('/api/orders',    require('./server/orders'));
app.use('/api/shipments', require('./server/shipments'));
```

- [ ] **Step 5: Smoke test — create an item and listing end-to-end**

```bash
# Create a test item
curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Guitar","cost":100}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log('item id:', r.id, 'status:', r.status);})"

# Note the item id, then create a listing (use id from above, site_id 1 = Reverb)
curl -s -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -d '{"item_id":1,"site_id":1,"list_price":199}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log('listing id:', r.id, 'status:', r.status);})"

# Verify item is now 'Listed'
curl -s http://localhost:3000/api/items/1 2>/dev/null || curl -s http://localhost:3000/api/items | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const a=JSON.parse(d);console.log(a[0]?.status, 'listings:', a[0]?.listings?.length);})"
```

Expected: item status becomes `Listed`, listings array has 1 entry

- [ ] **Step 6: Clean up test data**

```bash
node -e "const db = require('./server/db'); db.prepare('DELETE FROM items WHERE name = ?').run('Test Guitar'); console.log('cleaned up');"
```

- [ ] **Step 7: Commit**

```bash
git add server/listings.js server/orders.js server/shipments.js server.js
git commit -m "ref #33: add listings, orders, shipments routes"
```

---

## Task 6: Write migration script

**Files:**
- Create: `scripts/migrate-airtable-to-sqlite.js`

The server must be running when this script runs (it fetches from the Airtable proxy). Run with `node scripts/migrate-airtable-to-sqlite.js`.

- [ ] **Step 1: Create the migration script**

```js
// scripts/migrate-airtable-to-sqlite.js
// Migrates all Airtable records to the SQLite DB.
// Requires server running at localhost:3000 (for Airtable proxy).
// Safe to re-run: clears and rebuilds lots, items, listings, orders, shipments each time.
// Does NOT reseed sites/categories (they're already in the DB from db.js).

const db = require('../server/db');

const BASE_ID  = 'appLj1a6YcqzA9uum';
const TABLE_ID = 'tbly2xgKYqgF96kWw';
const F = {
  name:            'fldY4lOcgWYz1Xh7f',
  status:          'fldE6NtzEZzAVH5TC',
  listPrice:       'fldFYd9nqbYVITVSI',
  cost:            'fld6gdPNNaCMmeZU4',
  sale:            'fldwZSF8D6sWUT9zt',
  shipping:        'fldlrSl2HdhA02NUp',
  lot:             'fldxpAbnsKO1zBdJ9',
  category:        'fldijAUBNfrgfJO1P',
  site:            'fld7d1DwvXTqJpJe9',
  url:             'fldz2lwmbIw9AeNam',
  reverbListingId: 'fldMtW0wQEMcUG9X1',
  reverbOrderNum:  'fldman6gKCzhYPv8S',
  dateSold:        'fldcIJOUtePuaxAVH',
  trackingId:      'fld83D6AubuZqZAQQ',
  trackingNumber:  'fldWWo58dN1cFKiSl',
  trackerUrl:      'fldTJ2Dm782UWe5dW',
  labelUrl:        'fld6gsm3lU2L1cK4V',
};

function str(r, f) { const v = r?.fields?.[f]; return v ? String(v).trim() : ''; }
function num(r, f) { return parseFloat(r?.fields?.[f]) || 0; }

async function fetchAllAirtable() {
  const fields = Object.values(F).map(id => `fields[]=${id}`).join('&');
  let all = [], offset = null;
  do {
    const params = `${fields}&returnFieldsByFieldId=true${offset ? '&offset=' + offset : ''}`;
    const res    = await fetch(`http://localhost:3000/api/airtable/${BASE_ID}/${TABLE_ID}?${params}`);
    if (!res.ok) throw new Error(`Airtable fetch failed: ${res.status}`);
    const data = await res.json();
    all    = all.concat(data.records);
    offset = data.offset || null;
  } while (offset);
  return all;
}

async function migrate() {
  console.log('Fetching Airtable records...');
  const records = await fetchAllAirtable();
  console.log(`  Fetched ${records.length} records`);

  // Clear existing migrated data (preserve sites/categories seed)
  db.transaction(() => {
    db.prepare('DELETE FROM shipments').run();
    db.prepare('DELETE FROM orders').run();
    db.prepare('DELETE FROM listings').run();
    db.prepare('DELETE FROM items').run();
    db.prepare('DELETE FROM lots').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('lots','items','listings','orders','shipments')").run();
  })();

  // ── Seed lots from unique lot-name strings ────────────────────────────────
  const lotNames = [...new Set(records.map(r => str(r, F.lot)).filter(Boolean))].sort();
  const insertLot = db.prepare('INSERT INTO lots (name) VALUES (?)');
  db.transaction(() => { lotNames.forEach(n => insertLot.run(n)); })();
  const lotMap = {}; // name → id
  db.prepare('SELECT id, name FROM lots').all().forEach(l => { lotMap[l.name] = l.id; });
  console.log(`  Seeded ${lotNames.length} lots`);

  // ── Reference lookups ─────────────────────────────────────────────────────
  const siteMap = {}; // name → id (case-insensitive)
  db.prepare('SELECT id, name FROM sites').all().forEach(s => { siteMap[s.name.toLowerCase()] = s.id; });

  const catMap = {}; // name → id
  db.prepare('SELECT id, name FROM categories').all().forEach(c => { catMap[c.name] = c.id; });

  function siteId(r) {
    const s = str(r, F.site).toLowerCase();
    if (s.includes('ebay'))       return siteMap['ebay'];
    if (s.includes('reverb'))     return siteMap['reverb'];
    if (s.includes('facebook'))   return siteMap['facebook'];
    if (s.includes('craigslist')) return siteMap['craigslist'];
    return null;
  }

  // ── Insert items ──────────────────────────────────────────────────────────
  const insertItem = db.prepare(`
    INSERT INTO items (name, lot_id, category_id, cost, notes, status, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `);
  const itemIdMap = {}; // airtable record id → sqlite item id

  db.transaction(() => {
    records.forEach(r => {
      const status = str(r, F.status) || 'Prepping';
      const result = insertItem.run(
        str(r, F.name) || '(unnamed)',
        lotMap[str(r, F.lot)] || null,
        catMap[str(r, F.category)] || null,
        num(r, F.cost),
        status,
        r.createdTime || new Date().toISOString()
      );
      itemIdMap[r.id] = result.lastInsertRowid;
    });
  })();
  console.log(`  Inserted ${records.length} items`);

  // ── Insert listings, orders, shipments ────────────────────────────────────
  const insertListing  = db.prepare(`
    INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url, status, listed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOrder    = db.prepare(`
    INSERT INTO orders (listing_id, platform_order_num, sale_price, date_sold)
    VALUES (?, ?, ?, ?)
  `);
  const insertShipment = db.prepare(`
    INSERT INTO shipments (order_id, tracking_id, tracking_number, tracker_url, label_url, shipping_cost, shipped_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `);

  let listingCount = 0, orderCount = 0, shipmentCount = 0;

  db.transaction(() => {
    records.forEach(r => {
      const itemId = itemIdMap[r.id];
      const status = str(r, F.status);
      const sid    = siteId(r);
      const lp     = r.fields[F.listPrice];

      // Insert listing if item has a site (regardless of status — covers Listed and Sold)
      if (sid && (lp != null || status === 'Listed' || status === 'Sold')) {
        const listingStatus = status === 'Sold' ? 'sold' : 'active';
        const liResult = insertListing.run(
          itemId, sid,
          str(r, F.reverbListingId) || null,
          lp != null ? parseFloat(lp) : null,
          r.fields[F.shipping] != null ? parseFloat(r.fields[F.shipping]) : null, // shipping_estimate
          str(r, F.url) || null,
          listingStatus,
          r.createdTime || new Date().toISOString()
        );
        listingCount++;

        // Insert order if sold
        if (status === 'Sold' && (r.fields[F.sale] != null || str(r, F.dateSold))) {
          const orderResult = insertOrder.run(
            liResult.lastInsertRowid,
            str(r, F.reverbOrderNum) || null,
            r.fields[F.sale] != null ? parseFloat(r.fields[F.sale]) : null,
            str(r, F.dateSold) || new Date().toISOString().split('T')[0]
          );
          orderCount++;

          // Insert shipment if has tracking
          if (str(r, F.trackingId)) {
            insertShipment.run(
              orderResult.lastInsertRowid,
              str(r, F.trackingId),
              str(r, F.trackingNumber) || null,
              str(r, F.trackerUrl) || null,
              str(r, F.labelUrl) || null,
              r.fields[F.shipping] != null ? parseFloat(r.fields[F.shipping]) : null
            );
            shipmentCount++;
          }
        }
      }
    });
  })();

  console.log(`  Inserted ${listingCount} listings, ${orderCount} orders, ${shipmentCount} shipments`);

  // ── Validation report ─────────────────────────────────────────────────────
  console.log('\n── Validation Report ──────────────────────────────────────');
  const counts = ['lots','items','listings','orders','shipments'].map(t => ({
    table: t, count: db.prepare(`SELECT COUNT(*) as n FROM ${t}`).get().n
  }));
  counts.forEach(c => console.log(`  ${c.table}: ${c.count}`));

  // Spot-check 5 random items
  console.log('\n── Spot Check (5 random items) ──────────────────────────');
  const sample = db.prepare(`
    SELECT i.name, i.status, i.cost, l.name as lot,
           li.list_price, li.status as listing_status,
           o.sale_price, s.tracking_number
    FROM items i
    LEFT JOIN lots l ON l.id = i.lot_id
    LEFT JOIN listings li ON li.item_id = i.id
    LEFT JOIN orders o ON o.listing_id = li.id
    LEFT JOIN shipments s ON s.order_id = o.id
    ORDER BY RANDOM() LIMIT 5
  `).all();
  sample.forEach(r => console.log(
    `  "${r.name}" | ${r.status} | cost $${r.cost} | lot: ${r.lot || '—'} | list: $${r.list_price || '—'} | sale: $${r.sale_price || '—'} | tracking: ${r.tracking_number || '—'}`
  ));

  console.log('\nMigration complete.');
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run the migration (server must be running)**

```bash
node scripts/migrate-airtable-to-sqlite.js
```

Expected output: row counts for each table, 5 spot-check rows

- [ ] **Step 3: Spot-check against Airtable**

Open Airtable in the browser. Compare:
- Total item count matches
- A few sold items have orders with correct sale prices
- Lots are all present
- A shipped item has tracking number

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-airtable-to-sqlite.js
git commit -m "ref #33: add Airtable → SQLite migration script"
```

---

## Task 7: Update server.js — cut over API routes

Remove the Airtable proxy and simplify `/api/config`.

**Files:**
- Modify: `server.js`
- Delete: `server/airtable.js` (at end of this task)

- [ ] **Step 1: Replace server.js contents**

```js
require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public/v2')));
app.use('/v2', express.static(path.join(__dirname, 'public/v2')));
app.use(express.static(__dirname));

// ── CONFIG ────────────────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({
    shippingProvider: (process.env.SHIPPING_PROVIDER || 'EASYPOST').toUpperCase(),
  });
});

// ── API ROUTERS ───────────────────────────────────────────────────────────────

app.use('/api',           require('./server/catalog'));    // /api/sites, /api/categories
app.use('/api/items',     require('./server/items'));
app.use('/api/lots',      require('./server/lots'));
app.use('/api/listings',  require('./server/listings'));
app.use('/api/orders',    require('./server/orders'));
app.use('/api/shipments', require('./server/shipments'));
app.use('/api/shippo',    require('./server/shippo'));
app.use('/api/label',     require('./server/label'));
app.use('/api/reverb',    require('./server/reverb'));

// ── START ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Duckwerks running at http://localhost:${PORT}`);
  const provider = (process.env.SHIPPING_PROVIDER || 'EASYPOST').toUpperCase();
  console.log(`Shipping provider: ${provider}`);
  if (provider === 'EASYPOST') {
    const testOk = !!process.env.EASYPOST_TEST_TOKEN, liveOk = !!process.env.EASYPOST_LIVE_TOKEN;
    const mode   = process.env.EASYPOST_TEST_MODE === 'true' ? 'TEST' : 'LIVE';
    console.log(`  EasyPost: mode=${mode}, test=${testOk ? 'OK' : 'MISSING'}, live=${liveOk ? 'OK' : 'MISSING'}`);
  }
});
```

- [ ] **Step 2: Delete server/airtable.js**

```bash
git rm server/airtable.js
```

- [ ] **Step 3: Restart server and confirm it starts cleanly**

```bash
npm start
```

Expected: starts without errors, `Shipping provider: EASYPOST` in logs

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "ref #33: cut over server.js to SQLite routes, remove Airtable proxy"
```

---

## Task 8: Update config.js and store.js

The frontend data layer — the biggest single change. Remove all Airtable plumbing. Replace `str()`/`num()` helpers with direct field access. New store methods.

**Files:**
- Modify: `public/v2/js/config.js`
- Modify: `public/v2/js/store.js`

- [ ] **Step 1: Replace config.js**

```js
// ── Duckwerks v2 — Config ─────────────────────────────────────────────────────

// Category display config — keyed by category name
// badge_class matches server/db.js seed data
const CAT_COLOR = {
  Music:    'var(--blue)',
  Computer: 'var(--purple)',
  Gaming:   'var(--orange)',
};

const CAT_BADGE = {
  Music:    'badge-music',
  Computer: 'badge-comp',
  Gaming:   'badge-gaming',
};
```

- [ ] **Step 2: Replace store.js**

```js
// ── Duckwerks v2 — Alpine Store ───────────────────────────────────────────────
// Single source of truth. All API calls happen here.
// Views and modals read $store.dw.* — they never call the API directly.

document.addEventListener('alpine:init', () => {
  Alpine.store('dw', {

    // ── State ─────────────────────────────────────────────────────────────────
    records:          [],
    _lots:            [],        // raw lot rows from /api/lots
    loading:          false,
    error:            null,
    activeView:       'dashboard',
    activeModal:      null,
    activeRecordId:   null,
    activeLotName:    null,
    previousModal:    null,
    categoryFilter:   null,
    pendingFilters:   null,
    shippingProvider: 'EASYPOST',

    // ── Init ──────────────────────────────────────────────────────────────────
    async init() {
      const saved = localStorage.getItem('dw-view');
      if (saved && ['dashboard', 'items', 'lots'].includes(saved)) {
        this.activeView = saved;
      }
      Alpine.effect(() => { localStorage.setItem('dw-view', this.activeView); });

      try {
        const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
        if (cfg.shippingProvider) this.shippingProvider = cfg.shippingProvider;
        await this.fetchAll();
      } catch (e) {
        this.error = 'Failed to initialize: ' + e.message;
      }
    },

    // ── Data Fetch ────────────────────────────────────────────────────────────
    async fetchAll() {
      this.loading = true;
      this.error   = null;
      try {
        const [items, lots] = await Promise.all([
          fetch('/api/items').then(r => { if (!r.ok) throw new Error('items fetch failed'); return r.json(); }),
          fetch('/api/lots').then(r => { if (!r.ok) throw new Error('lots fetch failed'); return r.json(); }),
        ]);
        this.records = items;
        this._lots   = lots;
      } catch (e) {
        this.error = 'Failed to load records: ' + e.message;
      } finally {
        this.loading = false;
      }
    },

    // ── Modal Helpers ─────────────────────────────────────────────────────────
    openModal(type, recordId = null, lotName = null) {
      this.activeModal    = type;
      this.activeRecordId = recordId;
      this.activeLotName  = lotName;
    },
    closeModal() {
      if (this.previousModal) {
        const prev = this.previousModal;
        this.previousModal  = null;
        this.activeModal    = prev.type;
        this.activeRecordId = prev.recordId;
        this.activeLotName  = prev.lotName;
        return;
      }
      this.activeModal    = null;
      this.activeRecordId = null;
      this.activeLotName  = null;
    },

    navToItems(status, category, site) {
      this.pendingFilters = {
        status:   status   || 'All',
        category: category || null,
        site:     site     || 'All',
      };
      this.previousModal = null;
      this.activeView = 'items';
      this.closeModal();
    },

    // ── Computed record sets ──────────────────────────────────────────────────
    get listedRecords() { return this.records.filter(r => r.status === 'Listed'); },
    get soldRecords()   { return this.records.filter(r => r.status === 'Sold'); },

    // Lots: _lots from API enriched with their items array
    get lots() {
      return this._lots.map(lot => ({
        ...lot,
        items: this.records.filter(r => r.lot?.id === lot.id),
      }));
    },

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Best active listing for display (highest list_price among active listings)
    activeListing(r) {
      const active = (r.listings || []).filter(l => l.status === 'active');
      if (!active.length) return r.listings?.[0] || null;
      return active.reduce((best, l) => (l.list_price || 0) > (best.list_price || 0) ? l : best, active[0]);
    },

    // Site label from best active listing
    siteLabel(r) {
      return this.activeListing(r)?.site?.name || '';
    },

    // Est. profit for a listed item.
    // Uses shipment cost if shipped, else listing shipping_estimate, else $10 placeholder.
    // Fees come from listing.site.
    estProfit(r) {
      const listing = this.activeListing(r);
      const lp      = listing?.list_price || 0;
      const cost    = r.cost || 0;

      let ship;
      if (r.shipment?.shipping_cost != null) {
        ship = r.shipment.shipping_cost;
      } else if (listing?.shipping_estimate != null) {
        ship = listing.shipping_estimate;
      } else {
        ship = 10; // placeholder
      }

      let fee = 0;
      if (listing?.site) {
        const s = listing.site;
        fee = s.fee_on_shipping ? (lp + ship) * s.fee_rate + s.fee_flat
                                :  lp         * s.fee_rate + s.fee_flat;
      }
      return lp - cost - ship - fee;
    },

    // Post-fee payout for a listed item (est.)
    payout(r) {
      const listing = this.activeListing(r);
      const lp      = listing?.list_price || 0;
      const ship    = listing?.shipping_estimate ?? 10;
      let fee = 0;
      if (listing?.site) {
        const s = listing.site;
        fee = s.fee_on_shipping ? (lp + ship) * s.fee_rate + s.fee_flat
                                :  lp         * s.fee_rate + s.fee_flat;
      }
      return lp - fee;
    },

    fmt0(n)  { return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    fmtK(n)  { return Math.abs(n) >= 1000 ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'K' : this.fmt0(n); },
    pct(a, b){ return b > 0 ? Math.round((a / b) * 100) : 0; },

    // ── Writes ────────────────────────────────────────────────────────────────
    async updateItem(id, fields) {
      const res = await fetch(`/api/items/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      const updated = await res.json();
      const idx = this.records.findIndex(r => r.id === id);
      if (idx !== -1) this.records[idx] = updated;
    },

    async createItem(fields) {
      const res = await fetch('/api/items', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const created = await res.json();
      this.records.push(created);
      return created;
    },

    async createListing(fields) {
      const res = await fetch('/api/listings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create listing failed: ${res.status}`);
      // Refresh item in store (status changed to Listed)
      const itemRes = await fetch(`/api/items`).then(r => r.json());
      this.records = itemRes;
      return await res.json();
    },

    async updateListing(id, fields) {
      const res = await fetch(`/api/listings/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update listing failed: ${res.status}`);
      await this.fetchAll(); // listings are nested in items — full refresh needed
    },

    async createOrder(fields) {
      const res = await fetch('/api/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create order failed: ${res.status}`);
      const created = await res.json(); // capture before fetchAll — body stream can only be read once
      await this.fetchAll();
      return created;
    },

    async updateOrder(id, fields) {
      const res = await fetch(`/api/orders/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update order failed: ${res.status}`);
    },

    async createShipment(fields) {
      const res = await fetch('/api/shipments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create shipment failed: ${res.status}`);
      const created = await res.json(); // capture before fetchAll — body stream can only be read once
      await this.fetchAll();
      return created;
    },

    async updateShipment(id, fields) {
      const res = await fetch(`/api/shipments/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update shipment failed: ${res.status}`);
    },

    // ── Tracking ──────────────────────────────────────────────────────────────
    _carrierName(raw) {
      const map = { UPSDAP: 'UPS', UPS: 'UPS', USPS: 'USPS', FedEx: 'FedEx',
                    DHLExpress: 'DHL Express', DHL: 'DHL' };
      return map[raw] || raw || null;
    },

    async fetchTracker(trackingId) {
      if (!trackingId) return null;
      try {
        const res  = await fetch(`/api/label/tracker/${trackingId}`);
        const data = await res.json();
        if (!res.ok || data.skipped) return null;
        const events      = data.tracking_details || [];
        const deliveryEvt = events.find(e => e.status === 'delivered');
        return {
          status:      data.status,
          carrier:     this._carrierName(data.carrier),
          estDelivery: data.est_delivery_date || null,
          deliveredAt: deliveryEvt?.datetime || null,
          events,
          publicUrl:   data.public_url || null,
        };
      } catch (e) {
        console.warn('fetchTracker failed:', e);
        return null;
      }
    },

    isInTransit(r, trackingData) {
      if (r.status !== 'Sold' || !r.shipment?.tracking_id) return false;
      const td = trackingData[r.id];
      if (!td || td.status !== 'delivered') return true;
      if (!td.deliveredAt) return false;
      return (Date.now() - new Date(td.deliveredAt).getTime()) < 3 * 24 * 60 * 60 * 1000;
    },

  });
});
```

- [ ] **Step 3: Reload the app in browser**

Open `http://localhost:3000`. Expected: app loads, no console errors, dashboard shows items from SQLite (counts should match migration report).

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/config.js public/v2/js/store.js
git commit -m "ref #33: replace Airtable store with SQLite API calls; remove F{} field map"
```

---

## Task 9: Update views — dashboard.js, items.js, lots.js

Replace all `F.*` field access and `dw.str()`/`dw.num()` calls with direct field access.

**Files:**
- Modify: `public/v2/js/views/dashboard.js`
- Modify: `public/v2/js/views/items.js`
- Modify: `public/v2/js/views/lots.js`

- [ ] **Step 1: Replace dashboard.js**

```js
// ── Dashboard View ────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('dashView', () => ({

    trackingData:    {},
    trackingLoading: false,

    init() {
      this.$watch('$store.dw.loading', val => { if (!val) this._loadTracking(); });
      const dw = Alpine.store('dw');
      if (!dw.loading && dw.records.length > 0) this._loadTracking();
    },

    get inTransitRows() {
      const dw = Alpine.store('dw');
      return dw.records.filter(r => dw.isInTransit(r, this.trackingData));
    },

    async _loadTracking() {
      const dw = Alpine.store('dw');
      const toFetch = dw.records.filter(r => r.status === 'Sold' && r.shipment?.tracking_id);
      if (!toFetch.length) return;
      this.trackingLoading = true;
      const results = await Promise.all(toFetch.map(async r => ({
        id: r.id, data: await dw.fetchTracker(r.shipment.tracking_id)
      })));
      const merged = {};
      results.forEach(({ id, data }) => { merged[id] = data; });
      this.trackingData    = merged;
      this.trackingLoading = false;
    },

    trackStatus(r)      { return this.trackingData[r.id]?.status || null; },
    trackCarrier(r)     { return this.trackingData[r.id]?.carrier || '—'; },
    trackEstDelivery(r) {
      const raw = this.trackingData[r.id]?.estDelivery;
      return raw ? new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    },

    trackStatusBadge(status) {
      switch (status) {
        case 'delivered':        return 'badge-sold';
        case 'out_for_delivery': return 'badge-pending';
        case 'in_transit':       return 'badge-listed';
        case 'return_to_sender':
        case 'failure':          return 'badge-prepping';
        default:                 return 'badge-other';
      }
    },
    trackStatusLabel(status) {
      if (!status) return '—';
      return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },

    get totalInvested() {
      return Alpine.store('dw').records.reduce((s, r) => s + (r.cost || 0), 0);
    },
    get revenue() {
      return Alpine.store('dw').soldRecords.reduce((s, r) => s + (r.order?.sale_price || 0), 0);
    },
    get profit() {
      return Alpine.store('dw').soldRecords.reduce((s, r) => s + (r.order?.profit || 0), 0);
    },
    get pipeline() {
      const dw = Alpine.store('dw');
      return dw.records.filter(r => r.status !== 'Sold').reduce((s, r) => s + dw.payout(r), 0);
    },
    get notListed() {
      return Alpine.store('dw').records.filter(r => r.status !== 'Listed' && r.status !== 'Sold').length;
    },

    get lotRows() {
      const dw = Alpine.store('dw');
      return dw.lots.map(lot => {
        const cost      = lot.items.reduce((s, r) => s + (r.cost || 0), 0);
        const recovered = lot.items.filter(r => r.status === 'Sold')
                            .reduce((s, r) => s + (r.order?.sale_price || 0), 0);
        const pct    = cost > 0 ? Math.min(100, Math.round((recovered / cost) * 100)) : 0;
        const upside = lot.items.filter(r => r.status === 'Listed')
                         .reduce((s, r) => s + dw.payout(r), 0);
        return { name: lot.name, cost, recovered, pct, upside };
      }).sort((a, b) => b.cost - a.cost);
    },

    barClass(pct) {
      if (pct >= 100) return 'green';
      if (pct >= 50)  return 'yellow';
      return 'red';
    },

    get recentlySold() {
      return [...Alpine.store('dw').soldRecords]
        .sort((a, b) => new Date(b.order?.date_sold || b.created_at) - new Date(a.order?.date_sold || a.created_at))
        .slice(0, 10);
    },
    get recentlyListed() {
      return [...Alpine.store('dw').listedRecords]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10);
    },

    listedDate(r) {
      return new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    soldDate(r) {
      const raw = r.order?.date_sold || r.created_at;
      return raw ? new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    },
    itemProfit(r) { return r.order?.profit || 0; },

  }));
});
```

- [ ] **Step 2: Replace items.js**

```js
// ── Items View ────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('itemsView', () => ({
    statusFilter: 'Listed',
    siteFilter:   'All',
    nameSearch:   '',
    openStatusId: null,
    sortKey:      'created_at',
    sortDir:      'desc',
    trackingData:    {},
    trackingLoading: false,

    init() {
      document.addEventListener('click', () => { this.openStatusId = null; });
      this.$watch('$store.dw.pendingFilters', v => {
        if (v) {
          this.statusFilter = v.status;
          this.siteFilter   = v.site;
          Alpine.store('dw').categoryFilter = v.category;
          Alpine.store('dw').pendingFilters = null;
        }
      });
      this.$watch('statusFilter', val => {
        if (val === 'Sold') this._loadTracking();
      });
      const dw = Alpine.store('dw');
      if (this.statusFilter === 'Sold' && !dw.loading && dw.records.length > 0) this._loadTracking();
    },

    get rows() {
      const dw = Alpine.store('dw');
      let recs = dw.records;

      if (dw.categoryFilter) {
        recs = recs.filter(r => r.category?.name === dw.categoryFilter);
      }
      if (this.statusFilter !== 'All') {
        recs = recs.filter(r => r.status === this.statusFilter);
      }
      if (this.siteFilter !== 'All') {
        recs = recs.filter(r => dw.siteLabel(r) === this.siteFilter);
      }
      const q = this.nameSearch.trim().toLowerCase();
      if (q) recs = recs.filter(r => r.name.toLowerCase().includes(q));

      const key = this.sortKey, dir = this.sortDir;
      recs = [...recs].sort((a, b) => {
        let av, bv;
        if      (key === 'created_at') { av = new Date(a.created_at).getTime(); bv = new Date(b.created_at).getTime(); }
        else if (key === 'name')       { av = a.name.toLowerCase();             bv = b.name.toLowerCase(); }
        else if (key === 'lot')        { av = (a.lot?.name||'').toLowerCase();  bv = (b.lot?.name||'').toLowerCase(); }
        else if (key === 'category')   { av = (a.category?.name||'').toLowerCase(); bv = (b.category?.name||'').toLowerCase(); }
        else if (key === 'site')       { av = dw.siteLabel(a).toLowerCase();   bv = dw.siteLabel(b).toLowerCase(); }
        else if (key === 'status')     { av = a.status.toLowerCase();          bv = b.status.toLowerCase(); }
        else if (key === 'listPrice')  { av = dw.activeListing(a)?.list_price || 0; bv = dw.activeListing(b)?.list_price || 0; }
        else if (key === 'eaf')        { av = dw.payout(a);  bv = dw.payout(b); }
        else if (key === 'profit')     { av = dw.estProfit(a); bv = dw.estProfit(b); }
        else if (key === 'shipping')   { av = dw.activeListing(a)?.shipping_estimate || 0; bv = dw.activeListing(b)?.shipping_estimate || 0; }
        else return 0;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ?  1 : -1;
        return 0;
      });
      return recs;
    },

    sortBy(key) {
      if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { this.sortKey = key; this.sortDir = 'asc'; }
    },
    sortIndicator(key) {
      if (this.sortKey !== key) return '';
      return this.sortDir === 'asc' ? ' ↑' : ' ↓';
    },

    badgeClass(status) {
      const s = (status || '').toLowerCase();
      if (s === 'listed')   return 'badge-listed';
      if (s === 'sold')     return 'badge-sold';
      if (s === 'prepping') return 'badge-prepping';
      return 'badge-other';
    },
    catBadgeClass(cat) { return CAT_BADGE[cat] || 'badge-other'; },

    eafDisplay(r)  {
      const dw = Alpine.store('dw');
      const lp = dw.activeListing(r)?.list_price || 0;
      return lp > 0 ? dw.fmt0(dw.payout(r)) : '—';
    },
    profitDisplay(r) {
      const dw = Alpine.store('dw');
      const p  = dw.estProfit(r);
      return (p >= 0 ? '+' : '') + dw.fmt0(p);
    },
    shipDisplay(r) {
      const dw = Alpine.store('dw');
      const l  = dw.activeListing(r);
      return l?.shipping_estimate != null ? dw.fmt0(l.shipping_estimate) : '~$10';
    },
    shipIsEst(r) { return Alpine.store('dw').activeListing(r)?.shipping_estimate == null; },

    toggleStatusMenu(id, e) { e.stopPropagation(); this.openStatusId = this.openStatusId === id ? null : id; },

    async changeStatus(r, status, e) {
      e.stopPropagation();
      this.openStatusId = null;
      const fields = { status };
      if (status === 'Sold' && !r.order?.date_sold) fields.date_sold = new Date().toISOString().split('T')[0];
      await Alpine.store('dw').updateItem(r.id, fields);
    },

    dateAdded(r) {
      return new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    daysListed(r) {
      return Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
    },
    needsAttention(r) { return r.status === 'Listed' && this.daysListed(r) >= 20; },
    openItem(r) { Alpine.store('dw').openModal('item', r.id); },

    async _loadTracking() {
      const dw = Alpine.store('dw');
      if (dw.loading || !dw.records.length) return;
      const toFetch = dw.records.filter(r => r.status === 'Sold' && r.shipment?.tracking_id);
      if (!toFetch.length) return;
      this.trackingLoading = true;
      const results = await Promise.all(toFetch.map(async r => ({
        id: r.id, data: await dw.fetchTracker(r.shipment.tracking_id)
      })));
      const merged = {};
      results.forEach(({ id, data }) => { merged[id] = data; });
      this.trackingData    = merged;
      this.trackingLoading = false;
    },

    trackStatusBadge(status) {
      switch (status) {
        case 'delivered':        return 'badge-sold';
        case 'out_for_delivery': return 'badge-pending';
        case 'in_transit':       return 'badge-listed';
        case 'return_to_sender':
        case 'failure':          return 'badge-prepping';
        default:                 return 'badge-other';
      }
    },
    trackStatusLabel(status) {
      if (!status) return '—';
      return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },
  }));
});
```

- [ ] **Step 3: Replace lots.js**

```js
// ── Lots View ─────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('lotsView', () => ({
    sortKey: 'name',
    sortDir: 'asc',

    get rows() {
      const dw = Alpine.store('dw');
      const key = this.sortKey, dir = this.sortDir;
      return [...dw.lots].sort((a, b) => {
        let av, bv;
        if      (key === 'name')      { return dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name); }
        else if (key === 'cost')      { av = a.items.reduce((s, r) => s + (r.cost||0), 0); bv = b.items.reduce((s, r) => s + (r.cost||0), 0); }
        else if (key === 'recovered') {
          av = a.items.filter(r => r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
          bv = b.items.filter(r => r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
        }
        else if (key === 'roi') {
          const cA = a.items.reduce((s,r)=>s+(r.cost||0),0);
          const rA = a.items.filter(r=>r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
          const cB = b.items.reduce((s,r)=>s+(r.cost||0),0);
          const rB = b.items.filter(r=>r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
          av = cA > 0 ? rA / cA : 0; bv = cB > 0 ? rB / cB : 0;
        }
        else if (key === 'upside') {
          const dw2 = Alpine.store('dw');
          av = a.items.filter(r=>r.status==='Listed').reduce((s,r)=>s+dw2.payout(r),0);
          bv = b.items.filter(r=>r.status==='Listed').reduce((s,r)=>s+dw2.payout(r),0);
        }
        else return 0;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ?  1 : -1;
        return 0;
      });
    },

    sortBy(key) {
      if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { this.sortKey = key; this.sortDir = 'asc'; }
    },
    sortIndicator(key) {
      if (this.sortKey !== key) return '';
      return this.sortDir === 'asc' ? ' ↑' : ' ↓';
    },

    countByStatus(lot, status) { return lot.items.filter(r => r.status === status).length; },
    totalCost(lot)      { return lot.items.reduce((s, r) => s + (r.cost || 0), 0); },
    totalRecovered(lot) { return lot.items.filter(r => r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0); },
    estUpside(lot) {
      const dw = Alpine.store('dw');
      return lot.items.filter(r => r.status !== 'Sold').reduce((s, r) => s + dw.payout(r), 0);
    },

    openLot(lot) { Alpine.store('dw').openModal('lot', null, lot.name); },
  }));
});
```

- [ ] **Step 4: Open the app and verify all three views load without console errors**

Check in browser: Dashboard stat cards show correct totals, Items view shows the items list, Lots view shows lots.

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/views/dashboard.js public/v2/js/views/items.js public/v2/js/views/lots.js
git commit -m "ref #33: update views to use new SQLite record shape"
```

---

## Task 10: Update item-modal.js and add-modal.js

**Files:**
- Modify: `public/v2/js/modals/item-modal.js`
- Modify: `public/v2/js/modals/add-modal.js`

- [ ] **Step 1: Replace item-modal.js**

```js
// ── Item Modal ────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('itemModal', () => ({
    editMode:        false,
    saving:          false,
    saveMsg:         '',
    form:            {},
    trackingInfo:    null,
    trackingLoading: false,

    init() {
      this.$watch('$store.dw.activeRecordId', () => {
        this.editMode = false; this.saveMsg = ''; this.form = {};
        this.trackingInfo = null; this.trackingLoading = false;
        this._loadTracking();
      });
      if (Alpine.store('dw').activeRecordId) this._loadTracking();
    },

    get record() {
      const dw = Alpine.store('dw');
      return dw.records.find(r => r.id === dw.activeRecordId) || null;
    },

    get isSold() { return this.record?.status === 'Sold'; },

    startEdit() {
      const r = this.record;
      if (!r) return;
      const listing = Alpine.store('dw').activeListing(r);
      this.form = {
        name:               r.name,
        status:             r.status,
        category:           r.category?.name || '',
        lot:                r.lot?.name || '',
        url:                listing?.url || '',
        platform_listing_id: listing?.platform_listing_id || '',
        list_price:         listing?.list_price ?? '',
        cost:               r.cost ?? '',
        sale:               r.order?.sale_price ?? '',
        shipping_estimate:  listing?.shipping_estimate ?? '',
        listing_id:         listing?.id || null,
      };
      this.editMode = true; this.saveMsg = '';
    },

    cancelEdit() { this.editMode = false; this.saveMsg = ''; },

    async save() {
      const dw = Alpine.store('dw');
      const f  = this.form;
      const r  = this.record;
      const itemFields = {};

      if (f.name)     itemFields.name     = f.name;
      if (f.status)   itemFields.status   = f.status;
      if (f.status === 'Sold' && !r.order?.date_sold)
        itemFields.date_sold = new Date().toISOString().split('T')[0]; // handled server-side via order
      if (f.cost !== '') itemFields.cost = parseFloat(f.cost);

      // Resolve category_id and lot_id
      if (f.category) {
        const cat = (await fetch('/api/categories').then(r=>r.json())).find(c=>c.name===f.category);
        if (cat) itemFields.category_id = cat.id;
      }
      if (f.lot !== undefined) {
        const lot = dw.lots.find(l => l.name === f.lot);
        itemFields.lot_id = lot?.id || null;
      }

      this.saving = true; this.saveMsg = '';
      try {
        await dw.updateItem(r.id, itemFields);

        // Update listing fields if listing exists
        if (f.listing_id) {
          const listingFields = {};
          if (f.url               !== undefined) listingFields.url                = f.url || null;
          if (f.platform_listing_id !== undefined) listingFields.platform_listing_id = f.platform_listing_id || null;
          if (f.list_price         !== '') listingFields.list_price        = parseFloat(f.list_price);
          if (f.shipping_estimate  !== '') listingFields.shipping_estimate = parseFloat(f.shipping_estimate);
          if (Object.keys(listingFields).length) {
            await fetch(`/api/listings/${f.listing_id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(listingFields),
            });
            await dw.fetchAll();
          }
        }

        this.saveMsg = 'saved';
        setTimeout(() => { this.editMode = false; this.saveMsg = ''; }, 900);
      } catch (e) {
        this.saveMsg = 'ERROR: ' + e.message;
      } finally {
        this.saving = false;
      }
    },

    badgeClass(status) {
      const s = (status || '').toLowerCase();
      if (s === 'listed')   return 'badge-listed';
      if (s === 'sold')     return 'badge-sold';
      if (s === 'prepping') return 'badge-prepping';
      return 'badge-other';
    },
    catBadgeClass(cat) { return CAT_BADGE[cat] || 'badge-other'; },

    async clearTracking() {
      const r = this.record;
      if (!r?.shipment?.id) return;
      await Alpine.store('dw').updateShipment(r.shipment.id, {
        tracking_id: null, tracking_number: null, tracker_url: null
      });
      this.trackingInfo = null;
    },

    async _loadTracking() {
      const r = this.record;
      if (!r?.shipment?.tracking_id) return;
      this.trackingLoading = true;
      this.trackingInfo    = await Alpine.store('dw').fetchTracker(r.shipment.tracking_id);
      this.trackingLoading = false;
    },

    get trackStatusBadgeClass() {
      const s = this.trackingInfo?.status;
      switch (s) {
        case 'delivered':        return 'badge-sold';
        case 'out_for_delivery': return 'badge-pending';
        case 'in_transit':       return 'badge-listed';
        case 'return_to_sender':
        case 'failure':          return 'badge-prepping';
        default:                 return 'badge-other';
      }
    },
    get trackStatusLabel() {
      const s = this.trackingInfo?.status;
      if (!s) return '—';
      return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },
    get trackEstDelivery() {
      const raw = this.trackingInfo?.estDelivery;
      if (!raw) return null;
      return new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
  }));
});
```

- [ ] **Step 2: Replace add-modal.js**

The form now only collects item fields. On save it transitions to the item detail view with an "Add Listing" button.

```js
// ── Add Modal ─────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('addModal', () => ({
    saving:  false,
    saveMsg: '',
    form: {
      name:     '',
      category: '',
      lot:      '',
      newLot:   '',
      cost:     '',
      notes:    '',
    },

    reset() {
      this.form    = { name: '', category: '', lot: '', newLot: '', cost: '', notes: '' };
      this.saveMsg = '';
      this.saving  = false;
    },

    async save(keepOpen = false) {
      if (!this.form.name.trim()) { this.saveMsg = 'Name is required'; return; }

      const dw   = Alpine.store('dw');
      const body = { name: this.form.name.trim() };

      if (this.form.cost !== '') body.cost = parseFloat(this.form.cost);
      if (this.form.notes)       body.notes = this.form.notes.trim() || null;

      // Resolve category_id
      if (this.form.category) {
        const cats = await fetch('/api/categories').then(r => r.json());
        const cat  = cats.find(c => c.name === this.form.category);
        if (cat) body.category_id = cat.id;
      }

      // Resolve lot_id (create new lot if needed)
      const lotName = this.form.newLot.trim() || this.form.lot;
      if (lotName) {
        let lot = dw.lots.find(l => l.name === lotName);
        if (!lot) {
          const res = await fetch('/api/lots', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: lotName }),
          });
          lot = await res.json();
          await fetch('/api/lots').then(r => r.json()).then(lots => { dw._lots = lots; });
        }
        body.lot_id = lot.id;
      }

      this.saving = true; this.saveMsg = '';
      try {
        const created = await dw.createItem(body);
        if (keepOpen) {
          const sticky = { category: this.form.category, lot: this.form.lot, newLot: this.form.newLot };
          this.reset();
          Object.assign(this.form, sticky);
          this.saveMsg = 'Saved!';
        } else {
          this.reset();
          // Transition to item detail modal for the newly created item
          dw.openModal('item', created.id);
        }
      } catch (e) {
        this.saveMsg = 'ERROR: ' + e.message;
        this.saving  = false;
      }
    },
  }));
});
```

- [ ] **Step 3: Test in browser**

Open Add Item modal. Fill in name + cost. Save. Confirm it opens the item detail modal for the new item.

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/modals/item-modal.js public/v2/js/modals/add-modal.js
git commit -m "ref #33: update item and add modals for SQLite record shape; add-modal transitions to item detail on save"
```

---

## Task 11: Update lot-modal.js and shipping-modal.js

**Files:**
- Modify: `public/v2/js/modals/lot-modal.js`
- Modify: `public/v2/js/modals/shipping-modal.js`

- [ ] **Step 1: Update field access in lot-modal.js**

The lot modal reads `r.name`, `r.status`, `r.cost`, and `r.order.sale_price` instead of `F.*` fields. Profit comes from `r.order.profit` (server-derived) for sold items, `dw.estProfit(r)` for others.

Key changes to find and replace throughout lot-modal.js:
- `dw.str(r, F.name)` → `r.name`
- `dw.str(r, F.status)` → `r.status`
- `dw.num(r, F.cost)` → `(r.cost || 0)`
- `dw.num(r, F.sale)` → `(r.order?.sale_price || 0)`
- `dw.num(r, F.listPrice)` → `(dw.activeListing(r)?.list_price || 0)`
- `dw.num(r, F.profit)` → `(r.order?.profit || 0)`
- `dw.str(r, F.status) === 'Sold'` → `r.status === 'Sold'`
- `dw.str(r, F.status) === 'Listed'` → `r.status === 'Listed'`

For the `profitValue()` method: `return r.status === 'Sold' ? (r.order?.profit || 0) : dw.estProfit(r);`

Read the full lot-modal.js, apply all substitutions, and verify no `F.` references remain:
```bash
grep -n "F\." public/v2/js/modals/lot-modal.js
```
Expected: no output (zero matches)

- [ ] **Step 2: Update field access in shipping-modal.js**

Key changes:
- `dw.str(r, F.status)` → `r.status`
- `dw.str(r, F.trackingId)` → `r.shipment?.tracking_id`
- `dw.str(r, F.name)` → `r.name`

Read the full shipping-modal.js, apply all substitutions, verify:
```bash
grep -n "F\." public/v2/js/modals/shipping-modal.js
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/modals/lot-modal.js public/v2/js/modals/shipping-modal.js
git commit -m "ref #33: update lot modal and shipping modal for SQLite record shape"
```

---

## Task 12: Update label-modal.js

The biggest modal change. `saveShipping()` used to do one Airtable PATCH with all fields. Now it calls `createOrder()` + `createShipment()` sequentially.

**Files:**
- Modify: `public/v2/js/modals/label-modal.js`

- [ ] **Step 1: Understand current saveShipping flow**

Read `public/v2/js/modals/label-modal.js` lines 170–195. Currently it:
1. Builds a flat `fields` object with shipping cost, status, dateSold, sale, tracking fields
2. Calls `dw.updateRecord(record.id, fields)`

The new flow:
1. Find the Reverb listing for this item (`r.listings.find(l => l.site.name === 'Reverb' && l.status === 'active')`)
2. If an order doesn't exist: call `dw.createOrder({ listing_id, platform_order_num, sale_price, date_sold })`
3. Then call `dw.createShipment({ order_id, tracking_id, tracking_number, tracker_url, label_url, shipping_cost })`
4. `fetchAll()` is called inside `createOrder` and `createShipment` — no manual call needed

- [ ] **Step 2: Update field access throughout label-modal.js**

Key changes:
- `dw.str(r, F.name)` → `r.name`
- `dw.str(r, F.reverbOrderNum)` → `r.order?.platform_order_num`
- `dw.str(r, F.status)` → `r.status`
- Find the active Reverb listing: `r.listings.find(l => l.site.name === 'Reverb' && l.status === 'active') || r.listings[0]`

- [ ] **Step 3: Replace saveShipping() method**

```js
async saveShipping() {
  const dw = this.$store.dw || Alpine.store('dw');
  const r  = this.record;
  if (!r) return;

  // Find the listing this order is for (prefer active Reverb listing)
  const listing = r.listings.find(l => l.site.name === 'Reverb' && l.status === 'active')
               || r.listings.find(l => l.status === 'active')
               || r.listings[0];

  if (!listing) {
    this.saveMsg = 'ERROR: no listing found for this item';
    return;
  }

  try {
    // Create order if not already present
    let orderId = r.order?.id;
    if (!orderId) {
      const order = await dw.createOrder({
        listing_id:        listing.id,
        platform_order_num: r.order?.platform_order_num || null,
        sale_price:         this.reverbSaleAmount || null,
        date_sold:          new Date().toISOString().split('T')[0],
      });
      orderId = order.id;
    }

    // Create shipment
    await dw.createShipment({
      order_id:        orderId,
      shipping_cost:   this.ratePrice,
      tracking_id:     this.purchaseResult?.trackingId     || null,
      tracking_number: this.purchaseResult?.trackingNumber || null,
      tracker_url:     this.purchaseResult?.trackerUrl     || null,
      label_url:       this.purchaseResult?.labelUrl       || null,
    });

    this.saveMsg = 'saved';
  } catch (e) {
    this.saveMsg = 'ERROR: ' + e.message;
  }
},
```

- [ ] **Step 4: Verify zero F.* references remain**

```bash
grep -n "F\." public/v2/js/modals/label-modal.js
```
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/modals/label-modal.js
git commit -m "ref #33: update label modal to use createOrder/createShipment"
```

---

## Task 13: Update reverb-modal.js

**Files:**
- Modify: `public/v2/js/modals/reverb-modal.js`

- [ ] **Step 1: Update field accesses throughout reverb-modal.js**

Key changes throughout:
- `dw.str(r, F.reverbListingId)` → `r.listings.find(l=>l.site.name==='Reverb')?.platform_listing_id || ''`
- `dw.str(r, F.reverbOrderNum)` → `r.order?.platform_order_num || ''`
- `dw.str(r, F.status) === 'Listed'` → `r.status === 'Listed'`
- `dw.str(r, F.name)` → `r.name`
- `r.fields[F.listPrice]` → `dw.activeListing(r)?.list_price`
- `dw.updateRecord(rec.id, { [F.reverbOrderNum]: ... })` → `dw.updateOrder(rec.order.id, { platform_order_num: ... })`
- `dw.updateRecord(rec.id, { [F.reverbListingId]: listingId })` → `dw.updateListing(listingId_on_db, { platform_listing_id: listingId })`
- `dw.updateRecord(rec.id, { [F.name]: ..., [F.listPrice]: ... })` → `dw.updateItem(rec.id, { name: ... })` + `dw.updateListing(listing.id, { list_price: ... })`

The "linked records" set (used to find unlinked Reverb items) changes from:
```js
new Set(dw.records.map(r => dw.str(r, F.reverbListingId)).filter(Boolean))
```
to:
```js
new Set(dw.records.flatMap(r => r.listings.map(l => l.platform_listing_id)).filter(Boolean))
```

- [ ] **Step 2: Verify zero F.* references remain**

```bash
grep -n "F\." public/v2/js/modals/reverb-modal.js
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/modals/reverb-modal.js
git commit -m "ref #33: update Reverb modal for SQLite record shape"
```

---

## Task 14: Final verification and cleanup

- [ ] **Step 1: Confirm zero F.* references in all frontend JS**

```bash
grep -rn "F\." public/v2/js/ --include="*.js"
```
Expected: no output (F. pattern no longer used anywhere)

- [ ] **Step 2: Confirm no Airtable references in server code**

```bash
grep -rn "airtable" server/ --include="*.js" -i
```
Expected: no output

- [ ] **Step 3: Test full app flow in browser**

Walk through this checklist manually:
- [ ] Dashboard loads — stat cards show correct totals
- [ ] Items view — Listed filter shows items, click opens item modal
- [ ] Item modal — read view shows name, category, lot, listing price, cost
- [ ] Item modal — edit + save works (check data persists after reload)
- [ ] Add Item — create a new item → transitions to item modal
- [ ] Lots view — shows all lots, click opens lot modal
- [ ] Lot modal — shows items, profit column shows actual profit for sold items
- [ ] Sidebar search — finds items and lots

- [ ] **Step 4: Verify SQLite data directly**

```bash
sqlite3 data/duckwerks.db "SELECT i.name, i.status, i.cost, l.name as lot FROM items i LEFT JOIN lots l ON l.id = i.lot_id ORDER BY i.created_at DESC LIMIT 10;"
```

- [ ] **Step 5: Close issue #32 (spec), reference #33 and #34 in final commit**

```bash
git add -A
git commit -m "ref #33: SQLite migration complete — all views, modals, and server routes updated"
```

- [ ] **Step 6: Ask Geoff to validate in browser before closing #33 and running validation checklist #34**
