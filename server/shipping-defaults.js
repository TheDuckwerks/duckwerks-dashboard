// server/shipping-defaults.js — per-category shipping_estimate defaults (#137)
// Grounded in shipped-label actuals (2026-07: discs avg $6.98 over 165 labels;
// comics/cards ~$6.20-6.97 media mail over 10; remaining non-disc avg $11.29,
// mostly music gear). Tune here, nowhere else.
const db = require('./db');

const CATEGORY_DEFAULTS = {
  'Disc Golf':          7,
  'Comics':             7,
  'Comics/Books/Media': 7,
  'Trading Cards':      7,
};
const FALLBACK = 11;

const catByItem = db.prepare(`
  SELECT c.name FROM items i LEFT JOIN categories c ON i.category_id = c.id WHERE i.id = ?
`);

function defaultShippingEstimate(itemId) {
  const cat = catByItem.get(itemId)?.name;
  return CATEGORY_DEFAULTS[cat] ?? FALLBACK;
}

module.exports = { defaultShippingEstimate };
