// server/listings.js — POST/PATCH /api/listings
const express = require('express');
const router  = express.Router();
const db      = require('./db');

// POST create listing (also sets item.status = 'Listed')
router.post('/', (req, res) => {
  const { item_id, site_id, platform_listing_id, list_price, shipping_estimate, url, offer_id } = req.body;
  if (!item_id || !site_id) return res.status(400).json({ error: 'item_id and site_id are required' });
  const result = db.prepare(`
    INSERT INTO listings (item_id, site_id, platform_listing_id, list_price, shipping_estimate, url, offer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(item_id, site_id, platform_listing_id || null, list_price || null, shipping_estimate || null, url || null, offer_id || null);
  // Set item status to Listed
  db.prepare("UPDATE items SET status = 'Listed' WHERE id = ?").run(item_id);
  if (list_price) {
    db.prepare(
      'INSERT INTO price_history (listing_id, old_price, new_price, source) VALUES (?, NULL, ?, ?)'
    ).run(result.lastInsertRowid, list_price, 'mint');
  }
  res.status(201).json(db.prepare('SELECT * FROM listings WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH update listing
router.patch('/:id', (req, res) => {
  const allowed = ['site_id', 'platform_listing_id', 'list_price', 'shipping_estimate', 'url', 'status', 'ended_at', 'offer_id'];
  const sets = [], vals = [];
  allowed.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });

  const priceChanging = req.body.list_price !== undefined && req.body.list_price !== null;
  const before = priceChanging
    ? db.prepare('SELECT list_price FROM listings WHERE id = ?').get(req.params.id)
    : null;

  vals.push(req.params.id);
  db.prepare(`UPDATE listings SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  if (before && Number(before.list_price) !== Number(req.body.list_price)) {
    db.prepare(
      'INSERT INTO price_history (listing_id, old_price, new_price, source) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, before.list_price, req.body.list_price, 'patch');
  }

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'not found' });
  res.json(listing);
});

module.exports = router;
