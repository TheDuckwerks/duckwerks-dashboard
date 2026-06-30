# eBay Bulk Listing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI script + server route that bulk-lists disc golf inventory on eBay from a CSV, writing results back to the CSV, with full idempotency.

**Architecture:** A Node CLI script (`scripts/bulk-list-discs.js`) reads a CSV, filters by disc ID range, validates each disc, and POSTs one disc at a time (multipart, with photos) to a new server route (`POST /api/ebay/bulk-list`). The server handles eBay Inventory API calls (inventory item → offer → publish), saves photos to `public/dg-photos/`, writes items+listings to DB, and returns the eBay listing URL. The script writes `eBay Listing ID` and `eBay URL` columns back to the CSV after each success.

**Tech Stack:** Node 22 (native fetch + FormData), multer (multipart), csv-parse/sync, better-sqlite3, eBay Sell Inventory v1 + Account v1 APIs

---

## File Structure

**Create:**
- `server/ebay-listings.js` — `POST /api/ebay/bulk-list` route: save photos, eBay API calls, DB writes
- `scripts/bulk-list-discs.js` — CLI: parse CSV, validate, per-disc request, write back URLs
- `public/dg-photos/.gitkeep` — ensures dir is tracked without committing photos

**Modify:**
- `package.json` — add `multer`, `csv-parse`
- `server.js` — serve `public/dg-photos/` statically, mount `server/ebay-listings.js` at `/api/ebay`
- `.gitignore` — ignore `public/dg-photos/*.jpg`

---

## Task 1: Dependencies, directories, static route, server mount

