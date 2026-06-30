# eBay Listing/Update Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse four drifting eBay route implementations into shared plumbing + one disc builder, so the list/update paths are unified and adding a new category means writing a builder, not touching routes.

**Architecture:** Extract all raw eBay API calls into `server/ebay-client.js` (pure functions, no Express, no DB). Move disc-specific field mapping and title/description generation into `server/ebay-builders.js`. Slim `server/ebay-listings.js` down to thin route handlers that call client + builder. Keep all existing route names so callers (catalog UI, scripts, skill) require zero changes.

**Tech Stack:** Node 22, Express, eBay Inventory API v1, better-sqlite3

---

## Two Modes — Do Not Conflate

**Inventory-backed** (discs): blob lives in `inventory` DB → builder transforms blob → normalized payload → route. `bulk-list` and `bulk-update` are this mode.

**Session-backed** (one-offs): skill builds normalized payload from checkpoint → sends directly to `list-item` / `update-item` routes. No inventory row, no builder. The listing session checkpoint is the store of record.

Routes receive a normalized payload and don't care which mode produced it.

---

## Normalized Payload Shape

This is the interface between builders/skill and routes:

```js
{
  sku,             // string — "DWG-001" or "DW-strangers-in-paradise-tpb-lot"
  title,           // string, max 80 chars
  description,     // optional plain text prose (curated copy)
  specLines,       // string[] — ["Brand: Innova", "Weight: 175 grams", ...] (builder assembles)
  condition,       // eBay enum: "NEW" | "NEW_OTHER" | "USED_GOOD" | "USED" etc.
  conditionNotes,  // optional string
  price,           // number
  minOffer,        // number
  categoryId,      // eBay category ID string
  aspects,         // { [name]: string[] }
  photos,          // optional [{ filename, base64 }] — omit to preserve existing
}
```

The description renderer (`renderDescriptionHtml`) takes `{ description, specLines }` and produces HTML. Builder provides specLines. Skill provides description. Neither knows about the other.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/ebay-client.js` | **CREATE** | All raw eBay API calls: headers, policies, location, EPS upload, inventory item PUT, offer upsert, offer publish, GET inventory item, GET offer by SKU |
| `server/ebay-builders.js` | **CREATE** | `buildDiscPayload(blob)` → normalized payload. `renderDescriptionHtml({ description, specLines })` → HTML string. Add future builders here. |
| `server/ebay-listings.js` | **REWRITE** | Thin route handlers only. Imports client + builders. All existing route names preserved. |
| `server/catalog.js` | No change | Calls `/api/ebay/bulk-update` and `/api/ebay/bulk-preview` — both stay |
| `scripts/bulk-list-discs.js` | No change | Calls `/api/ebay/bulk-list` and `/api/ebay/bulk-update` — both stay |
| `scripts/clean-disc-titles.js` | No change | Calls `/api/ebay/bulk-update` — stays |
| `.claude/skills/list-item/SKILL.md` | No change | Calls `/api/ebay/list-item` — stays |

---

## Task 1: Create `server/ebay-client.js`

Extract the pure eBay API functions from `ebay-listings.js`. No routing, no DB, no disc knowledge.

**Files:**
- Create: `server/ebay-client.js`

- [ ] **Step 1: Create the file**

```js
// server/ebay-client.js — shared eBay Inventory API client
const { getAccessToken } = require('./ebay-auth');

const EBAY_API   = 'https://api.ebay.com';
const EBAY_MEDIA = 'https://apim.ebay.com/commerce/media/v1_beta';
const MARKETPLACE = 'EBAY_US';

let _merchantLocationKey = null;

async function ebayHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Language': 'en-US',
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

async function getMerchantLocationKey(headers) {
  if (_merchantLocationKey) return _merchantLocationKey;
  const res  = await fetch(`${EBAY_API}/sell/inventory/v1/location`, { headers });
  const data = await res.json();
  if (data.locations?.length > 0) {
    _merchantLocationKey = data.locations[0].merchantLocationKey;
    return _merchantLocationKey;
  }
  const key         = 'duckwerks1';
  const postHeaders = { ...headers };
  delete postHeaders['Content-Language'];
  const created = await fetch(`${EBAY_API}/sell/inventory/v1/location/${key}`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({
      location: {
        address: {
          addressLine1:    process.env.FROM_STREET1,
          city:            process.env.FROM_CITY,
          stateOrProvince: process.env.FROM_STATE,
          postalCode:      process.env.FROM_ZIP,
          country:         process.env.FROM_COUNTRY || 'US',
        },
      },
      locationTypes: ['WAREHOUSE'],
      name:          'Duckwerks',
    }),
  });
  if (!created.ok) {
    const err = await created.text();
    throw new Error(`merchant location create failed: ${err}`);
  }
  _merchantLocationKey = key;
  return _merchantLocationKey;
}

