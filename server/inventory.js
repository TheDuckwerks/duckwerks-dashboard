// server/inventory.js — GET/POST/PATCH /api/inventory
const router              = require('express').Router();
const db                  = require('./db');
const { normalizeBlob }   = require('./inventory-schemas');
const { resolveDiscTitle } = require('./ebay-builders');

// Keep items.name (the canonical materialized title, #134) in sync when a disc's
// blob spec changes. Never touches a Sold item's name — that's history.
function rematerializeDiscName(sku, category, metadataJson) {
  if (category !== 'disc' || !metadataJson) return;
  const title = resolveDiscTitle(JSON.parse(metadataJson));
  db.prepare("UPDATE items SET name = ? WHERE sku = ? AND status <> 'Sold'").run(title, sku);
}

const getBySku = db.prepare('SELECT * FROM inventory WHERE sku = ?');
const listAll  = db.prepare(`
  SELECT inv.*,
         it.name               AS item_name,
         it.status             AS item_status,
         l.id                  AS listing_id,
         l.platform_listing_id AS ebay_listing_id,
         l.list_price          AS listing_price,
         l.listed_at           AS listed_at
  FROM   inventory inv
  LEFT JOIN items it   ON it.sku = inv.sku
  LEFT JOIN listings l ON l.item_id = it.id AND l.status = 'active'
  ORDER BY inv.created_at DESC
`);
const upsert   = db.prepare(`
  INSERT INTO inventory (sku, location, category, status, metadata)
  VALUES (@sku, @location, @category, @status, @metadata)
  ON CONFLICT(sku) DO UPDATE SET
    location = COALESCE(excluded.location, location),
    category = COALESCE(excluded.category, category),
    status   = COALESCE(excluded.status,   status),
    metadata = COALESCE(excluded.metadata, metadata)
`);
const patch    = db.prepare(`
  UPDATE inventory SET
    location = COALESCE(@location, location),
    category = COALESCE(@category, category),
    status   = COALESCE(@status, status),
    metadata = COALESCE(@metadata, metadata)
  WHERE sku = @sku
`);

function parseRow(r) {
  return { ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null };
}

// GET /api/inventory — list all, with optional ?ids=1-20,25 (disc numbers) or ?category=disc
router.get('/', (req, res) => {
  let rows = listAll.all();
  if (req.query.ids) {
    const ids = new Set();
    for (const seg of req.query.ids.split(',')) {
      const parts = seg.trim().split('-').map(Number);
      if (parts.length === 1) ids.add(parts[0]);
      else for (let i = parts[0]; i <= parts[1]; i++) ids.add(i);
    }
    rows = rows.filter(r => {
      const m = r.sku.match(/^DWG-(\d+)$/i);
      return m && ids.has(parseInt(m[1], 10));
    });
  }
  if (req.query.category) {
    rows = rows.filter(r => r.category === req.query.category);
  }
  if (req.query.excludeStatus) {
    // Lifecycle status lives on items.status now (#134 Phase 2); inventory.status
    // is a retired tombstone. Match case-insensitively (param 'sold' → 'Sold').
    const excluded = req.query.excludeStatus.split(',').map(s => s.toLowerCase());
    rows = rows.filter(r => !excluded.includes(String(r.item_status || '').toLowerCase()));
  }
  res.json({ inventory: rows.map(parseRow) });
});

// POST /api/inventory — upsert by SKU
router.post('/', (req, res) => {
  const { sku, location, category, status, metadata } = req.body;
  if (!sku) return res.status(400).json({ error: 'sku required' });
  upsert.run({
    sku,
    location: location ?? null,
    category: category ?? null,
    status:   status   ?? 'intake',
    metadata: metadata !== undefined ? JSON.stringify(metadata) : null,
  });
  res.json(parseRow(getBySku.get(sku)));
});

// GET /api/inventory/:sku
router.get('/:sku', (req, res) => {
  const row = getBySku.get(req.params.sku);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(parseRow(row));
});

// PATCH /api/inventory/:sku — partial update
router.patch('/:sku', (req, res) => {
  const { location, category, status, metadata } = req.body;
  const row = getBySku.get(req.params.sku);
  if (!row) return res.status(404).json({ error: 'not found' });
  let normalizedMeta = null;
  if (metadata !== undefined) {
    const existingMeta = row.metadata ? JSON.parse(row.metadata) : {};
    const merged = { ...existingMeta, ...metadata };
    normalizedMeta = JSON.stringify(normalizeBlob(category ?? row.category, merged));
  }
  patch.run({
    sku:      req.params.sku,
    location: location  ?? null,
    category: category  ?? null,
    status:   status    ?? null,
    metadata: normalizedMeta,
  });
  rematerializeDiscName(req.params.sku, category ?? row.category, normalizedMeta);
  res.json(parseRow(getBySku.get(req.params.sku)));
});

module.exports = router;