**Files:**
- Modify: `package.json`
- Modify: `server.js` (lines 8–9 for static, line 32 area for mount)
- Modify: `.gitignore`
- Create: `public/dg-photos/.gitkeep`
- Create: `server/ebay-listings.js` (skeleton only — full implementation in Task 2)

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/geoff/projects/duckwerks-dashboard
npm install multer csv-parse
```

Expected: both added to `node_modules/` and `package.json` dependencies.

- [ ] **Step 2: Create photos directory**

Create `public/dg-photos/.gitkeep` (empty file so git tracks the directory).

- [ ] **Step 3: Add to `.gitignore`**

Append `public/dg-photos/*.jpg` to `.gitignore`.

- [ ] **Step 4: Add static route + router mount to `server.js`**

After line 9 (`app.use('/v2', ...)`), add:
```js
app.use('/dg-photos', express.static(path.join(__dirname, 'public/dg-photos')));
```

After line 32 (`app.use('/api/ebay', require('./server/ebay'));`), add:
```js
app.use('/api/ebay', require('./server/ebay-listings'));
```

- [ ] **Step 5: Create skeleton `server/ebay-listings.js`**

```js
// server/ebay-listings.js — POST /api/ebay/bulk-list
const express = require('express');
const router  = express.Router();
const multer  = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/bulk-list', upload.any(), async (req, res) => {
  res.json({ ok: true, message: 'bulk-list stub' });
});

module.exports = router;
```

- [ ] **Step 6: Verify server starts**

```bash
npm start
```

Expected: `Duckwerks running at http://localhost:3000` — no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server.js .gitignore server/ebay-listings.js public/dg-photos/.gitkeep
git commit -m "ref: add multer/csv-parse, wire /api/ebay/bulk-list skeleton + dg-photos static route"
```

---

## Task 2: `server/ebay-listings.js` — Full implementation

**Files:**
- Modify: `server/ebay-listings.js` (replace stub with full implementation)

The route flow per disc: fetch business policies (cached) → save photos → PUT inventory item → POST offer → POST publish → DB writes → return `{ discId, sku, listingId, url }`.

- [ ] **Step 1: Replace `server/ebay-listings.js` with full implementation**

```js
// server/ebay-listings.js — POST /api/ebay/bulk-list
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const { getAccessToken } = require('./ebay-auth');

const EBAY_API    = 'https://api.ebay.com';
const PHOTOS_DIR  = path.join(__dirname, '..', 'public', 'dg-photos');
const PHOTOS_BASE = 'https://dash.duckwerks.com/dg-photos';
const DG_CATEGORY = '26441'; // eBay disc golf category — verify on first dry-run
const MARKETPLACE = 'EBAY_US';

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

async function ebayHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    'Accept-Language': 'en-US',
  };
}

async function fetchPolicies(headers) {
  const [fp, rp, pp] = await Promise.all([
    fetch(`${EBAY_API}/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`, { headers }).then(r => r.json()),
    fetch(`${EBAY_API}/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`, { headers }).then(r => r.json()),
    fetch(`${EBAY_API}/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`, { headers }).then(r => r.json()),
  ]);
  const fulfillmentPolicyId = fp.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
  const returnPolicyId      = rp.returnPolicies?.[0]?.returnPolicyId;
  const paymentPolicyId     = pp.paymentPolicies?.[0]?.paymentPolicyId;
  if (!fulfillmentPolicyId || !returnPolicyId || !paymentPolicyId) {
    throw new Error('No eBay business policies found. Enable them at Seller Hub > Account > Business policies.');
  }
  return { fulfillmentPolicyId, returnPolicyId, paymentPolicyId };
}

function buildDescription(disc) {
  const lines = [];
  if (disc.manufacturer) lines.push(`Brand: ${disc.manufacturer}`);
  if (disc.mold)         lines.push(`Mold: ${disc.mold}`);
  if (disc.type)         lines.push(`Type: ${disc.type}`);
  if (disc.plastic)      lines.push(`Plastic: ${disc.plastic}`);
  if (disc.run)          lines.push(`Run/Edition: ${disc.run}`);
  if (disc.weight)       lines.push(`Weight: ${disc.weight}g`);
  if (disc.notes)        lines.push(`\nNotes: ${disc.notes}`);
  return lines.join('\n');
}

function savePhotos(files) {
  const urls = [];
  for (const file of files) {
    const dest = path.join(PHOTOS_DIR, file.originalname);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, file.buffer);
    urls.push(`${PHOTOS_BASE}/${file.originalname}`);
  }
  return urls;
}

async function putInventoryItem(sku, disc, photoUrls, headers) {
  const condition = disc.condition === 'Unthrown' ? 'NEW' : 'USED';
  const body = {
    product: {
      title:       disc.title.slice(0, 80),
      description: buildDescription(disc),
      imageUrls:   photoUrls,
      aspects: {
        ...(disc.manufacturer && { Brand:          [disc.manufacturer] }),
        ...(disc.mold         && { Model:          [disc.mold] }),
        ...(disc.plastic      && { 'Plastic Type': [disc.plastic] }),
        ...(disc.weight       && { Weight:         [`${disc.weight}g`] }),
      },
    },
    condition,
    availability: { shipToLocationAvailability: { quantity: 1 } },
  };
  const res = await fetch(
    `${EBAY_API}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (res.status !== 200 && res.status !== 204) {
    const text = await res.text();
    throw new Error(`inventory_item PUT ${res.status}: ${text}`);
  }
}

async function createOffer(sku, disc, policies, headers) {
  const body = {
    sku,
    marketplaceId:      MARKETPLACE,
    format:             'FIXED_PRICE',
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      returnPolicyId:      policies.returnPolicyId,
      paymentPolicyId:     policies.paymentPolicyId,
    },
    pricingSummary: {
      price: { value: String(disc.listPrice), currency: 'USD' },
    },
    categoryId:         DG_CATEGORY,
    listingDescription: buildDescription(disc),
  };
  const res  = await fetch(`${EBAY_API}/sell/inventory/v1/offer`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`offer POST ${res.status}: ${JSON.stringify(data)}`);
  return data.offerId;
}

async function publishOffer(offerId, headers) {
  const res  = await fetch(`${EBAY_API}/sell/inventory/v1/offer/${offerId}/publish`, {
    method: 'POST', headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`offer publish ${res.status}: ${JSON.stringify(data)}`);
  return data.listingId;
}

function dbWrite(disc, listingId) {
  // Idempotent: skip if platform_listing_id already exists (handles crash-before-CSV-write)
  const existing = db.prepare(
    "SELECT id FROM listings WHERE platform_listing_id = ?"
  ).get(String(listingId));
  if (existing) return;

  // Ensure Disc Golf category exists
  let cat = db.prepare("SELECT id FROM categories WHERE name = 'Disc Golf'").get();
  if (!cat) {
    const r = db.prepare(
      "INSERT INTO categories (name, color, badge_class) VALUES ('Disc Golf', '#4ade80', 'badge-green')"
    ).run();
    cat = { id: r.lastInsertRowid };
  }

  const ebaySite = db.prepare("SELECT id FROM sites WHERE name = 'eBay'").get();
  if (!ebaySite) throw new Error('eBay site not found in DB — run server once to seed');

  const item = db.prepare(
    "INSERT INTO items (name, status, category_id, cost) VALUES (?, 'Listed', ?, 0)"
  ).run(disc.title, cat.id);

  db.prepare(
    "INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, url) VALUES (?, ?, ?, ?, ?)"
  ).run(item.lastInsertRowid, ebaySite.id, String(listingId), disc.listPrice, `https://ebay.com/itm/${listingId}`);
}

router.post('/bulk-list', upload.any(), async (req, res) => {
  let disc;
  try {
    disc = JSON.parse(req.body.disc);
  } catch {
    return res.status(400).json({ error: 'Invalid disc JSON in request body' });
  }

  try {
    const headers   = await ebayHeaders();
    const policies  = await fetchPolicies(headers);
    const sku       = `DWG-${String(disc.id).padStart(3, '0')}`;
    const photoUrls = savePhotos(req.files || []);

    await putInventoryItem(sku, disc, photoUrls, headers);
    const offerId   = await createOffer(sku, disc, policies, headers);
    const listingId = await publishOffer(offerId, headers);

    dbWrite(disc, listingId);

    res.json({ discId: disc.id, sku, listingId, url: `https://ebay.com/itm/${listingId}` });
  } catch (e) {
    // Return error per-disc — script logs and continues
    res.json({ discId: disc?.id, error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify server starts cleanly**

```bash
npm start
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/ebay-listings.js
git commit -m "ref: implement POST /api/ebay/bulk-list — inventory, offer, publish, DB writes"
```

---

## Task 3: `scripts/bulk-list-discs.js`

**Files:**
- Create: `scripts/bulk-list-discs.js`

**Expected CSV columns** (case-sensitive):
`Disc ID`, `List Title`, `List Price`, `Condition`, `Manufacturer`, `Mold`, `Type`, `Plastic`, `Run/Edition`, `Weight (g)`, `Notes`, `eBay Listing ID`, `eBay URL`

The `eBay Listing ID` and `eBay URL` columns will be added by the script if absent.

- [ ] **Step 1: Create `scripts/bulk-list-discs.js`**

```js
#!/usr/bin/env node
// scripts/bulk-list-discs.js — eBay bulk listing from CSV
// Usage: node scripts/bulk-list-discs.js --csv <path> --photos <dir> --ids <start-end> [--api <url>] [--dry-run]

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const csvPath   = arg('--csv');
const photosDir = arg('--photos');
const idsArg    = arg('--ids');
const apiBase   = arg('--api') || 'http://localhost:3000';
const dryRun    = process.argv.includes('--dry-run');

if (!csvPath || !photosDir || !idsArg) {
  console.error('Usage: node scripts/bulk-list-discs.js --csv <path> --photos <dir> --ids <start>-<end> [--api <url>] [--dry-run]');
  process.exit(1);
}

const [startId, endId] = idsArg.split('-').map(Number);
if (isNaN(startId) || isNaN(endId) || startId > endId) {
  console.error(`Invalid --ids: "${idsArg}" — use format 1-20`);
  process.exit(1);
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function serializeCSV(headers, rows) {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map(r => headers.map(h => csvEscape(r[h] ?? '')).join(',')),
  ].join('\n') + '\n';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });

  if (records.length === 0) {
    console.error('CSV has no rows.');
    process.exit(1);
  }

  const headers = Object.keys(records[0]);
  if (!headers.includes('eBay Listing ID')) headers.push('eBay Listing ID');
  if (!headers.includes('eBay URL'))        headers.push('eBay URL');

  // Filter to the requested ID range
  const rangeRows = records.filter(r => {
    const id = parseInt(r['Disc ID'], 10);
    return id >= startId && id <= endId;
  });

  if (rangeRows.length === 0) {
    console.error(`No rows found with Disc ID ${startId}–${endId}. Check the 'Disc ID' column.`);
    process.exit(1);
  }

  // Build per-disc plan: validate + collect photos
  const plan = rangeRows.map(row => {
    const id       = parseInt(row['Disc ID'], 10);
    const paddedId = String(id).padStart(3, '0');
    const title    = (row['List Title'] || '').trim();
    const price    = parseFloat(row['List Price']);
    const ebayUrl  = (row['eBay URL'] || '').trim();

    if (ebayUrl) return { id, paddedId, row, title, skip: 'already listed' };

    const warnings = [];
    if (!title)                       warnings.push('no List Title');
    if (!row['List Price'] || isNaN(price) || price <= 0) warnings.push('no List Price');

    const photoPattern = new RegExp(`^DWG-${paddedId}-.*\\.jpg$`, 'i');
    const photoFiles   = fs.readdirSync(photosDir).filter(f => photoPattern.test(f));
    if (photoFiles.length === 0) warnings.push('no photos');

    return { id, paddedId, row, title, price, photoFiles, warnings: warnings.length ? warnings : null };
  });

  const total = plan.length;

  // ── Dry run ───────────────────────────────────────────────────────────────

  if (dryRun) {
    console.log(`\nDRY RUN — no listings will be created (target: ${apiBase})\n`);
    let wouldList = 0, wouldSkip = 0;
    plan.forEach((p, i) => {
      const label = `[${i + 1}/${total}] DWG-${p.paddedId || String(p.id).padStart(3, '0')}`;
      const t     = (p.title || '').slice(0, 42).padEnd(42);
      if (p.skip) {
        console.log(`${label}  ${t}  skipped — ${p.skip}`);
        wouldSkip++;
      } else if (p.warnings) {
        console.log(`${label}  ${t}  skipped — ${p.warnings.join(', ')}`);
        wouldSkip++;
      } else {
        console.log(`${label}  ${t}  would list @ $${p.price}  (${p.photoFiles.length} photo${p.photoFiles.length !== 1 ? 's' : ''})`);
        wouldList++;
      }
    });
    console.log(`\nDry run: ${wouldList} would be listed, ${wouldSkip} would be skipped`);
    return;
  }

  // ── Live run ──────────────────────────────────────────────────────────────

  let listed = 0, skipped = 0;

  for (let i = 0; i < plan.length; i++) {
    const p     = plan[i];
    const label = `[${i + 1}/${total}] DWG-${p.paddedId || String(p.id).padStart(3, '0')}`;
    const t     = (p.title || '').slice(0, 42).padEnd(42);

    if (p.skip || p.warnings) {
      console.log(`${label}  ${t}  skipped — ${p.skip || p.warnings.join(', ')}`);
      skipped++;
      continue;
    }

    try {
      const formData = new FormData();
      formData.set('disc', JSON.stringify({
        id:           p.id,
        title:        p.title,
        listPrice:    p.price,
        condition:    p.row['Condition']    || '',
        manufacturer: p.row['Manufacturer'] || '',
        mold:         p.row['Mold']         || '',
        type:         p.row['Type']         || '',
        plastic:      p.row['Plastic']      || '',
        run:          p.row['Run/Edition']  || '',
        weight:       p.row['Weight (g)']   || '',
        notes:        p.row['Notes']        || '',
      }));

      for (const filename of p.photoFiles) {
        const buf  = fs.readFileSync(path.join(photosDir, filename));
        const blob = new Blob([buf], { type: 'image/jpeg' });
        formData.set(`photos[${filename.replace(/\.jpg$/i, '')}]`, blob, filename);
      }

      const response = await fetch(`${apiBase}/api/ebay/bulk-list`, {
        method: 'POST',
        body:   formData,
      });
      const result = await response.json();

      if (result.error) {
        console.log(`${label}  ${t}  ERROR — ${result.error}`);
        skipped++;
        continue;
      }

      // Write eBay columns back to the in-memory row and save CSV immediately
      p.row['eBay Listing ID'] = result.listingId;
      p.row['eBay URL']        = result.url;
      fs.writeFileSync(csvPath, serializeCSV(headers, records));

      console.log(`${label}  ${t}  listed  ${result.url}`);
      listed++;
    } catch (e) {
      console.log(`${label}  ${t}  ERROR — ${e.message}`);
      skipped++;
    }
  }

  console.log(`\nDone: ${listed} listed, ${skipped} skipped`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add scripts/bulk-list-discs.js
git commit -m "ref: add scripts/bulk-list-discs.js — CSV bulk listing CLI for disc golf"
```

---

## Task 4: Verify eBay category ID + first dry-run

**No files to modify** (unless category ID needs correcting).

- [ ] **Step 1: Verify the disc golf category ID**

The eBay disc golf category ID used in `server/ebay-listings.js` is `26441`. Verify it by searching eBay for a disc golf item and checking the URL for `rt=nc&_sacat=NNNNN`. If the ID is wrong, update `DG_CATEGORY` in `server/ebay-listings.js`.

Alternatively, confirm via the eBay category tree API:
```bash
curl -s "https://api.ebay.com/commerce/taxonomy/v1/category_tree/0" \
  -H "Authorization: Bearer $(cat data/ebay-tokens.json | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).access_token))')" \
  | grep -i "disc golf"
```
(If this is too verbose, just search eBay manually and check the `_sacat` param.)

- [ ] **Step 2: Run dry-run against dev server**

Make sure the server is running (`npm start`), then:

```bash
node scripts/bulk-list-discs.js \
  --csv ~/path/to/duckwerks-dg-catalog.csv \
  --photos ~/path/to/disc-photos/ \
  --ids 1-5 \
  --dry-run
```

Expected output:
```
DRY RUN — no listings will be created (target: http://localhost:3000)

[1/5] DWG-001  MVP Time-Lapse Simon Line...         would list @ $24.99  (3 photos)
[2/5] DWG-002  Axiom Hex Eclipse...                 would list @ $19.99  (2 photos)
[3/5] DWG-003  Innova Boss Star...                  skipped — no List Price
...

Dry run: 4 would be listed, 1 would be skipped
```

If policies are missing, the error surfaces here. Enable at Seller Hub > Account > Business policies before proceeding.

- [ ] **Step 3: Test single live disc against dev server**

```bash
node scripts/bulk-list-discs.js \
  --csv ~/path/to/duckwerks-dg-catalog.csv \
  --photos ~/path/to/disc-photos/ \
  --ids 1-1
```

Expected:
- One listing created on eBay (verify in Seller Hub)
- CSV updated with `eBay Listing ID` and `eBay URL` for row 1
- Item + listing row visible in the dashboard at `http://localhost:3000`

- [ ] **Step 4: Commit version bump**

Bump patch version in `public/v2/js/config.js` and `package.json`, then commit all changes.

```bash
git add server/ebay-listings.js public/v2/js/config.js package.json
git commit -m "ref: bump version — eBay bulk listing complete"
```
