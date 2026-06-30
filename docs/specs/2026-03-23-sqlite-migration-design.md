# Design: Migrate Duckwerks from Airtable to SQLite

**Date:** 2026-03-23
**Status:** Draft — awaiting implementation plan
**Scope:** Replace Airtable as the data store with a local SQLite database. Clean up the schema, normalize entities, and set up the foundation for multi-site listings and analytics.

---

## Background

The dashboard was built on Airtable because it was the available tool at the time. The schema evolved organically — cryptic field IDs (`F.fieldId`), lots as derived text labels, site fees hardcoded in JS, and no real lifecycle tracking. With sub-100 records and a clear sense of the domain, this is the right moment to migrate to a local SQLite database, clean up the schema, and set up a foundation that supports multi-site listings and future analytics.

---

## Goals

- Replace Airtable with a local SQLite DB — no cloud dependency for inventory data
- Normalize the schema: lots, sites, categories, listings, orders, and shipments are all first-class entities
- Clean column names (no more cryptic Airtable field IDs)
- Capture full lifecycle timestamps so cycle time and analytics queries are possible
- Support items listed on multiple sites simultaneously
- Keep the migration small and auditable (sub-100 records, validate against Airtable online)

---

## Schema

Seven tables. No computed values stored — `profit` is always derived at query/display time.

```sql
-- Reference tables
CREATE TABLE sites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,       -- 'Reverb', 'eBay', 'Facebook', 'Craigslist'
  fee_rate        REAL NOT NULL DEFAULT 0,    -- decimal, e.g. 0.0819
  fee_flat        REAL NOT NULL DEFAULT 0,    -- flat per-transaction fee
  fee_on_shipping INTEGER NOT NULL DEFAULT 0, -- 1 if fee applies to (price + shipping)
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,  -- 'Music', 'Computer', 'Gaming'
  color      TEXT,                  -- CSS var or hex, e.g. 'var(--blue)'
  badge_class TEXT                  -- e.g. 'badge-music'
);

-- Core inventory
CREATE TABLE lots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  purchase_date TEXT,
  total_cost    REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  lot_id      INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  cost        REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'Prepping'
                   CHECK(status IN ('Prepping', 'Listed', 'Sold')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lifecycle
CREATE TABLE listings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  site_id             INTEGER NOT NULL REFERENCES sites(id),
  platform_listing_id TEXT,           -- Reverb/eBay listing ID
  list_price          REAL,
  shipping_estimate   REAL,           -- estimated shipping cost; used by estProfit() before a label is purchased
  url                 TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                           CHECK(status IN ('active', 'sold', 'ended', 'draft')),
  listed_at           TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at            TEXT
);

CREATE TABLE orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id          INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  platform_order_num  TEXT,
  sale_price          REAL,    -- post-fee payout (what we actually receive)
  date_sold           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shipments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier          TEXT,
  service          TEXT,
  tracking_id      TEXT,        -- EasyPost tracker ID
  tracking_number  TEXT,        -- human-readable tracking number
  tracker_url      TEXT,        -- public tracking URL
  label_url        TEXT,        -- stored for reprint access
  shipping_cost    REAL,
  shipped_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Seed data

```sql
-- Sites
INSERT INTO sites (name, fee_rate, fee_flat, fee_on_shipping) VALUES
  ('Reverb',     0.0819, 0.49, 0),
  ('eBay',       0.1325, 0.40, 1),
  ('Facebook',   0,      0,    0),
  ('Craigslist', 0,      0,    0);

-- Categories
INSERT INTO categories (name, color, badge_class) VALUES
  ('Music',    'var(--blue)',   'badge-music'),
  ('Computer', 'var(--purple)', 'badge-comp'),
  ('Gaming',   'var(--orange)', 'badge-gaming');
```

---

## Lifecycle model

An item moves through the following stages. Timestamps at each transition are captured in the relevant table row:

```
items.created_at     → entered inventory (Prepping)
listings.listed_at   → listed on a platform
listings.ended_at    → listing ended (sold, expired, or pulled)
orders.date_sold     → order received
shipments.shipped_at → label purchased / shipped
(delivered_at        → from EasyPost tracker, not stored in DB)
```

An item can have multiple listings (concurrent or sequential). Each listing can have at most one order. Each order can have at most one shipment (reprinting a label does not create a new shipment row — it updates `label_url`).

---

## Server layer

`server/airtable.js` is removed. A new `server/db.js` opens the SQLite connection and exports it. All route files import from `db.js`.

Driver: `better-sqlite3` (sync API — appropriate for a local personal tool with no concurrency concerns).

### New routes

```
GET    /api/items              all items, with active listing + latest order joined
POST   /api/items              create item (name, category_id, lot_id, cost, notes)
PATCH  /api/items/:id          update item fields

GET    /api/lots               all lots with item count + cost summary
POST   /api/lots               create lot
PATCH  /api/lots/:id           update lot fields

POST   /api/listings           create listing for an item
PATCH  /api/listings/:id       update listing (price, platform_listing_id, url, status)

POST   /api/orders             create order (listing sold)
PATCH  /api/orders/:id         update order (platform_order_num — used by Reverb Sync to save order number)
POST   /api/shipments          create shipment (label purchased)
PATCH  /api/shipments/:id      update shipment (tracking, label_url)

