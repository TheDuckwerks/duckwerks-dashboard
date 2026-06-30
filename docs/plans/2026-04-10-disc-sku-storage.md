# Disc SKU Storage & Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `DWG-XXX` SKUs in the local SQLite DB and display them in the item and label modals.

**Architecture:** Add a `sku TEXT` column to `items`, write it at bulk-list time, backfill existing records via a one-time script, and surface it read-only in two modals.

**Tech Stack:** Node.js, better-sqlite3, Express, Alpine.js, eBay Inventory API

---

## Files

| File | Change |
|---|---|
| `server/db.js` | Add `sku TEXT` to `CREATE TABLE IF NOT EXISTS items` |
| `server/items.js` | Add `sku: row.sku` to item response shape |
| `server/ebay-listings.js` | Pass `sku` to `dbWrite`; add to INSERT |
| `scripts/backfill-skus.js` | New — one-time backfill script |
| `public/v2/js/modals/item-modal.js` | Add `get itemSku()` getter |
| `public/v2/js/modals/label-modal.js` | Add `get itemSku()` getter |
| `public/v2/index.html` | Add SKU display to item modal and label modal headers |

---

## Task 1: Add `sku` column to `db.js` schema

**Files:**
- Modify: `server/db.js`

- [ ] **Read the items CREATE TABLE block**

  Open `server/db.js`. The items table definition looks like:

  ```sql
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
  ```

- [ ] **Add `sku TEXT` after `notes`**

  ```sql
  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    lot_id      INTEGER REFERENCES lots(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    cost        REAL NOT NULL DEFAULT 0,
    notes       TEXT,
    sku         TEXT,
    status      TEXT NOT NULL DEFAULT 'Prepping'
                     CHECK(status IN ('Prepping', 'Listed', 'Sold')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```

  > Note: `CREATE TABLE IF NOT EXISTS` won't re-add the column to an existing DB — that's handled by the backfill script's `ALTER TABLE`. This change covers fresh DB creation only.

- [ ] **Commit**

  ```bash
  git add server/db.js
  git commit -m "schema: add sku column to items table — ref #93"
  ```

---

## Task 2: Expose `sku` in item API responses

**Files:**
- Modify: `server/items.js` (around line 62)

- [ ] **Find the return shape in `buildItem`**

  The function returns:

  ```js
  return {
    id: row.id, name: row.name, cost: row.cost,
    notes: row.notes, status: row.status, created_at: row.created_at,
    category, lot, listings, order, shipment,
  };
  ```

- [ ] **Add `sku: row.sku`**

  ```js
  return {
    id: row.id, name: row.name, cost: row.cost,
    notes: row.notes, sku: row.sku, status: row.status, created_at: row.created_at,
    category, lot, listings, order, shipment,
  };
  ```

- [ ] **Confirm `sku` is NOT in the allowed patch list**

  Around line 99, verify the `allowed` array does not include `'sku'`:

  ```js
  const allowed = ['name', 'status', 'category_id', 'lot_id', 'cost', 'notes'];
  ```

  Do not add it. SKU is write-once and must not be patchable via the normal edit flow.

- [ ] **Commit**

  ```bash
  git add server/items.js
  git commit -m "api: expose sku field in item responses — ref #93"
  ```

---

## Task 3: Write SKU at bulk-list time

**Files:**
- Modify: `server/ebay-listings.js` (lines ~260 and ~317)

- [ ] **Update `dbWrite` signature to accept `sku`**

  Find the function definition around line 260:

  ```js
  function dbWrite(disc, listingId) {
  ```

  Change to:

  ```js
  function dbWrite(disc, listingId, sku) {
  ```

- [ ] **Add `sku` to the INSERT INTO items**

  Find the INSERT around line 281:

  ```js
  const item = db.prepare(
    "INSERT INTO items (name, status, category_id, cost, lot_id) VALUES (?, 'Listed', ?, 0, 9)"
  ).run(disc.title, cat.id);
  ```

  Change to:

  ```js
  const item = db.prepare(
    "INSERT INTO items (name, status, category_id, cost, lot_id, sku) VALUES (?, 'Listed', ?, 0, 9, ?)"
  ).run(disc.title, cat.id, sku || null);
  ```

- [ ] **Pass `sku` when calling `dbWrite` in the route handler**

  Find the call around line 317:

  ```js
  dbWrite(disc, listingId);
  ```

  Change to:

  ```js
  dbWrite(disc, listingId, sku);
  ```

  The `sku` variable is already computed just above this line as:
  ```js
  const sku = `DWG-${String(disc.id).padStart(3, '0')}`;
  ```

- [ ] **Commit**

  ```bash
  git add server/ebay-listings.js
  git commit -m "bulk-list: persist sku to items table on INSERT — ref #93"
  ```

