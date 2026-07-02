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

// Read a disc's already-placed photos from disk and push them to EPS (web
// bulk-list, #139). Photos live in dg-photos as DWG-{id}-{n}.jpeg keyed by the
// UNPADDED id; the trailing `-` disambiguates DWG-10- from DWG-100-. Ordered by
// the {n} suffix. Returns the EPS image URLs (empty array if none placed yet).
async function photosFromDisk(id) {
  const prefix = `dwg-${id}-`;
  const suffix = f => parseInt(f.match(/-(\d+)\.jpe?g$/i)?.[1] || '0', 10);
  const files  = fs.readdirSync(PHOTOS_DIR)
    .filter(f => f.toLowerCase().startsWith(prefix) && /\.jpe?g$/i.test(f))
    .sort((a, b) => suffix(a) - suffix(b));
  const urls = [];
  for (const f of files) {
    urls.push(await uploadToEPS(fs.readFileSync(path.join(PHOTOS_DIR, f)), f));
  }
  return urls;
}

// Resolve a disc's canonical title and live price from the engine (issue #134):
// items.name is the materialized title, the active listing row owns the price.
// The blob's list_title/listPrice are spec/staging, used only as fallbacks when
// no item/listing exists yet. Returns { title, price } (either may be null).
function resolveListedFields(sku) {
  const row = db.prepare(`
    SELECT it.name AS title, l.list_price AS price
    FROM items it
    LEFT JOIN listings l ON l.item_id = it.id AND l.status = 'active'
    WHERE it.sku = ?
    ORDER BY l.id DESC
    LIMIT 1
  `).get(sku);
  return row || { title: null, price: null };
}

// ── DB writes ─────────────────────────────────────────────────────────────────

function dbWriteDiscListing(title, listPrice, listingId, sku) {
  const existing = db.prepare('SELECT id FROM listings WHERE platform_listing_id = ?').get(String(listingId));
  if (existing) return;

  const ebaySite = db.prepare("SELECT id FROM sites WHERE name = 'eBay'").get();
  if (!ebaySite) throw new Error('eBay site not found in DB');

  // The items row is minted at intake (#134 Phase 2) — find it, materialize its
  // name from the current title, and flip to Listed. Fall back to creating one
  // for any SKU that predates coupling.
  let itemId;
  const item = sku ? db.prepare('SELECT id FROM items WHERE sku = ?').get(sku) : null;
  if (item) {
    itemId = item.id;
    db.prepare("UPDATE items SET name = ?, status = 'Listed' WHERE id = ?").run(title, itemId);
  } else {
    let cat = db.prepare("SELECT id FROM categories WHERE name = 'Disc Golf'").get();
    if (!cat) {
      const r = db.prepare(
        "INSERT INTO categories (name, color, badge_class) VALUES ('Disc Golf', '#4ade80', 'badge-green')"
      ).run();
      cat = { id: r.lastInsertRowid };
    }
    itemId = db.prepare(
      "INSERT INTO items (name, status, category_id, cost, lot_id, sku) VALUES (?, 'Listed', ?, 0, 9, ?)"
    ).run(title, cat.id, sku || null).lastInsertRowid;
  }

  const result = db.prepare(
    'INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url) VALUES (?, ?, ?, ?, 7, ?)'
  ).run(itemId, ebaySite.id, String(listingId), listPrice, `https://ebay.com/itm/${listingId}`);

  if (listPrice != null) {
    db.prepare(
      'INSERT INTO price_history (listing_id, old_price, new_price, source) VALUES (?, NULL, ?, ?)'
    ).run(result.lastInsertRowid, listPrice, 'mint');
  }
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

  const result = db.prepare(
    'INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(ins.lastInsertRowid, ebaySite.id, String(listingId), item.price, `https://ebay.com/itm/${listingId}`);

  if (item.price != null) {
    db.prepare(
      'INSERT INTO price_history (listing_id, old_price, new_price, source) VALUES (?, NULL, ?, ?)'
    ).run(result.lastInsertRowid, item.price, 'mint');
  }
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
    // Photos come either as a multipart upload (CLI) or already on disk in
    // dg-photos (web bulk-list, #139 — placed by the upload/map step).
    const photoUrls   = (req.files && req.files.length)
      ? await savePhotos(req.files)
      : await photosFromDisk(disc.id);

    await putInventoryItem(sku, buildInventoryItemBody(payload, photoUrls), headers);
    const offerId   = await upsertOffer(buildOfferBody(sku, payload, policies, locationKey), headers);
    const listingId = await publishOffer(offerId, headers);

    dbWriteDiscListing(payload.title, payload.price, listingId, sku);

    res.json({ discId: disc.id, sku, listingId, url: `https://ebay.com/itm/${listingId}` });
  } catch (e) {
    console.error('[ebay-listings] bulk-list error:', e);
    res.json({ discId: disc?.id, error: e.message });
  }
});