GET    /api/sites              all active sites
GET    /api/categories         all categories
```

`/api/config` is simplified — no longer returns `airtablePat`. Returns `shippingProvider` only.

### Response shape for GET /api/items

Each item comes back with all its listings, latest order, and latest shipment joined. `listings` is always an array (empty for Prepping items). `order` and `shipment` are null until the item sells/ships.

```json
{
  "id": 42,
  "name": "Fender Telecaster",
  "category": { "id": 1, "name": "Music", "color": "var(--blue)", "badge_class": "badge-music" },
  "lot": { "id": 3, "name": "Guitar Lot March" },
  "cost": 150.00,
  "status": "Listed",
  "created_at": "2026-03-01T10:00:00",
  "listings": [
    {
      "id": 17,
      "site": { "id": 1, "name": "Reverb", "fee_rate": 0.0819, "fee_flat": 0.49, "fee_on_shipping": 0 },
      "platform_listing_id": "abc123",
      "list_price": 299.00,
      "shipping_estimate": 15.00,
      "url": "https://reverb.com/...",
      "status": "active",
      "listed_at": "2026-03-05T14:00:00"
    }
  ],
  "order": null,
  "shipment": null
}
```

For sold items the `order` object includes `sale_price` and `date_sold`. The server also returns a derived `profit` field on the order object so the lot modal and analytics don't need to re-derive it client-side. SQL: `sale_price - item.cost - COALESCE(shipment.shipping_cost, 0)`. If no shipment exists yet (order created but label not purchased), `shipping_cost` is treated as 0 — meaning `profit` may read slightly optimistic until a label is purchased. This is intentional; it matches how `estProfit()` behaves for listed items.

```json
"order": {
  "id": 5,
  "platform_order_num": "R-ABC-1234",
  "sale_price": 265.00,
  "date_sold": "2026-03-20",
  "profit": 95.50
}
```

Fee config is included on each listing's `site` object so `estProfit()` in the store can use it directly without a separate `/api/sites` call.

**Note on `items.status`:** Item status (`Prepping`, `Listed`, `Sold`) is managed explicitly by the app — it is not automatically derived from listing/order state. The invariant is: set to `Listed` when the first listing is created, set to `Sold` when an order is created. `listings.status` is the authoritative record of platform-level listing state (active, ended, sold) and can differ from item status (e.g. an item can have an ended listing and still be `Listed` if it's being relisted).

**Note on Reverb Sync matching:** The Reverb Sync modal identifies Reverb items by checking `listing.site.name === 'Reverb'` and using `listing.platform_listing_id` for matching. No dedicated field is needed.

---

## Frontend store

`config.js` loses `BASE_ID`, `TABLE_ID`, and the entire `F{}` field map. `CAT_COLOR` and `CAT_BADGE` move to the categories seed data and are returned by `/api/categories`.

`store.js` changes:
- `fetchAll()` → calls `GET /api/items` and `GET /api/lots`; no pagination needed
- `updateRecord(id, fields)` → replaced with `updateItem(id, fields)`, `updateListing(id, fields)`, `updateShipment(id, fields)` etc.
- `createRecord(fields)` → replaced with `createItem(fields)`
- All `r.fields[F.fieldId]` accesses → replaced with `r.fieldName` (e.g. `r.name`, `r.cost`, `r.listing.list_price`)
- `str()` and `num()` helpers simplified or removed — plain field access replaces them
- `SITE_FEES` lookup → removed from store; fee config comes from `listing.site` in the response
- `estProfit()` updated: uses `shipment.shipping_cost` if shipment exists, else `listing.shipping_estimate`, else $10 placeholder; fee params read from `listing.site`. For items with multiple active listings, `estProfit()` uses the listing with the highest `list_price` (most optimistic estimate). For Prepping items with no listings, falls back to no fees and $10 shipping placeholder.

Views and modals update their field references to match the new flat shape.

---

## Add Item modal — UX flow

At creation, the Add Item form collects only:
- name (required)
- category (required)
- lot (optional)
- cost (required)
- notes (optional)

On save, instead of closing, the modal transitions to the item detail view for the newly created item. A prominent **"Add Listing"** button is shown. The user can either add a listing immediately (site, list price, platform listing ID, URL) or close and come back later. This supports end-to-end item creation → listed-on-site in a single session without navigation.

Estimated shipping is removed from Add Item (it was a workaround for the flat schema; it now lives on the listing or shipment row where it belongs).

---

## Migration script

`scripts/migrate-airtable-to-sqlite.js`

1. Fetch all records from Airtable via existing `/api/airtable` proxy (server must be running)
2. Seed `sites` and `categories` tables
3. Derive `lots` from unique lot-name strings; insert lot rows
4. Insert `items` rows — map `F.fieldId` values to clean column names; assign `lot_id` and `category_id` by lookup
5. Insert `listings` for records that have a site + list price. Set `listings.status = 'sold'` when `F.status === 'Sold'`, otherwise `'active'`. Map `F.shipping` to `shipping_estimate` (its original purpose; actual shipping cost migrates to `shipments.shipping_cost` in step 7).
6. Insert `orders` for records with a sale price / date sold. Map `F.reverbOrderNum` → `platform_order_num`.
7. Insert `shipments` for records with tracking data
8. Print validation report: row counts per table, 5 random item spot-checks

Migration is idempotent via `DROP TABLE IF EXISTS` + recreate, so it can be re-run safely during validation.

---

## Cutover

1. Run migration script → inspect validation report
2. Spot-check 10–15 items by comparing the SQLite output against the Airtable web UI
3. Start server with new SQLite routes; Airtable proxy is removed
4. Test full app flows: view items, add item, add listing, purchase label, mark shipped
5. Airtable base remains online (read-only reference) but is no longer written to

---

## Out of scope

- Shippo removal — can be done as a separate cleanup ticket after migration
- UI/UX improvements to listing/order flows beyond the Add Item modal change — file as P2 enhancements as they come up
- Multi-label per shipment (reprint updates `label_url` in place)
- Delivered-at persistence (stays in EasyPost tracker, fetched live)
