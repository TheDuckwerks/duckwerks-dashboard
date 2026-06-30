# eBay Inventory API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture eBay Inventory API SKU and offer ID on every eBay listing in the DB — via migration on import and a bulk backfill script — so the Browse API can be replaced in spec 2.

**Architecture:** Two new columns on `listings` (`sku`, `offer_id`), two new server routes in `server/ebay.js`, a one-line change to `importAll` in `sites.js`, and a bulk script that runs two sequential passes through the local API. No token management outside `server/ebay.js`.

**Tech Stack:** SQLite (better-sqlite3), Express, Alpine.js, eBay Sell Inventory API v1 — OAS3 spec at `sell_inventory_v1_oas3.json`.

---

## File Map

**Modified:**
- `server/db.js` — schema migration for `sku` and `offer_id` columns on `listings`
- `server/ebay.js` — two new routes: `POST /api/ebay/migrate-listing`, `GET /api/ebay/offer`
- `server/listings.js` — accept `sku` and `offer_id` in POST body and PATCH allowed fields
- `public/v2/js/views/sites.js` — call migrate-listing before createListing for eBay imports

**Created:**
- `scripts/migrate-to-inventory-api.js` — bulk backfill script, two passes, dry-run/confirm

---

## Task 1: Schema migration — add sku and offer_id to listings

**Files:**
- Modify: `server/db.js`

- [ ] **Step 1: Read `server/db.js` to find where existing migrations run**

Look for the pattern used to add columns to `items` (quantity/quantity_sold/oversold) — it uses `PRAGMA table_info` to check for column existence before running ALTER TABLE.

- [ ] **Step 2: Add migration block for listings columns**

Find the existing migrations block and add after it:

```js
// Inventory API migration — sku and offer_id on listings
['sku', 'offer_id'].forEach(col => {
  const cols = db.pragma('table_info(listings)').map(r => r.name);
  if (!cols.includes(col)) {
    db.prepare(`ALTER TABLE listings ADD COLUMN ${col} TEXT`).run();
  }
});
```

- [ ] **Step 3: Restart server and verify columns exist**

```bash
npm start &
sleep 2
sqlite3 data/duckwerks.db "PRAGMA table_info(listings);" | grep -E "sku|offer_id"
```

Expected — two rows:
```
...|sku|TEXT|0||0
...|offer_id|TEXT|0||0
```

- [ ] **Step 4: Kill dev server, commit**

```bash
kill %1
git add server/db.js
git commit -m "feat: add sku and offer_id columns to listings"
```

---

## Task 2: Server — listings API accepts sku and offer_id

**Files:**
- Modify: `server/listings.js`

- [ ] **Step 1: Read `server/listings.js` to find POST handler and PATCH allowed list**

The POST handler destructures `req.body` and runs an INSERT. The PATCH handler has an `allowed` array.

- [ ] **Step 2: Update POST handler to accept sku and offer_id**

