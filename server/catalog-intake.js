// server/catalog-intake.js — catalog intake routes (manufacturers, molds, plastics, disc save)
const router            = require('express').Router();
const db                = require('./db');
const { normalizeBlob } = require('./inventory-schemas');
const { resolveDiscTitle } = require('./ebay-builders');

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Item coupling (#134 Phase 2): every catalogued disc gets an items row at
// intake, so items.name is canonical from birth and listing is pure association.
const findItem       = db.prepare('SELECT id, status FROM items WHERE sku = ?');
const insertDiscItem = db.prepare(
  "INSERT INTO items (name, status, category_id, cost, lot_id, sku) VALUES (?, 'Prepping', ?, 0, 9, ?)"
);
const renameItem     = db.prepare('UPDATE items SET name = ? WHERE id = ?');

function discCategoryId() {
  let cat = db.prepare("SELECT id FROM categories WHERE name = 'Disc Golf'").get();
  if (!cat) {
    const r = db.prepare(
      "INSERT INTO categories (name, color, badge_class) VALUES ('Disc Golf', '#4ade80', 'badge-green')"
    ).run();
    cat = { id: r.lastInsertRowid };
  }
  return cat.id;
}

// Mint the items row (or re-materialize its name while still Prepping). Never
// touches status of a Listed/Sold disc — that lifecycle is owned downstream.
function upsertDiscItem(sku, blob) {
  const title    = resolveDiscTitle(blob);
  const existing = findItem.get(sku);
  if (!existing)                       insertDiscItem.run(title, discCategoryId(), sku);
  else if (existing.status === 'Prepping') renameItem.run(title, existing.id);
}

const lookupFlight = db.prepare(
  'SELECT speed, glide, turn, fade, stability FROM flight_numbers WHERE manufacturer_key = ? AND mold_key = ?'
);

const maxDiscNum = db.prepare(
  "SELECT MAX(CAST(SUBSTR(sku, 5) AS INTEGER)) as max FROM inventory WHERE sku LIKE 'DWG-%'"
);

const upsert = db.prepare(`
  INSERT INTO inventory (sku, location, category, status, metadata)
  VALUES (@sku, @location, 'disc', 'intake', @metadata)
  ON CONFLICT(sku) DO UPDATE SET
    location = excluded.location,
    metadata = excluded.metadata
`);

// GET /api/catalog-intake/next-disc-num
router.get('/next-disc-num', (req, res) => {
  try {
    const { max } = maxDiscNum.get();
    res.json({ nextDiscNum: (max || 0) + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog-intake/manufacturers
router.get('/manufacturers', (req, res) => {
  try {
    const rows = db.prepare('SELECT DISTINCT manufacturer FROM flight_numbers ORDER BY manufacturer').all();
    res.json({ manufacturers: rows.map(r => r.manufacturer).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog-intake/molds
router.get('/molds', (req, res) => {
  try {
    const { manufacturer } = req.query;
    const rows = manufacturer
      ? db.prepare('SELECT DISTINCT mold FROM flight_numbers WHERE manufacturer_key = ? ORDER BY mold').all(normalize(manufacturer))
      : db.prepare('SELECT DISTINCT mold FROM flight_numbers ORDER BY mold').all();
    res.json({ molds: rows.map(r => r.mold).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog-intake/plastics
router.get('/plastics', (req, res) => {
  try {
    const { manufacturer } = req.query;
    const rows = manufacturer
      ? db.prepare('SELECT plastic, tier FROM disc_plastics WHERE manufacturer_key = ? ORDER BY tier DESC, plastic').all(normalize(manufacturer))
      : db.prepare('SELECT DISTINCT plastic, tier FROM disc_plastics ORDER BY tier DESC, plastic').all();
    res.json({ plastics: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/catalog-intake/disc
router.post('/disc', (req, res) => {
  try {
    const { discNum, box, manufacturer, mold, type, plastic, run, notes, condition, weight, color, listPrice } = req.body;
    const flight   = lookupFlight.get(normalize(manufacturer), normalize(mold)) || {};
    const sku      = `DWG-${String(discNum).padStart(3, '0')}`;
    const blob     = normalizeBlob('disc', {
      manufacturer, mold, type, plastic,
      run:       run   || null,
      notes:     notes || null,
      condition,
      weight, color, listPrice,
      speed:     flight.speed     ?? null,
      glide:     flight.glide     ?? null,
      turn:      flight.turn      ?? null,
      fade:      flight.fade      ?? null,
      stability: flight.stability ?? null,
    });
    upsert.run({ sku, location: box || null, metadata: JSON.stringify(blob) });
    upsertDiscItem(sku, blob);
    res.json({ discNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/catalog-intake/refresh-titles?confirm=true
// Re-materialize items.name = resolveDiscTitle(blob) for every non-Sold disc
// (#134 Phase 4), after a generateDiscTitle template change. Overrides survive
// a template change for free without special-casing: resolveDiscTitle returns a
// non-null list_title verbatim, so an override disc's name only changes when the
// override does — never from a template edit. Returns the diff; writes only when
// confirm=true.
const refreshRows = db.prepare(`
  SELECT inv.sku, inv.metadata, it.id AS item_id, it.name AS current_name
  FROM inventory inv
  JOIN items it ON it.sku = inv.sku
  WHERE inv.category = 'disc' AND it.status <> 'Sold'
  ORDER BY inv.sku
`);
const refreshWrite = db.prepare('UPDATE items SET name = ? WHERE id = ?');

router.post('/refresh-titles', (req, res) => {
  try {
    const confirm = req.query.confirm === 'true';
    const changes = [];
    for (const r of refreshRows.all()) {
      const blob = r.metadata ? JSON.parse(r.metadata) : {};
      const next = resolveDiscTitle(blob);      // override verbatim, else generated
      if (next !== r.current_name) {
        changes.push({ sku: r.sku, from: r.current_name, to: next });
        if (confirm) refreshWrite.run(next, r.item_id);
      }
    }
    res.json({ confirm, count: changes.length, changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router };
