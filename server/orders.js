// server/orders.js — POST/PATCH /api/orders
const express           = require('express');
const router            = express.Router();
const db                = require('./db');

// POST create order (sale received — also sets item.status = 'Sold' and listing.status = 'sold')
router.post('/', (req, res) => {
  const { listing_id, platform_order_num, sale_price, date_sold, quantity } = req.body;
  if (!listing_id) return res.status(400).json({ error: 'listing_id is required' });
  const result = db.prepare(`
    INSERT INTO orders (listing_id, platform_order_num, sale_price, date_sold)
    VALUES (?, ?, ?, ?)
  `).run(listing_id, platform_order_num || null, sale_price || null,
         date_sold || new Date().toISOString().split('T')[0]);
  // Update item and listing status
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
  if (listing) {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(listing.item_id);
    if (item) {
      if (item.quantity > 1) {
        const incomingQty = (Number.isInteger(quantity) && quantity > 0) ? quantity : 1;
        const newSold     = item.quantity_sold + incomingQty;
        const cappedSold  = Math.min(newSold, item.quantity);
        const oversold    = newSold > item.quantity ? 1 : 0;
        const newStatus   = cappedSold >= item.quantity ? 'Sold' : item.status;
        db.prepare(
          'UPDATE items SET quantity_sold = ?, oversold = ?, status = ? WHERE id = ?'
        ).run(cappedSold, oversold, newStatus, item.id);
        if (cappedSold >= item.quantity) {
          db.prepare("UPDATE listings SET status = 'sold', ended_at = datetime('now') WHERE id = ?").run(listing_id);
        }
      } else {
        db.prepare("UPDATE items SET status = 'Sold' WHERE id = ?").run(item.id);
        db.prepare("UPDATE listings SET status = 'sold', ended_at = datetime('now') WHERE id = ?").run(listing_id);
      }
    }
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