// POST /api/ebay/bulk-list-photos — upload a photo pile, chunk by N, map to a
// list of Prepping disc ids (ascending) and write them into dg-photos as
// DWG-{id}-{n}.jpeg. The upload/map step of web bulk-list (#139) — returns the
// mapping so the UI can preview disc<->photos before the actual list. Files sort
// by filename (the shot order). A disc's prior photos are cleared before its new
// chunk is written, so a re-upload is authoritative.
router.post('/bulk-list-photos', (req, res, next) => {
  upload.any()(req, res, err => {
    if (err) return res.json({ error: `Upload error: ${err.message}` });
    next();
  });
}, (req, res) => {
  try {
    const perDisc = parseInt(req.body.perDisc, 10);
    const discIds = JSON.parse(req.body.discIds || '[]');
    if (!perDisc || perDisc < 1) return res.status(400).json({ error: 'perDisc must be >= 1' });
    if (!Array.isArray(discIds) || !discIds.length) return res.status(400).json({ error: 'discIds (ascending array) required' });

    const files = (req.files || []).slice()
      .sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }));

    const mapping = {};
    for (let i = 0; i < discIds.length; i++) {
      const id    = discIds[i];
      const chunk = files.slice(i * perDisc, (i + 1) * perDisc);
      if (!chunk.length) { mapping[id] = []; continue; }   // no files this batch — leave existing
      // clear prior photos for this disc (re-upload wins)
      const stale = new RegExp(`^DWG-${id}-\\d+\\.jpe?g$`, 'i');
      fs.readdirSync(PHOTOS_DIR).filter(f => stale.test(f)).forEach(f => fs.unlinkSync(path.join(PHOTOS_DIR, f)));
      mapping[id] = chunk.map((f, idx) => {
        const name = `DWG-${id}-${idx + 1}.jpeg`;
        fs.writeFileSync(path.join(PHOTOS_DIR, name), f.buffer);
        return `/dg-photos/${name}`;
      });
    }
    const leftover = Math.max(0, files.length - discIds.length * perDisc);
    res.json({ mapping, totalFiles: files.length, leftover });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/ebay/photo-status — photo count per disc id from dg-photos (#139).
// Drives the catalog list-readiness badge. Returns { counts: { "<id>": n } }.
router.get('/photo-status', (req, res) => {
  try {
    const counts = {};
    for (const f of fs.readdirSync(PHOTOS_DIR)) {
      const m = f.match(/^DWG-(\d+)-\d+\.jpe?g$/i);
      if (m) { const id = parseInt(m[1], 10); counts[id] = (counts[id] || 0) + 1; }
    }
    res.json({ counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const sku     = `DWG-${String(disc.id).padStart(3, '0')}`;
    const payload = buildDiscPayload(disc, resolveListedFields(sku));   // items.name + listing price (#134)
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
// Called by catalog UI, scripts/bulk-list-discs.js --update, scripts/clean-disc-titles.js
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
    const fields  = resolveListedFields(sku);   // items.name (title) + listing price (#134)
    if (fields.price == null) {
      console.warn(`[ebay-listings] bulk-update ${sku}: no active listing row; falling back to blob listPrice`);
    }
    const payload = buildDiscPayload(disc, fields);

    const existing = await getInventoryItem(sku, headers);
    if (!existing) return res.json({ discId: disc.id, error: `No inventory item found for ${sku}` });

    const imageUrls = existing.product?.imageUrls || [];
    await putInventoryItem(sku, buildInventoryItemBody(payload, imageUrls), headers);

    const offer = await getOfferBySku(sku, headers);
    if (!offer) return res.json({ discId: disc.id, error: `No offer found for ${sku}` });

    await updateOffer(offer.offerId, {
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
    }, headers);

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

    const offerId = await upsertOffer({
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
    }, headers);

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

    const listingId  = offer.listing?.listingId;
    const listingRow = db.prepare('SELECT id, list_price FROM listings WHERE platform_listing_id = ?').get(String(listingId));

    db.prepare('UPDATE listings SET list_price = ? WHERE platform_listing_id = ?')
      .run(item.price, String(listingId));

    if (listingRow && Number(listingRow.list_price) !== Number(item.price)) {
      db.prepare(
        'INSERT INTO price_history (listing_id, old_price, new_price, source) VALUES (?, ?, ?, ?)'
      ).run(listingRow.id, listingRow.list_price, item.price, 'update-item');
    }

    res.json({ sku: item.sku, offerId: offer.offerId, listingId });
  } catch (e) {
    console.error('[ebay-listings] update-item error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
