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

// Resolve a disc's live price from its active listing row (issue #134). The
// listing row is the price authority once a disc is listed; the catalog blob's
// listPrice is intake staging only. Returns null when no active listing exists.
function resolveListingPrice(sku) {
  const row = db.prepare(`
    SELECT l.list_price
    FROM listings l
    JOIN items it ON it.id = l.item_id
    WHERE it.sku = ? AND l.status = 'active'
    ORDER BY l.id DESC
    LIMIT 1
  `).get(sku);
  return row ? row.list_price : null;
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

  db.prepare(
    'INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url) VALUES (?, ?, ?, ?, 7, ?)'
  ).run(itemId, ebaySite.id, String(listingId), listPrice, `https://ebay.com/itm/${listingId}`);
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

    dbWriteDiscListing(payload.title, payload.price, listingId, sku);

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
    const sku     = `DWG-${String(disc.id).padStart(3, '0')}`;
    const price   = resolveListingPrice(sku);   // listing row is authority once listed (#134)
    const payload = buildDiscPayload(disc, price != null ? { price } : {});
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
    const price   = resolveListingPrice(sku);   // listing row is authority once listed (#134)
    if (price == null) {
      console.warn(`[ebay-listings] bulk-update ${sku}: no active listing row; falling back to blob listPrice`);
    }
    const payload = buildDiscPayload(disc, price != null ? { price } : {});

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

    db.prepare('UPDATE listings SET list_price = ? WHERE platform_listing_id = ?')
      .run(item.price, String(offer.listing?.listingId));

    res.json({ sku: item.sku, offerId: offer.offerId, listingId: offer.listing?.listingId });
  } catch (e) {
    console.error('[ebay-listings] update-item error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
