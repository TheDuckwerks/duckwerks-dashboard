// server/db.js — SQLite connection, schema, and seed data
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = new Database(path.join(DATA_DIR, 'duckwerks.db'));

// Enable foreign keys (off by default in SQLite)
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('wal_autocheckpoint = 1000');

// WAL accumulates while the process runs because the long-lived connection
// blocks auto-truncation. Checkpoint hourly to keep the WAL from bloating.
setInterval(() => {
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (_) {}
}, 60 * 60 * 1000);

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    fee_rate        REAL NOT NULL DEFAULT 0,
    fee_flat        REAL NOT NULL DEFAULT 0,
    fee_on_shipping INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT,
    badge_class TEXT
  );

  CREATE TABLE IF NOT EXISTS lots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    purchase_date TEXT,
    total_cost    REAL NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    lot_id      INTEGER REFERENCES lots(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    cost        REAL NOT NULL DEFAULT 0,
    notes       TEXT,
    sku         TEXT,
    status      TEXT NOT NULL DEFAULT 'Prepping'
                     CHECK(status IN ('Prepping', 'Listed', 'Sold')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS listings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    site_id             INTEGER NOT NULL REFERENCES sites(id),
    platform_listing_id TEXT,
    list_price          REAL,
    shipping_estimate   REAL,
    url                 TEXT,
    status              TEXT NOT NULL DEFAULT 'active'
                             CHECK(status IN ('active', 'sold', 'ended', 'draft')),
    listed_at           TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at            TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id         INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    platform_order_num TEXT,
    sale_price         REAL,
    date_sold          TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    carrier          TEXT,
    service          TEXT,
    tracking_id      TEXT,
    tracking_number  TEXT,
    tracker_url      TEXT,
    label_url        TEXT,
    shipping_cost    REAL,
    shipped_at       TEXT,
    tracking_status  TEXT,
    delivered_at     TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS flight_numbers (
    manufacturer_key TEXT NOT NULL,
    mold_key         TEXT NOT NULL,
    manufacturer     TEXT NOT NULL,
    mold             TEXT NOT NULL,
    speed            REAL,
    glide            REAL,
    turn             REAL,
    fade             REAL,
    stability        REAL,
    PRIMARY KEY (manufacturer_key, mold_key)
  );

  CREATE TABLE IF NOT EXISTS inventory (
    sku        TEXT PRIMARY KEY,
    location   TEXT,
    category   TEXT,
    status     TEXT NOT NULL DEFAULT 'intake'
               CHECK(status IN ('intake','listed','sold')),
    metadata   TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    old_price  REAL,
    new_price  REAL NOT NULL,
    source     TEXT
  );

  CREATE TABLE IF NOT EXISTS traffic_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ebay_listing_id TEXT NOT NULL,
    snapshot_date   TEXT NOT NULL,
    pulled_at       TEXT NOT NULL DEFAULT (datetime('now')),
    views           INTEGER,
    impressions     INTEGER,
    ctr             REAL,
    UNIQUE(ebay_listing_id, snapshot_date)
  );
`);

// ── Multi-unit listings — quantity columns (migration) ────────────────────────
['quantity', 'quantity_sold', 'oversold'].forEach(col => {
  const cols = db.pragma('table_info(items)').map(r => r.name);
  if (!cols.includes(col)) {
    const def = col === 'quantity' ? 'INTEGER NOT NULL DEFAULT 1'
              : 'INTEGER NOT NULL DEFAULT 0';
    db.prepare(`ALTER TABLE items ADD COLUMN ${col} ${def}`).run();
  }
});

// ── Inventory API migration — offer_id on listings ───────────────────────────
const listingCols = db.pragma('table_info(listings)').map(r => r.name);
if (!listingCols.includes('offer_id')) {
  db.prepare('ALTER TABLE listings ADD COLUMN offer_id TEXT').run();
}

// ── Realized fees — fees column on orders (migration, #136) ──────────────────
// Platform fee dollars for the order. NULL = legacy row not yet backfilled;
// 0 = genuinely fee-free (Reverb payout already net, cash sales).
const orderCols = db.pragma('table_info(orders)').map(r => r.name);
if (!orderCols.includes('fees')) {
  db.prepare('ALTER TABLE orders ADD COLUMN fees REAL').run();
}

// ── Tracker terminal state — freeze delivered shipments (migration, #160) ────
// tracking_status = last known EasyPost status; 'delivered' is terminal and
// removes the shipment from the live-poll set. delivered_at = delivery timestamp,
// used for the client's 3-day post-delivery grace in the In-Transit widget.
const shipmentCols = db.pragma('table_info(shipments)').map(r => r.name);
['tracking_status', 'delivered_at'].forEach(col => {
  if (!shipmentCols.includes(col)) {
    db.prepare(`ALTER TABLE shipments ADD COLUMN ${col} TEXT`).run();
  }
});

// ── Seed reference data (idempotent) ──────────────────────────────────────────

const seedSites = db.prepare(
  'INSERT OR IGNORE INTO sites (name, fee_rate, fee_flat, fee_on_shipping) VALUES (?, ?, ?, ?)'
);
const seedCategory = db.prepare(
  'INSERT OR IGNORE INTO categories (name, color, badge_class) VALUES (?, ?, ?)'
);

db.transaction(() => {
  seedSites.run('Reverb',     0.0819, 0.49, 0);
  seedSites.run('eBay',       0.136,  0.40, 0);
  seedSites.run('Facebook',   0,      0,    0);
  seedSites.run('Craigslist', 0,      0,    0);

  seedCategory.run('Music',    'var(--blue)',   'badge-music');
  seedCategory.run('Computer', 'var(--purple)', 'badge-comp');
  seedCategory.run('Gaming',   'var(--orange)', 'badge-gaming');
})();

module.exports = db;