async function uploadToEPS(buffer, filename) {
  const token    = await getAccessToken();
  const formData = new FormData();
  formData.set('image', new Blob([buffer], { type: 'image/jpeg' }), filename);
  const uploadRes = await fetch(`${EBAY_MEDIA}/image/create_image_from_file`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body:    formData,
  });
  if (uploadRes.status !== 201) {
    const text = await uploadRes.text();
    throw new Error(`EPS upload failed for ${filename} (${uploadRes.status}): ${text.slice(0, 200)}`);
  }
  const location = uploadRes.headers.get('Location');
  if (!location) throw new Error(`EPS upload for ${filename}: no Location header in 201 response`);
  const getRes  = await fetch(location, { headers: { 'Authorization': `Bearer ${token}` } });
  const getText = await getRes.text();
  if (!getRes.ok) throw new Error(`EPS getImage failed for ${filename} (${getRes.status}): ${getText.slice(0, 200)}`);
  return JSON.parse(getText).imageUrl;
}

async function getInventoryItem(sku, headers) {
  const res = await fetch(`${EBAY_API}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

async function putInventoryItem(sku, body, headers) {
  const res = await fetch(
    `${EBAY_API}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (res.status !== 200 && res.status !== 204) {
    const text = await res.text();
    throw new Error(`inventory_item PUT ${res.status}: ${text}`);
  }
}

async function getOfferBySku(sku, headers) {
  const res  = await fetch(`${EBAY_API}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, { headers });
  const data = await res.json();
  return data.offers?.[0] || null;
}

// POST offer; if 25002 (already exists) → PUT the existing offer instead
async function upsertOffer(offerBody, headers) {
  const res  = await fetch(`${EBAY_API}/sell/inventory/v1/offer`, {
    method: 'POST', headers, body: JSON.stringify(offerBody),
  });
  const data = await res.json();
  if (!res.ok) {
    const existing = data.errors?.find(e => e.errorId === 25002 && e.parameters?.find(p => p.name === 'offerId'));
    if (existing) {
      const offerId = existing.parameters.find(p => p.name === 'offerId').value;
      const patch   = await fetch(`${EBAY_API}/sell/inventory/v1/offer/${offerId}`, {
        method: 'PUT', headers, body: JSON.stringify(offerBody),
      });
      if (!patch.ok) {
        const patchData = await patch.json();
        throw new Error(`offer PUT ${patch.status}: ${JSON.stringify(patchData)}`);
      }
      return offerId;
    }
    throw new Error(`offer POST ${res.status}: ${JSON.stringify(data)}`);
  }
  return data.offerId;
}

async function updateOffer(offerId, offerBody, headers) {
  const res = await fetch(`${EBAY_API}/sell/inventory/v1/offer/${offerId}`, {
    method: 'PUT', headers, body: JSON.stringify(offerBody),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`offer PUT ${res.status}: ${text}`);
  }
}

async function publishOffer(offerId, headers) {
  const attempt = async () => {
    const res  = await fetch(`${EBAY_API}/sell/inventory/v1/offer/${offerId}/publish`, {
      method: 'POST', headers,
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(`offer publish ${res.status}: ${JSON.stringify(data)}`), { data });
    return data.listingId;
  };
  try {
    return await attempt();
  } catch (e) {
    if (e.data?.errors?.some(err => err.errorId === 25604)) {
      await new Promise(r => setTimeout(r, 3000));
      return await attempt();
    }
    throw e;
  }
}

module.exports = {
  ebayHeaders,
  fetchPolicies,
  getMerchantLocationKey,
  uploadToEPS,
  getInventoryItem,
  putInventoryItem,
  getOfferBySku,
  upsertOffer,
  updateOffer,
  publishOffer,
  MARKETPLACE,
};
```

- [ ] **Step 2: Smoke-test that the module loads without error**

```bash
node -e "const c = require('./server/ebay-client'); console.log(Object.keys(c));"
```

Expected output: `[ 'ebayHeaders', 'fetchPolicies', 'getMerchantLocationKey', 'uploadToEPS', 'getInventoryItem', 'putInventoryItem', 'getOfferBySku', 'upsertOffer', 'updateOffer', 'publishOffer', 'MARKETPLACE' ]`

- [ ] **Step 3: Verify it can talk to eBay (GET only — no writes)**

```bash
node -e "
const { ebayHeaders, fetchPolicies, getMerchantLocationKey } = require('./server/ebay-client');
require('dotenv').config();
(async () => {
  const h = await ebayHeaders();
  const p = await fetchPolicies(h);
  console.log('policies:', JSON.stringify(p));
  const loc = await getMerchantLocationKey(h);
  console.log('location:', loc);
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: prints policy IDs and `duckwerks1` (or whatever location key is in your account). No errors.

- [ ] **Step 4: Commit**

```bash
git add server/ebay-client.js
git commit -m "refactor: extract ebay-client.js with shared eBay API plumbing"
```

---

## Task 2: Create `server/ebay-builders.js`

Disc-specific field mapping, title generation, aspect building, and description rendering all live here. Routes and client never see disc fields after this.

**Files:**
- Create: `server/ebay-builders.js`

- [ ] **Step 1: Create the file**

```js
// server/ebay-builders.js — category-specific payload builders
// Each builder takes raw item data and returns a normalized payload
// for the list/update routes. Add new builders here for new categories.

const LISTING_FOOTER = '\nAll sales final and all items sold as is. Please ask questions before purchasing.\nAll my listings ship with Free shipping for your ease, none of this $30 shipping on a 1 pound item. I price my listings fairly but please feel free to make an offer.\nI am a single person listing and selling 250 or so discs, so I might have missed a mark or two in my descriptions. Please ask if you want more photos or details about any of my discs, or let me know if you see any issues. \nThanks for looking!';

const DG_CATEGORY = '184356'; // Sporting Goods > Disc Golf > Discs
const MIN_OFFER_PCT = 0.75;

const DISC_TYPE_MAP = { 'Putter': 'Putting Disc', 'Midrange': 'Midrange Disc' };
const MANUFACTURER_MAP = { 'Streamline': 'Streamline Discs' };

const VALID_COLORS = new Set([
  'Beige', 'Black', 'Blue', 'Bronze', 'Brown', 'Gold', 'Gray', 'Green',
  'Multi-Color', 'Orange', 'Pink', 'Purple', 'Red', 'Silver', 'White', 'Yellow',
]);

function normalizeDiscType(type) { return DISC_TYPE_MAP[type] || type; }
function normalizeManufacturer(m) { return MANUFACTURER_MAP[m] || m; }
function minOffer(price) { return Math.floor(parseFloat(price) * MIN_OFFER_PCT); }

function generateDiscTitle({ manufacturer, mold, plastic, run, weight, color, condition }) {
  const parts = [manufacturer, mold, plastic];
  if (run) parts.push(run);
  parts.push(`${weight}g`, color);
  if (condition === 'USED') parts.push('Used');
  const title = parts.join(' ');
  if (title.length <= 80) return title;
  return title.slice(0, 81).replace(/\s+\S*$/, '');
}

function buildDiscSpecLines(blob) {
  const lines = [];
  if (blob.manufacturer) lines.push(`Brand: ${blob.manufacturer}`);
  if (blob.mold)         lines.push(`Mold: ${blob.mold}`);
  if (blob.type)         lines.push(`Type: ${blob.type}`);
  if (blob.plastic)      lines.push(`Plastic: ${blob.plastic}`);
  if (blob.run)          lines.push(`Run/Edition: ${blob.run}`);
  if (blob.weight)       lines.push(`Weight: ${blob.weight}g`);
  if (blob.stability)    lines.push(`Stability: ${blob.stability}`);
  const hasVal = v => v != null && v !== '';
  if (hasVal(blob.speed) || hasVal(blob.glide) || hasVal(blob.turn) || hasVal(blob.fade)) {
    const parts = [];
    if (hasVal(blob.speed)) parts.push(`Speed: ${blob.speed}`);
    if (hasVal(blob.glide)) parts.push(`Glide: ${blob.glide}`);
    if (hasVal(blob.turn))  parts.push(`Turn: ${blob.turn}`);
    if (hasVal(blob.fade))  parts.push(`Fade: ${blob.fade}`);
    lines.push(`Flight Numbers: ${parts.join(' | ')}`);
  }
  if (blob.notes) lines.push(`\nNotes: ${blob.notes}`);
  return lines;
}

// Unified description renderer — used by both disc builder and list-item/update-item routes.
// description: optional curated prose string
// specLines: string[] of "Key: Value" lines
// Returns full HTML string with mobile schema.org snippet, spec list, and footer.
function renderDescriptionHtml({ description, specLines = [] }) {
  const footerLines = LISTING_FOOTER.split('\n').filter(Boolean);
  const footer      = footerLines.map(l => `<p>${l}</p>`).join('');
  const specList    = specLines.length
    ? `<ul>${specLines.filter(l => l.trim()).map(l => `<li>${l}</li>`).join('')}</ul>`
    : '';

  if (description) {
    const paraLines  = description.split('\n').filter(Boolean);
    const mobileText = specLines.join('  |  ') + '  |  ' + paraLines.join(' ');
    const fullHtml   = paraLines.map(l => `<p>${l}</p>`).join('');
    return `<div vocab="https://schema.org/" typeof="Product" style="display:none"><span property="description">${mobileText}</span></div>${fullHtml}${specList}${footer}`;
  }

  const mobileText = specLines.join('  |  ');
  return `<div vocab="https://schema.org/" typeof="Product" style="display:none"><span property="description">${mobileText}</span></div>${specList}${footer}`;
}

// Renders plain-text description from skill checkpoint (pipe-separated spec blocks + prose).
// Used by list-item and update-item routes when payload arrives pre-built from skill.
function renderSkillDescriptionHtml(text) {
  const blocks   = text.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  const htmlParts = [];
  const allSpecLines = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.every(l => l.includes(' | '))) {
      allSpecLines.push(...lines);
      htmlParts.push(`<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`);
    } else {
      lines.forEach(l => htmlParts.push(`<p>${l}</p>`));
    }
  }

  const mobileText = text.replace(/\n+/g, '  |  ');
  return `<div vocab="https://schema.org/" typeof="Product" style="display:none"><span property="description">${mobileText}</span></div>${htmlParts.join('')}`;
}

// Builds a normalized payload from a disc inventory blob.
// blob: the metadata JSON from the inventory table (already parsed)
// Returns the normalized payload shape the list/update routes accept.
function buildDiscPayload(blob) {
  const title     = blob.list_title || generateDiscTitle(blob);
  const specLines = buildDiscSpecLines(blob);
  const price     = parseFloat(blob.listPrice);
  const condition = blob.condition || 'NEW';

  const aspects = {
    Type: ['Disc Golf Disc'],
    ...(blob.manufacturer && { Brand:               [normalizeManufacturer(blob.manufacturer)] }),
    ...(blob.mold         && { Model:               [blob.mold] }),
    ...(blob.type         && { 'Disc Type':          [normalizeDiscType(blob.type)] }),
    ...(blob.plastic      && { 'Disc Plastic Type':  [blob.plastic] }),
    ...(blob.weight       && { 'Disc Weight':        [`${blob.weight} grams`] }),
    ...(blob.color && VALID_COLORS.has(blob.color) && { Color: [blob.color] }),
    ...(blob.speed != null && blob.speed !== '' && { 'Speed Rating':        [String(blob.speed)] }),
    ...(blob.glide != null && blob.glide !== '' && { 'Glide Rating':        [String(blob.glide)] }),
    ...(blob.turn  != null && blob.turn  !== '' && { 'Turn (Right) Rating': [String(blob.turn)] }),
    ...(blob.fade  != null && blob.fade  !== '' && { 'Fade (Left) Rating':  [String(blob.fade)] }),
  };

  return {
    title,
    description: blob.description || null,
    specLines,
    condition,
    price,
    minOffer:   minOffer(price),
    categoryId: DG_CATEGORY,
    aspects,
  };
}

module.exports = { buildDiscPayload, renderDescriptionHtml, renderSkillDescriptionHtml, minOffer };
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "const b = require('./server/ebay-builders'); console.log(Object.keys(b));"
```

Expected: `[ 'buildDiscPayload', 'renderDescriptionHtml', 'renderSkillDescriptionHtml', 'minOffer' ]`

- [ ] **Step 3: Diff builder output against current behavior for a known disc**

Fetch DWG-001 from the NUC DB and compare the builder's output to what the old inline code would produce:

```bash
ssh geoff@fedora.local "cd /home/geoff/projects/duckwerksdash && sqlite3 -json data/duckwerks.db \"SELECT metadata FROM inventory WHERE sku='DWG-001';\""
```

Copy the `metadata` JSON value, then run locally:

```bash
node -e "
require('dotenv').config();
const { buildDiscPayload, renderDescriptionHtml } = require('./server/ebay-builders');
const blob = /* paste metadata JSON here */;
const payload = buildDiscPayload(blob);
console.log('title:', payload.title);
console.log('condition:', payload.condition);
console.log('specLines:', payload.specLines);
console.log('aspects:', JSON.stringify(payload.aspects, null, 2));
console.log('descHtml:', renderDescriptionHtml(payload).slice(0, 300));
"
```

Verify title matches what's on the eBay listing, aspects look correct, no undefined values.

- [ ] **Step 4: Commit**

```bash
git add server/ebay-builders.js
git commit -m "refactor: add ebay-builders.js with buildDiscPayload and renderDescriptionHtml"
```

---

## Task 3: Rewrite `server/ebay-listings.js`

Replace all the inline duplicated logic with calls to `ebay-client.js` and `ebay-builders.js`. All six route names stay identical so no callers break.

**Files:**
- Modify: `server/ebay-listings.js`

- [ ] **Step 1: Replace the file contents**

```js
// server/ebay-listings.js — eBay listing routes
// All eBay API calls go through ebay-client.js.
// Disc-specific field mapping goes through ebay-builders.js.
// Route names are preserved for backward compatibility with scripts and the skill.

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');

const {
  ebayHeaders, fetchPolicies, getMerchantLocationKey,
  uploadToEPS, getInventoryItem, putInventoryItem,
  getOfferBySku, upsertOffer, updateOffer, publishOffer,
  MARKETPLACE,
} = require('./ebay-client');

const { buildDiscPayload, renderDescriptionHtml, renderSkillDescriptionHtml, minOffer } = require('./ebay-builders');

const PHOTOS_DIR          = path.join(__dirname, '..', 'public', 'dg-photos');
const EBAY_STORE_CATEGORY = 'Multiple Discounts';

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildInventoryItemBody(payload, imageUrls) {
  return {
    product: {
      title:       payload.title.slice(0, 80),
      description: renderDescriptionHtml({ description: payload.description, specLines: payload.specLines }),
      imageUrls,
      aspects:     Object.fromEntries(
        Object.entries(payload.aspects || {}).map(([k, v]) => [k, Array.isArray(v) ? v : [String(v)]])
      ),
    },
    condition: payload.condition,
    ...(payload.conditionNotes && { conditionDescription: payload.conditionNotes }),
    availability: { shipToLocationAvailability: { quantity: 1 } },
  };
}

function buildOfferBody(sku, payload, policies, locationKey) {
  return {
    sku,
    marketplaceId:       MARKETPLACE,
    format:              'FIXED_PRICE',
    merchantLocationKey: locationKey,
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      returnPolicyId:      policies.returnPolicyId,
      paymentPolicyId:     policies.paymentPolicyId,
      bestOfferTerms: {
        bestOfferEnabled: true,
        autoDeclinePrice: { value: String(payload.minOffer), currency: 'USD' },
      },
    },
    pricingSummary: {
      price: { value: String(payload.price), currency: 'USD' },
    },
    categoryId:         payload.categoryId,
    storeCategoryNames: [EBAY_STORE_CATEGORY],
    listingDescription: renderDescriptionHtml({ description: payload.description, specLines: payload.specLines }),
    shipToLocations: {
      regionIncluded: [{ regionType: 'COUNTRY', regionName: 'US' }],
    },
  };
}

