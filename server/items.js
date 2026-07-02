// server/items.js — GET/POST/PATCH /api/items
const express = require('express');
const router  = express.Router();
const db      = require('./db');

// Build the full nested item response shape
function buildItem(row) {
  const category = row.category_id ? {
    id: row.category_id, name: row.cat_name,
    color: row.cat_color, badge_class: row.cat_badge
  } : null;

  const lot = row.lot_id ? { id: row.lot_id, name: row.lot_name } : null;

  // Fetch all listings for this item with site data
  const listingRows = db.prepare(`
    SELECT li.*, s.name as site_name, s.fee_rate, s.fee_flat, s.fee_on_shipping
    FROM listings li
    JOIN sites s ON s.id = li.site_id
    WHERE li.item_id = ?
    ORDER BY li.listed_at DESC
  `).all(row.id);

  const listings = listingRows.map(l => {
    const order = db.prepare('SELECT * FROM orders WHERE listing_id = ?').get(l.id);
    let orderObj = null;
    if (order) {
      const shipment = db.prepare('SELECT * FROM shipments WHERE order_id = ?').get(order.id);
      orderObj = {
        ...order,
        // Realized shipping is the shipment's actual cost only — never the listing
        // estimate (#137). Missing cost means no recorded label: subtract nothing.
        profit: order.sale_price - (order.fees ?? 0) - row.cost - (shipment?.shipping_cost ?? 0),
        shipment: shipment || null,
      };
    }
    return {
      id:                  l.id,
      item_id:             l.item_id,
      platform_listing_id: l.platform_listing_id,
      list_price:          l.list_price,
      shipping_estimate:   l.shipping_estimate,
      url:                 l.url,
      status:              l.status,
      listed_at:           l.listed_at,
      ended_at:            l.ended_at,
      site: {
        id:             l.site_id,
        name:           l.site_name,
        fee_rate:       l.fee_rate,
        fee_flat:       l.fee_flat,
        fee_on_shipping: l.fee_on_shipping,
      },
      order: orderObj,
    };
  });

  // Convenience top-level order/shipment (from the sold/active listing)
  const soldListing = listings.find(l => l.order);
  const order   = soldListing?.order   || null;
  const shipment = order?.shipment     || null;

  return {
    id: row.id, name: row.name, cost: row.cost,
    notes: row.notes, sku: row.sku, status: row.status, created_at: row.created_at,
    quantity:      row.quantity      ?? 1,
    quantity_sold: row.quantity_sold ?? 0,
    oversold:      row.oversold      ?? 0,
    category, lot, listings, order, shipment,
  };
}

// GET all items (optional filters: category, status, lot_id, since)
router.get('/', (req, res) => {
  const { category, status, lot_id, since } = req.query;

  const where = [];
  const params = [];

  if (category) { where.push('c.name = ?');        params.push(category); }
  if (status)   { where.push('i.status = ?');       params.push(status); }
  if (lot_id)   { where.push('i.lot_id = ?');       params.push(lot_id); }
  if (since)    { where.push('i.created_at >= ?');  params.push(since); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT i.*,
      c.name as cat_name, c.color as cat_color, c.badge_class as cat_badge,
      l.name as lot_name
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN lots l ON l.id = i.lot_id
    ${whereClause}
    ORDER BY i.created_at DESC
  `).all(params);
  res.json(rows.map(buildItem));
});

// POST create item
router.post('/', (req, res) => {
  const { name, category_id, lot_id, cost, notes, quantity } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const result = db.prepare(
    'INSERT INTO items (name, category_id, lot_id, cost, notes, quantity) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, category_id || null, lot_id || null, cost || 0, notes || null, qty);
  const row = db.prepare(`
    SELECT i.*, c.name as cat_name, c.color as cat_color, c.badge_class as cat_badge, l.name as lot_name
    FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN lots l ON l.id = i.lot_id
    WHERE i.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(buildItem(row));
});

// PATCH update item fields
router.patch('/:id', (req, res) => {
  const allowed = ['name', 'status', 'category_id', 'lot_id', 'cost', 'notes', 'quantity'];
  const sets = [], vals = [];
  allowed.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const row = db.prepare(`
    SELECT i.*, c.name as cat_name, c.color as cat_color, c.badge_class as cat_badge, l.name as lot_name
    FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN lots l ON l.id = i.lot_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(buildItem(row));
});

// DELETE item — cascades to listings, orders, shipments
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