Find:
```js
const { item_id, site_id, platform_listing_id, list_price, shipping_estimate, url } = req.body;
...
INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url)
VALUES (?, ?, ?, ?, ?, ?)
`).run(item_id, site_id, platform_listing_id || null, list_price || null, shipping_estimate || null, url || null);
```

Change to:
```js
const { item_id, site_id, platform_listing_id, list_price, shipping_estimate, url, sku, offer_id } = req.body;
...
INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url, sku, offer_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(item_id, site_id, platform_listing_id || null, list_price || null, shipping_estimate || null, url || null, sku || null, offer_id || null);
```

- [ ] **Step 3: Add sku and offer_id to PATCH allowed list**

Find:
```js
const allowed = ['site_id', 'platform_listing_id', 'list_price', 'shipping_estimate', 'url', 'status', 'ended_at'];
```

Change to:
```js
const allowed = ['site_id', 'platform_listing_id', 'list_price', 'shipping_estimate', 'url', 'status', 'ended_at', 'sku', 'offer_id'];
```

- [ ] **Step 4: Verify with curl**

```bash
npm start &
sleep 2
# Create a test listing (use a real item id from your DB)
ITEM_ID=$(sqlite3 data/duckwerks.db "SELECT id FROM items LIMIT 1;")
SITE_ID=$(sqlite3 data/duckwerks.db "SELECT id FROM sites WHERE name='eBay' LIMIT 1;")
curl -s -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -d "{\"item_id\":$ITEM_ID,\"site_id\":$SITE_ID,\"sku\":\"TEST-SKU\",\"offer_id\":\"TEST-OFFER\"}" \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('id:', d.id)"
# Then verify it was stored
sqlite3 data/duckwerks.db "SELECT id, sku, offer_id FROM listings ORDER BY id DESC LIMIT 1;"
```

Expected: `sku = TEST-SKU`, `offer_id = TEST-OFFER`

- [ ] **Step 5: Clean up test listing, kill dev server, commit**

```bash
LISTING_ID=$(sqlite3 data/duckwerks.db "SELECT id FROM listings ORDER BY id DESC LIMIT 1;")
sqlite3 data/duckwerks.db "DELETE FROM listings WHERE id = $LISTING_ID;"
kill %1
git add server/listings.js
git commit -m "feat: accept sku and offer_id in listings API"
```

---

## Task 3: Server — POST /api/ebay/migrate-listing route

**Files:**
- Modify: `server/ebay.js`

- [ ] **Step 1: Read the end of `server/ebay.js`** to find where to add the new route (after the existing GET /listings route).

- [ ] **Step 2: Add the migrate-listing route**

Add after the existing routes in `server/ebay.js`:

```js
// POST /api/ebay/migrate-listing — migrate up to 5 legacy listings to Inventory API model
router.post('/migrate-listing', async (req, res) => {
  const { listingIds } = req.body;
  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return res.status(400).json({ error: 'listingIds array required' });
  }
  if (listingIds.length > 5) {
    return res.status(400).json({ error: 'maximum 5 listingIds per request' });
  }
  try {
    const token = await getAccessToken();
    const response = await fetch(`${EBAY_API}/sell/inventory/v1/bulk_migrate_listing`, {
      method: 'POST',
      headers: {
        'Authorization':           `Bearer ${token}`,
        'Content-Type':            'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
      body: JSON.stringify({
        requests: listingIds.map(id => ({ listingId: String(id) })),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: 'eBay migrate error', detail: text });
    }
    const data = await response.json();
    const results = (data.responses || []).map(r => ({
      listingId: r.listingId,
      sku:       r.inventoryItemGroupKey || r.sku || null,
      offerId:   r.offerId || null,
      error:     r.errors?.[0]?.message || null,
    }));
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: 'migrate-listing failed', detail: e.message });
  }
});
```

- [ ] **Step 3: Start server and smoke test with curl**

```bash
npm start &
sleep 2
# Use the towel listing ID (already migrated won't error, just returns existing sku/offerId)
curl -s -X POST http://localhost:3000/api/ebay/migrate-listing \
  -H "Content-Type: application/json" \
  -d '{"listingIds":["168349612758"]}' | node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')), null, 2))"