---

## Task 4: Backfill script

**Files:**
- Create: `scripts/backfill-skus.js`

This script is run once on the NUC. It handles both the `ALTER TABLE` migration and the data backfill in a single command. Default is dry-run; pass `--confirm` to write.

- [ ] **Create `scripts/backfill-skus.js`**

  ```js
  #!/usr/bin/env node
  // scripts/backfill-skus.js
  // One-time script: adds sku column (if needed) and backfills SKUs from eBay Inventory API.
  //
  // Usage:
  //   node scripts/backfill-skus.js           # dry-run — shows what would be written
  //   node scripts/backfill-skus.js --confirm  # writes to DB

  const path    = require('path');
  const Database = require('better-sqlite3');
  const { getAccessToken } = require('../server/ebay-auth');

  const CONFIRM   = process.argv.includes('--confirm');
  const EBAY_API  = 'https://api.ebay.com';
  const MARKETPLACE = 'EBAY_US';
  const DB_PATH   = path.join(__dirname, '../data/duckwerks.db');

  async function main() {
    const db = new Database(DB_PATH);

    // ── 1. Ensure sku column exists ────────────────────────────────────────────
    try {
      db.exec('ALTER TABLE items ADD COLUMN sku TEXT');
      console.log('Added sku column to items table.');
    } catch (e) {
      if (e.message.includes('duplicate column name')) {
        console.log('sku column already exists — skipping ALTER TABLE.');
      } else {
        throw e;
      }
    }

    // ── 2. Fetch all offers from eBay (paginated) ──────────────────────────────
    const token = await getAccessToken();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
      'Accept-Language': 'en-US',
    };

    const offers = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const res  = await fetch(`${EBAY_API}/sell/inventory/v1/offer?limit=${limit}&offset=${offset}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`eBay offer fetch failed: ${JSON.stringify(data)}`);
      const page = data.offers || [];
      offers.push(...page);
      if (offers.length >= (data.total || 0) || page.length < limit) break;
      offset += limit;
    }

    console.log(`\neBay returned ${offers.length} offers.`);

    // ── 3. Build sku → listingId map from offers ───────────────────────────────
    // Each offer: { sku, listing: { listingId } }
    const skuToListingId = {};
    for (const offer of offers) {
      const listingId = offer.listing?.listingId;
      if (offer.sku && listingId) skuToListingId[offer.sku] = String(listingId);
    }

    // ── 4. Match to local DB and collect updates ───────────────────────────────
    const updates = [];      // { itemId, sku }
    const noLocalListing = []; // eBay SKUs with no local listing match

    for (const [sku, listingId] of Object.entries(skuToListingId)) {
      const listing = db.prepare(
        'SELECT item_id FROM listings WHERE platform_listing_id = ?'
      ).get(listingId);

      if (!listing) {
        noLocalListing.push({ sku, listingId });
        continue;
      }

      const item = db.prepare('SELECT id, sku FROM items WHERE id = ?').get(listing.item_id);
      if (!item) continue;

      if (item.sku) {
        console.log(`  skip  ${sku}  → item #${item.id} already has sku=${item.sku}`);
        continue;
      }

      updates.push({ itemId: item.id, sku });
    }

    // ── 5. Report updates ──────────────────────────────────────────────────────
    console.log(`\n── Would write ${updates.length} SKUs ─────────────────────────────`);
    for (const { itemId, sku } of updates) {
      console.log(`  item #${itemId}  ←  ${sku}`);
    }

    // ── 6. Report eBay SKUs with no local listing ──────────────────────────────
    if (noLocalListing.length) {
      console.log(`\n── eBay offers with no local listing match (${noLocalListing.length}) ─────`);
      for (const { sku, listingId } of noLocalListing) {
        console.log(`  ${sku}  listingId=${listingId}`);
      }
    }

    // ── 7. Report local DG items still without a SKU after this run ───────────
    const dgItems = db.prepare(`
      SELECT i.id, i.name FROM items i
      JOIN categories c ON i.category_id = c.id
      WHERE c.name = 'Disc Golf' AND i.sku IS NULL
    `).all();

    const willBeFixed = new Set(updates.map(u => u.itemId));
    const stillMissing = dgItems.filter(i => !willBeFixed.has(i.id));

    if (stillMissing.length) {
      console.log(`\n── Local DG items with no SKU after this run (${stillMissing.length}) ──────`);
      for (const item of stillMissing) {
        console.log(`  item #${item.id}  "${item.name}"`);
      }
    }

    // ── 8. Apply if --confirm ──────────────────────────────────────────────────
    if (!CONFIRM) {
      console.log('\nDry-run complete. Pass --confirm to write to DB.');
      return;
    }

    const updateStmt = db.prepare('UPDATE items SET sku = ? WHERE id = ? AND sku IS NULL');
    const applyAll = db.transaction(() => {
      for (const { itemId, sku } of updates) updateStmt.run(sku, itemId);
    });
    applyAll();
    console.log(`\nWrote ${updates.length} SKUs to DB.`);
  }

  main().catch(e => { console.error(e.message); process.exit(1); });
  ```

- [ ] **Dry-run test (requires server to have been started at least once to seed DB)**

  ```bash
  node scripts/backfill-skus.js
  ```

  Expected output:
  - "sku column already exists" or "Added sku column"
  - A list of `item #N ← DWG-XXX` lines
  - Any non-match reports
  - "Dry-run complete. Pass --confirm to write to DB."

  If you see an auth error, the eBay token may be expired — start the server and visit `/api/ebay/auth` to refresh.