async function savePhotos(files) {
  const urls = [];
  for (const file of files) {
    const dest = path.join(PHOTOS_DIR, file.originalname);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, file.buffer);
    urls.push(await uploadToEPS(file.buffer, file.originalname));
  }
  return urls;
}

// ── DB writes ─────────────────────────────────────────────────────────────────

function dbWriteDiscListing(disc, listingId, sku) {
  const existing = db.prepare('SELECT id FROM listings WHERE platform_listing_id = ?').get(String(listingId));
  if (existing) return;

  let cat = db.prepare("SELECT id FROM categories WHERE name = 'Disc Golf'").get();
  if (!cat) {
    const r = db.prepare(
      "INSERT INTO categories (name, color, badge_class) VALUES ('Disc Golf', '#4ade80', 'badge-green')"
    ).run();
    cat = { id: r.lastInsertRowid };
  }

  const ebaySite = db.prepare("SELECT id FROM sites WHERE name = 'eBay'").get();
  if (!ebaySite) throw new Error('eBay site not found in DB');

  const item = db.prepare(
    "INSERT INTO items (name, status, category_id, cost, lot_id, sku) VALUES (?, 'Listed', ?, 0, 9, ?)"
  ).run(disc.title, cat.id, sku || null);

  db.prepare(
    'INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url) VALUES (?, ?, ?, ?, 7, ?)'
  ).run(item.lastInsertRowid, ebaySite.id, String(listingId), disc.listPrice, `https://ebay.com/itm/${listingId}`);
}