```

Expected: array with one object containing `listingId`, `sku`, `offerId` (or `error` if already migrated).

- [ ] **Step 4: Kill dev server, commit**

```bash
kill %1
git add server/ebay.js
git commit -m "feat: POST /api/ebay/migrate-listing route"
```

---

## Task 4: Server — GET /api/ebay/offer route

**Files:**
- Modify: `server/ebay.js`

- [ ] **Step 1: Add the offer lookup route**

Add after the migrate-listing route:

```js
// GET /api/ebay/offer?sku={sku} — fetch offer ID for a given inventory SKU
router.get('/offer', async (req, res) => {
  const { sku } = req.query;
  if (!sku) return res.status(400).json({ error: 'sku query param required' });
  try {
    const token = await getAccessToken();
    const response = await fetch(
      `${EBAY_API}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_US`,
      {
        headers: {
          'Authorization':           `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
      }
    );
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: 'eBay offer lookup error', detail: text });
    }
    const data = await response.json();
    const offer = (data.offers || [])[0];
    res.json({ offerId: offer?.offerId || null });
  } catch (e) {
    res.status(502).json({ error: 'offer lookup failed', detail: e.message });
  }
});
```

- [ ] **Step 2: Smoke test with a known DG disc SKU**

```bash
npm start &
sleep 2
# Find a DG disc SKU from items table
SKU=$(sqlite3 data/duckwerks.db "SELECT sku FROM items WHERE sku IS NOT NULL LIMIT 1;")
echo "Testing SKU: $SKU"
curl -s "http://localhost:3000/api/ebay/offer?sku=$SKU" | node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')), null, 2))"
```

Expected: `{ "offerId": "4**********" }` or `{ "offerId": null }` if not found.

- [ ] **Step 3: Kill dev server, commit**

```bash
kill %1
git add server/ebay.js
git commit -m "feat: GET /api/ebay/offer route for offer ID lookup by SKU"
```

---

## Task 5: Frontend — migrate-listing on import

**Files:**
- Modify: `public/v2/js/views/sites.js`

- [ ] **Step 1: Read the `importAll` method in `sites.js`** (lines ~201-252). Find the block that builds `listingFields` and calls `dw.createListing(listingFields)` for eBay listings.

- [ ] **Step 2: Add migration call before createListing for eBay listings**

Find this block inside the `for (const listing of toImport)` loop:

```js
const itemFields = { name: listing.title, cost: 0 };
if (categoryId) itemFields.category_id = categoryId;
if (lotId)      itemFields.lot_id       = lotId;
if (listing.quantityAvailable > 1) itemFields.quantity = listing.quantityAvailable;
const item = await dw.createItem(itemFields);
const listingFields = {
  item_id:             item.id,
  site_id:             site.id,
  list_price:          listing.price,
  platform_listing_id: listing.listingIdKey,
};
if (listing.platform === 'eBay') {
  listingFields.url = `https://www.ebay.com/itm/${listing.listingIdKey}`;
} else {
```

Add the migration call after building `listingFields.url`:

```js
const itemFields = { name: listing.title, cost: 0 };
if (categoryId) itemFields.category_id = categoryId;
if (lotId)      itemFields.lot_id       = lotId;
if (listing.quantityAvailable > 1) itemFields.quantity = listing.quantityAvailable;
const item = await dw.createItem(itemFields);
const listingFields = {
  item_id:             item.id,
  site_id:             site.id,
  list_price:          listing.price,
  platform_listing_id: listing.listingIdKey,
};
if (listing.platform === 'eBay') {
  listingFields.url = `https://www.ebay.com/itm/${listing.listingIdKey}`;
  try {
    const migrateRes = await fetch('/api/ebay/migrate-listing', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ listingIds: [listing.listingIdKey] }),
    });
    if (migrateRes.ok) {
      const [result] = await migrateRes.json();
      if (result?.sku)     listingFields.sku      = result.sku;
      if (result?.offerId) listingFields.offer_id = result.offerId;
    }
  } catch (e) {
    console.warn('migrate-listing failed for', listing.listingIdKey, e.message);
  }
} else {
```

- [ ] **Step 3: Verify in browser**

Start the server, go to SITES, delete the towel item (ID 482), sync listings, and import the towel again. Then check:

```bash
sqlite3 data/duckwerks.db "SELECT id, platform_listing_id, sku, offer_id FROM listings WHERE platform_listing_id = '168349612758';"
```

Expected: `sku` and `offer_id` are populated (not NULL).

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/views/sites.js
git commit -m "feat: migrate eBay listing to Inventory API on import"
```

---

## Task 6: Bulk migration script

**Files:**
- Create: `scripts/migrate-to-inventory-api.js`

- [ ] **Step 1: Create the script**

```js
#!/usr/bin/env node
// Migrates existing eBay listings to Inventory API model.
// Pass 1: listings with no SKU → bulk_migrate_listing → write sku + offer_id
// Pass 2: listings with SKU but no offer_id → GET /offer → write offer_id
// Default: dry run. Pass --confirm to apply changes.

const Database = require('better-sqlite3');
const path     = require('path');

const CONFIRM  = process.argv.includes('--confirm');
const BASE_URL = process.env.BASE_URL || 'http://fedora.local:3000';
const DB_PATH  = path.join(__dirname, '../data/duckwerks.db');

const db = new Database(DB_PATH);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pass1() {
  console.log('\n=== Pass 1: migrate listings with no SKU ===');
  const rows = db.prepare(
    `SELECT l.id, l.platform_listing_id
     FROM listings l
     JOIN sites s ON s.id = l.site_id
     WHERE s.name = 'eBay'
       AND l.platform_listing_id IS NOT NULL
       AND l.sku IS NULL`
  ).all();

  if (!rows.length) { console.log('Nothing to migrate.'); return; }
  console.log(`Found ${rows.length} listing(s) to migrate.`);

  const chunks = chunk(rows, 5);
  let migrated = 0, errors = 0;

  for (const batch of chunks) {
    const listingIds = batch.map(r => r.platform_listing_id);
    const res = await fetch(`${BASE_URL}/api/ebay/migrate-listing`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ listingIds }),
    });
    if (!res.ok) {
      console.error(`  batch failed HTTP ${res.status}:`, await res.text());
      errors += batch.length;
      continue;
    }
    const results = await res.json();
    for (const result of results) {
      const row = batch.find(r => r.platform_listing_id === result.listingId);
      if (!row) continue;
      if (result.error) {
        console.log(`  SKIP  listing ${result.listingId}: ${result.error}`);
        errors++;
      } else {
        console.log(`  ${CONFIRM ? 'WRITE' : 'DRY'} listing ${result.listingId} → sku=${result.sku} offer_id=${result.offerId}`);
        if (CONFIRM) {
          db.prepare('UPDATE listings SET sku = ?, offer_id = ? WHERE id = ?')
            .run(result.sku, result.offerId, row.id);
        }
        migrated++;
      }
    }
  }
  console.log(`Pass 1 complete: ${migrated} migrated, ${errors} errors.`);
}

async function pass2() {
  console.log('\n=== Pass 2: backfill offer_id for listings with SKU but no offer_id ===');
  const rows = db.prepare(
    `SELECT l.id, l.sku
     FROM listings l
     JOIN sites s ON s.id = l.site_id
     WHERE s.name = 'eBay'
       AND l.sku IS NOT NULL
       AND l.offer_id IS NULL`
  ).all();

  if (!rows.length) { console.log('Nothing to backfill.'); return; }
  console.log(`Found ${rows.length} listing(s) to backfill.`);

  let filled = 0, missing = 0, errors = 0;

  for (const row of rows) {
    const res = await fetch(`${BASE_URL}/api/ebay/offer?sku=${encodeURIComponent(row.sku)}`);
    if (!res.ok) {
      console.error(`  ERROR sku=${row.sku} HTTP ${res.status}`);
      errors++;
      continue;
    }
    const { offerId } = await res.json();
    if (!offerId) {
      console.log(`  MISS  sku=${row.sku} → no offer found`);
      missing++;
    } else {
      console.log(`  ${CONFIRM ? 'WRITE' : 'DRY'} sku=${row.sku} → offer_id=${offerId}`);
      if (CONFIRM) {
        db.prepare('UPDATE listings SET offer_id = ? WHERE id = ?').run(offerId, row.id);
      }
      filled++;
    }
  }
  console.log(`Pass 2 complete: ${filled} filled, ${missing} not found, ${errors} errors.`);
}

async function main() {
  console.log(`Mode: ${CONFIRM ? 'CONFIRM (writing changes)' : 'DRY RUN (no changes written)'}`);
  console.log(`Server: ${BASE_URL}`);
  await pass1();
  await pass2();
  console.log('\nDone.');
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry run**

```bash
npm start &
sleep 2
node scripts/migrate-to-inventory-api.js
```

Expected output:
```
Mode: DRY RUN (no changes written)
Server: http://fedora.local:3000

=== Pass 1: migrate listings with no SKU ===
Found N listing(s) to migrate.
  DRY  listing 168347256666 → sku=ebay-abc123 offer_id=4**********
  ...
Pass 1 complete: N migrated, 0 errors.

=== Pass 2: backfill offer_id for listings with SKU but no offer_id ===
Found N listing(s) to backfill.
  DRY  sku=DG-INNOVA-WRAITH-STAR-175-ORG → offer_id=4**********
  ...
Pass 2 complete: N filled, 0 not found, 0 errors.
```

- [ ] **Step 3: Review dry-run output, then confirm**

```bash
node scripts/migrate-to-inventory-api.js --confirm
```

- [ ] **Step 4: Verify DB state**

```bash
sqlite3 data/duckwerks.db "SELECT COUNT(*) FROM listings WHERE sku IS NULL AND platform_listing_id IS NOT NULL;"
```

Expected: 0 (all eBay listings now have SKUs, or were ineligible and logged as errors)

```bash
sqlite3 data/duckwerks.db "SELECT COUNT(*) FROM listings l JOIN sites s ON s.id=l.site_id WHERE s.name='eBay' AND l.offer_id IS NULL;"
```

Expected: 0 or close to 0 (any remaining are ineligible listings)

- [ ] **Step 5: Kill dev server, commit**

```bash
kill %1
git add scripts/migrate-to-inventory-api.js
git commit -m "feat: bulk migration script for eBay Inventory API (pass 1 + pass 2)"
```

---

## Task 7: Deploy and run migration on production

- [ ] **Step 1: Push and deploy**

```bash
git push origin main
bash scripts/deploy-nuc.sh
```

- [ ] **Step 2: Run dry-run on NUC**

```bash
ssh geoff@fedora.local "cd ~/projects/duckwerksdash && node scripts/migrate-to-inventory-api.js"
```

Review output — confirm pass 1 and pass 2 counts look right against your known inventory.

- [ ] **Step 3: Run with --confirm on NUC**

```bash
ssh geoff@fedora.local "cd ~/projects/duckwerksdash && node scripts/migrate-to-inventory-api.js --confirm"
```

- [ ] **Step 4: Verify on NUC**

```bash
ssh geoff@fedora.local "sqlite3 ~/projects/duckwerksdash/data/duckwerks.db \"SELECT COUNT(*) as total, COUNT(sku) as with_sku, COUNT(offer_id) as with_offer_id FROM listings l JOIN sites s ON s.id=l.site_id WHERE s.name='eBay';\""
```

Expected: `total`, `with_sku`, and `with_offer_id` should all match (or be close — any gap is ineligible listings).

- [ ] **Step 5: Bump version and close out**

```bash
# Bump APP_VERSION in public/v2/js/config.js and version in package.json
git add public/v2/js/config.js package.json
git commit -m "chore: bump version post inventory API migration"
git push origin main
bash scripts/deploy-nuc.sh
```

---

## Self-Review Notes

- Task 3 Step 2: The eBay `bulk_migrate_listing` response shape uses `responses[]` — each entry may use `inventoryItemGroupKey` or `sku` depending on whether the listing is a variation group or single item. The route maps both. If eBay returns a different field name, check the OAS3 spec at `sell_inventory_v1_oas3.json` → `BulkMigrateListingResponse`.
- Task 5: The migration call is inside a try/catch so import never fails due to a migration error. This is intentional — a listing that eBay refuses to migrate (e.g. auction format, Motors category) still gets imported locally.
- Task 6: The script hits `http://fedora.local:3000` by default (production server on NUC). Set `BASE_URL=http://localhost:3000` if running against a local dev server.
- Pass 2 rate: ~220 DG disc listings → 220 sequential GET calls. eBay's Sell Inventory API allows 5,000 calls/day per user token — well within limit. No throttling needed.