- [ ] **Commit**

  ```bash
  git add scripts/backfill-skus.js
  git commit -m "script: backfill-skus — one-time sku backfill from eBay Inventory API — ref #93"
  ```

---

## Task 5: Display SKU in item modal

**Files:**
- Modify: `public/v2/js/modals/item-modal.js`
- Modify: `public/v2/index.html`

- [ ] **Add `get itemSku()` getter to `item-modal.js`**

  The file already has getters. Find `get isSold()` around line 28 and add after it:

  ```js
  get itemSku() { return this.record?.sku || null; },
  ```

- [ ] **Add SKU badge to item modal header in `index.html`**

  Find the item modal header around line 775. It currently reads:

  ```html
  <div class="modal-header">
    <div class="modal-title" x-text="record.name"></div>
    <button class="modal-close" @click="$store.dw.closeModal()">✕</button>
  </div>
  ```

  Change to:

  ```html
  <div class="modal-header">
    <div>
      <div class="modal-title" x-text="record.name"></div>
      <div x-show="itemSku" style="font-size:11px;color:var(--muted);letter-spacing:1px;margin-top:2px" x-text="itemSku"></div>
    </div>
    <button class="modal-close" @click="$store.dw.closeModal()">✕</button>
  </div>
  ```

- [ ] **Verify manually**

  Start the server (`npm start`), open the item modal for a disc golf item. Confirm SKU appears beneath the name. For non-DG items, confirm nothing extra renders.

- [ ] **Commit**

  ```bash
  git add public/v2/js/modals/item-modal.js public/v2/index.html
  git commit -m "item-modal: show SKU beneath item name (read-only) — ref #93"
  ```

---

## Task 6: Display SKU in label modal

**Files:**
- Modify: `public/v2/js/modals/label-modal.js`
- Modify: `public/v2/index.html`

- [ ] **Add `get itemSku()` getter to `label-modal.js`**

  The file has `get itemName()` at line 132:

  ```js
  get itemName() {
    return this.record ? this.record.name || 'n/a' : 'n/a';
  },
  ```

  Add `get itemSku()` immediately after:

  ```js
  get itemSku() { return this.record?.sku || null; },
  ```

- [ ] **Add SKU to label modal header in `index.html`**

  Find the label modal header around line 1410. It currently reads:

  ```html
  <div class="modal-header">
    <div class="modal-title" x-text="itemName"></div>
    <button class="modal-close" @click="$store.dw.closeModal()">✕</button>
  </div>
  ```

  Change to:

  ```html
  <div class="modal-header">
    <div>
      <div class="modal-title" x-text="itemName"></div>
      <div x-show="itemSku" style="font-size:11px;color:var(--muted);letter-spacing:1px;margin-top:2px" x-text="itemSku"></div>
    </div>
    <button class="modal-close" @click="$store.dw.closeModal()">✕</button>
  </div>
  ```

- [ ] **Verify manually**

  Open the label modal for a sold disc golf item. Confirm SKU appears beneath the item name. Open for a non-DG item — confirm nothing extra renders.

- [ ] **Commit**

  ```bash
  git add public/v2/js/modals/label-modal.js public/v2/index.html
  git commit -m "label-modal: show SKU for grab-from-shelf context — ref #93"
  ```

---

## Task 7: Version bump & push

- [ ] **Bump patch version**

  In `public/v2/js/config.js`, increment `APP_VERSION` patch digit.
  In `package.json`, increment `version` patch digit to match.

- [ ] **Commit and push**

  ```bash
  git add public/v2/js/config.js package.json
  git commit -m "bump version — ref #93"
  git push
  ```

---

## Post-implementation: Run backfill on NUC

After deploying (pushing + restarting on the NUC):

```bash
# Dry-run first — review output carefully
node scripts/backfill-skus.js

# If output looks right:
node scripts/backfill-skus.js --confirm
```

Check the two non-match reports. Anything in "eBay offers with no local listing" or "Local DG items with no SKU after this run" warrants manual investigation.