function dbWriteSkillListing(item, listingId) {
  const existing = db.prepare('SELECT id FROM listings WHERE platform_listing_id = ?').get(String(listingId));
  if (existing) return;

  const ebaySite = db.prepare("SELECT id FROM sites WHERE name = 'eBay'").get();
  if (!ebaySite) throw new Error('eBay site not found in DB');

  const catLabel = item.internalCategory || (item.categoryLabel?.split(' > ')[0]) || 'Uncategorized';
  let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(catLabel);
  if (!cat) {
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(catLabel);
    cat = { id: r.lastInsertRowid };
  }

  const ins = db.prepare(
    "INSERT INTO items (name, status, category_id, cost, lot_id, sku) VALUES (?, 'Listed', ?, 0, ?, ?)"
  ).run(item.title, cat.id, item.lot_id || null, item.sku);

  db.prepare(
    'INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(ins.lastInsertRowid, ebaySite.id, String(listingId), item.price, `https://ebay.com/itm/${listingId}`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/ebay/bulk-list — list a disc from inventory blob + photos
// Called by scripts/bulk-list-discs.js
router.post('/bulk-list', (req, res, next) => {
  upload.any()(req, res, err => {
    if (err) return res.json({ error: `Upload error: ${err.message}` });
    next();
  });
}, async (req, res) => {
  let disc;
  try {
    disc = JSON.parse(req.body.disc);
  } catch {
    return res.status(400).json({ error: 'Invalid disc JSON in request body' });
  }

  try {
    const headers     = await ebayHeaders();
    const policies    = await fetchPolicies(headers);
    const locationKey = await getMerchantLocationKey(headers);
    const sku         = `DWG-${String(disc.id).padStart(3, '0')}`;
    const payload     = buildDiscPayload(disc);
    const photoUrls   = await savePhotos(req.files || []);

    await putInventoryItem(sku, buildInventoryItemBody(payload, photoUrls), headers);
    const offerId   = await upsertOffer(buildOfferBody(sku, payload, policies, locationKey), headers);
    const listingId = await publishOffer(offerId, headers);

    dbWriteDiscListing({ ...disc, title: payload.title }, listingId, sku);

    res.json({ discId: disc.id, sku, listingId, url: `https://ebay.com/itm/${listingId}` });
  } catch (e) {
    console.error('[ebay-listings] bulk-list error:', e);
    res.json({ discId: disc?.id, error: e.message });
  }
});

// POST /api/ebay/bulk-photos — replace photos on existing listing without touching offer
// Called by scripts/bulk-list-discs.js --photos-only
router.post('/bulk-photos', (req, res, next) => {
  upload.any()(req, res, err => {
    if (err) return res.json({ error: `Upload error: ${err.message}` });
    next();
  });
}, async (req, res) => {
  let disc;
  try {
    disc = typeof req.body.disc === 'string' ? JSON.parse(req.body.disc) : req.body.disc;
  } catch {
    return res.status(400).json({ error: 'Invalid disc JSON' });
  }

  try {
    const headers = await ebayHeaders();
    const sku     = `DWG-${String(disc.id).padStart(3, '0')}`;
    const photos  = (req.files || []).filter(f => f.fieldname.startsWith('photos['));
    if (photos.length === 0) return res.json({ discId: disc.id, error: 'No photos provided' });

    const imageUrls = await savePhotos(photos);
    const existing  = await getInventoryItem(sku, headers);
    if (!existing) return res.json({ discId: disc.id, error: `No inventory item found for ${sku}` });

    await putInventoryItem(sku, {
      product:      { ...existing.product, imageUrls },
      condition:    existing.condition,
      availability: existing.availability,
    }, headers);

    res.json({ discId: disc.id, sku, photoCount: imageUrls.length });
  } catch (e) {
    console.error('[ebay-listings] bulk-photos error:', e);
    res.json({ discId: disc?.id, error: e.message });
  }
});

// POST /api/ebay/bulk-preview — preview title/description/price without touching eBay
// Called by catalog UI
router.post('/bulk-preview', (req, res) => {
  try {
    const disc    = typeof req.body.disc === 'string' ? JSON.parse(req.body.disc) : req.body.disc;
    const payload = buildDiscPayload(disc);
    res.json({
      title:       payload.title,
      price:       payload.price,
      autoDecline: payload.minOffer,
      description: renderDescriptionHtml({ description: payload.description, specLines: payload.specLines }),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/ebay/bulk-update — update title/description/price on an existing disc listing
// Called by catalog UI and scripts/bulk-list-discs.js --update and scripts/clean-disc-titles.js
router.post('/bulk-update', async (req, res) => {
  let disc;
  try {
    disc = typeof req.body.disc === 'string' ? JSON.parse(req.body.disc) : req.body.disc;
  } catch {
    return res.status(400).json({ error: 'Invalid disc JSON' });
  }

  try {
    const headers = await ebayHeaders();
    const sku     = `DWG-${String(disc.id).padStart(3, '0')}`;
    const payload = buildDiscPayload(disc);

    const existing = await getInventoryItem(sku, headers);
    if (!existing) return res.json({ discId: disc.id, error: `No inventory item found for ${sku}` });

    const imageUrls = existing.product?.imageUrls || [];
    await putInventoryItem(sku, buildInventoryItemBody(payload, imageUrls), headers);

    const offer = await getOfferBySku(sku, headers);
    if (!offer) return res.json({ discId: disc.id, error: `No offer found for ${sku}` });

    const offerBody = {
      sku,
      marketplaceId:       MARKETPLACE,
      format:              'FIXED_PRICE',
      merchantLocationKey: offer.merchantLocationKey,
      listingPolicies: {
        ...offer.listingPolicies,
        bestOfferTerms: {
          bestOfferEnabled: true,
          autoDeclinePrice: { value: String(payload.minOffer), currency: 'USD' },
        },
      },
      pricingSummary: {
        price: { value: String(payload.price), currency: 'USD' },
      },
      categoryId:         payload.categoryId,
      storeCategoryNames: [EBAY_STORE_CATEGORY],
      listingDescription: renderDescriptionHtml({ description: payload.description, specLines: payload.specLines }),
      shipToLocations:    offer.shipToLocations,
    };
    await updateOffer(offer.offerId, offerBody, headers);

    const listingId = offer.listing?.listingId;
    res.json({ discId: disc.id, sku, offerId: offer.offerId, listingId, url: listingId ? `https://ebay.com/itm/${listingId}` : null });
  } catch (e) {
    console.error('[ebay-listings] bulk-update error:', e);
    res.json({ discId: disc?.id, error: e.message });
  }
});

// POST /api/ebay/list-item — list a one-off item from skill checkpoint data
// Called by the list-item skill. Payload arrives pre-built (no builder needed).
router.post('/list-item', express.json({ limit: '20mb' }), async (req, res) => {
  const item = req.body;
  if (!item?.sku || !item?.title || !item?.price || !item?.ebayCategoryId || !item?.ebayConditionId) {
    return res.status(400).json({ error: 'Missing required fields: sku, title, price, ebayCategoryId, ebayConditionId' });
  }

  try {
    const headers     = await ebayHeaders();
    const policies    = await fetchPolicies(headers);
    const locationKey = await getMerchantLocationKey(headers);

    let photoUrls = [];
    if (Array.isArray(item.photos) && item.photos.length > 0) {
      for (const photo of item.photos) {
        photoUrls.push(await uploadToEPS(Buffer.from(photo.base64, 'base64'), photo.filename));
      }
    }

    const descHtml = renderSkillDescriptionHtml(item.description || '');

    await putInventoryItem(item.sku, {
      product: {
        title:       item.title.slice(0, 80),
        description: descHtml,
        imageUrls:   photoUrls,
        aspects:     Object.fromEntries(
          Object.entries(item.aspects || {}).map(([k, v]) => [k, Array.isArray(v) ? v : [String(v)]])
        ),
      },
      condition: item.ebayConditionId,
      ...(item.conditionNotes && { conditionDescription: item.conditionNotes }),
      availability: { shipToLocationAvailability: { quantity: 1 } },
    }, headers);

    const offerBody = {
      sku:                 item.sku,
      marketplaceId:       MARKETPLACE,
      format:              'FIXED_PRICE',
      merchantLocationKey: locationKey,
      listingPolicies: {
        fulfillmentPolicyId: policies.fulfillmentPolicyId,
        returnPolicyId:      policies.returnPolicyId,
        paymentPolicyId:     policies.paymentPolicyId,
        bestOfferTerms: {
          bestOfferEnabled:  true,
          autoDeclinePrice:  { value: String(item.minOffer), currency: 'USD' },
        },
      },
      pricingSummary: { price: { value: String(item.price), currency: 'USD' } },
      categoryId:         item.ebayCategoryId,
      storeCategoryNames: [EBAY_STORE_CATEGORY],
      listingDescription: descHtml,
      shipToLocations: { regionIncluded: [{ regionType: 'COUNTRY', regionName: 'US' }] },
    };

    const offerId   = await upsertOffer(offerBody, headers);
    const listingId = await publishOffer(offerId, headers);

    dbWriteSkillListing(item, listingId);

    res.json({ sku: item.sku, listingId, url: `https://ebay.com/itm/${listingId}` });
  } catch (e) {
    console.error('[ebay-listings] list-item error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ebay/update-item — update an existing one-off listing from skill checkpoint
// Called by the list-item skill update flow.
router.post('/update-item', async (req, res) => {
  const item = req.body;
  if (!item?.sku || !item?.price) {
    return res.status(400).json({ error: 'Missing required fields: sku, price' });
  }

  try {
    const headers  = await ebayHeaders();
    const descHtml = renderSkillDescriptionHtml(item.description || '');

    const existing = await getInventoryItem(item.sku, headers);
    if (!existing) return res.status(404).json({ error: `No inventory item found for SKU ${item.sku}` });

    await putInventoryItem(item.sku, {
      ...existing,
      product: {
        ...existing.product,
        ...(item.title       && { title: item.title.slice(0, 80) }),
        ...(item.description && { description: descHtml }),
        ...(item.aspects     && {
          aspects: Object.fromEntries(
            Object.entries(item.aspects).map(([k, v]) => [k, Array.isArray(v) ? v : [String(v)]])
          ),
        }),
      },
      ...(item.ebayConditionId && { condition: item.ebayConditionId }),
      ...(item.conditionNotes  && { conditionDescription: item.conditionNotes }),
    }, headers);

    const offer = await getOfferBySku(item.sku, headers);
    if (!offer) return res.status(404).json({ error: `No offer found for SKU ${item.sku}` });

    await updateOffer(offer.offerId, {
      sku:                 item.sku,
      marketplaceId:       MARKETPLACE,
      format:              'FIXED_PRICE',
      merchantLocationKey: offer.merchantLocationKey,
      listingPolicies: {
        ...offer.listingPolicies,
        bestOfferTerms: {
          bestOfferEnabled: true,
          autoDeclinePrice: { value: String(item.minOffer ?? minOffer(item.price)), currency: 'USD' },
        },
      },
      pricingSummary: { price: { value: String(item.price), currency: 'USD' } },
      categoryId:         item.ebayCategoryId || offer.categoryId,
      storeCategoryNames: [EBAY_STORE_CATEGORY],
      listingDescription: descHtml,
      shipToLocations:    offer.shipToLocations,
    }, headers);

    db.prepare('UPDATE listings SET list_price = ? WHERE platform_listing_id = ?')
      .run(item.price, String(offer.listing?.listingId));

    res.json({ sku: item.sku, offerId: offer.offerId, listingId: offer.listing?.listingId });
  } catch (e) {
    console.error('[ebay-listings] update-item error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify the server starts cleanly**

```bash
npm start
```

Watch for any `require` errors or startup crashes. Expected: server starts on port 3000 with no errors.

Kill with Ctrl-C.

- [ ] **Step 3: Smoke-test bulk-preview against a real disc**

```bash
ssh geoff@fedora.local "cd /home/geoff/projects/duckwerksdash && sqlite3 -json data/duckwerks.db \"SELECT sku, metadata FROM inventory WHERE sku='DWG-001';\""
```

Use the returned metadata to hit the local bulk-preview endpoint:

```bash
curl -s -X POST http://localhost:3000/api/ebay/bulk-preview \
  -H "Content-Type: application/json" \
  -d '{"disc": <paste metadata JSON here with id field added>}' | jq '{title, price, autoDecline}'
```

Expected: title matches the live eBay listing title for DWG-001, price and autoDecline are numbers.

- [ ] **Step 4: Commit**

```bash
git add server/ebay-listings.js
git commit -m "refactor: slim ebay-listings.js to thin routes using ebay-client and ebay-builders ref #121"
```

---

## Task 4: Deploy and smoke-test on production

**Files:** none — deploy only

- [ ] **Step 1: Push and deploy**

```bash
git push origin main && bash scripts/deploy-nuc.sh
```

Wait for deploy-nuc.sh to confirm PM2 restart.

- [ ] **Step 2: Test bulk-preview via catalog UI**

Open `dash.duckwerks.com`, go to Catalog > Inventory, open any disc row, click UPDATE EBAY. Verify the preview modal shows correct title, price, and auto-decline.

- [ ] **Step 3: Test bulk-update on one disc**

In the catalog UI, click CONFIRM UPDATE on one disc. Verify:
- Response shows `listingId` and URL
- eBay listing title matches expected (check the URL)

- [ ] **Step 4: Verify server logs are clean**

```bash
ssh geoff@fedora.local "pm2 logs duckwerksdash --lines 50 --nostream"
```

No unexpected errors or stack traces.

---

## Self-Review

**Spec coverage:**
- [x] `ebay-client.js` extracts all shared plumbing
- [x] `ebay-builders.js` isolates disc knowledge + unified renderer
- [x] All six route names preserved — no callers break
- [x] `bulk-preview` uses builder
- [x] `bulk-update` uses builder + `updateOffer` (not `upsertOffer` — correct, offer already exists)
- [x] `bulk-list` uses builder + `upsertOffer` + `publishOffer`
- [x] `list-item` / `update-item` use `renderSkillDescriptionHtml` (pre-built payload, no builder)
- [x] Two-mode distinction maintained: disc routes go through builder, skill routes go direct
- [x] `minOffer` exported from builders for use in `update-item` fallback

**Placeholder scan:** None found.

**Type consistency:** `upsertOffer(offerBody, headers)` — note argument order is `(body, headers)`, matching definition in `ebay-client.js`. `updateOffer(offerId, offerBody, headers)` — three args, used consistently in `bulk-update` and `update-item`.
