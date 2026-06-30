# Disc SKU Storage & Display — Design Spec
**Issue:** ringleader3/duckwerksdash#93
**Date:** 2026-04-10

## Problem

eBay bulk listings are created with `DWG-XXX` SKUs via the Inventory API, but the SKU is never persisted to the local SQLite DB. This means:
- No way to look up which physical disc to grab when shipping
- No SKU visible in the label modal or item modal
- Reconciling eBay sales reports (which include SKU) against local records requires manual lookup

## Design

### 1. Schema — add `sku` column to `items`

Add `sku TEXT` to the `items` table in two places:

- **`server/db.js`** `CREATE TABLE IF NOT EXISTS items` block — so fresh DBs have the column from day one
- **`scripts/backfill-skus.js`** — runs `ALTER TABLE items ADD COLUMN IF NOT EXISTS sku TEXT` at startup before any data operations

SKU is **write-once and immutable**:
- Not included in the `allowed` patch list in `server/items.js` — the normal item edit API cannot update it
- No UI edit field, ever — renders read-only only
- Written in exactly two places: the backfill script (one-time) and the bulk-list INSERT (ongoing)

### 2. Backfill script — `scripts/backfill-skus.js`

One-time script run manually on the NUC. Handles schema migration + data backfill in a single command.

**Flow:**
1. `ALTER TABLE items ADD COLUMN IF NOT EXISTS sku TEXT` — noop if column already exists
2. `GET /sell/inventory/v1/inventory_item?limit=200` (paginated) — fetch all eBay inventory items
3. For each SKU, `GET /sell/inventory/v1/offer?sku=` → extract `listing.listingId`
4. Match `listingId` → `listings.platform_listing_id` → `item_id`
5. `UPDATE items SET sku = ? WHERE id = ? AND sku IS NULL` — only writes if empty

**Flags:**
- Default: dry-run — prints what would be written, no DB changes
- `--confirm`: commits updates to DB

**Non-match reporting (both directions):**
- eBay SKU with no matching local `platform_listing_id` → logged as "eBay has SKU DWG-042, no local listing found"
- Local items in the Disc Golf lot/category with no `sku` after the run → logged as "item #47 'Innova Destroyer' has no SKU"

The second list is the most actionable — after `--confirm`, any remaining unmatched DG items are real discrepancies worth investigating.

### 3. Forward path — write SKU at bulk-list time

`server/ebay-listings.js` already computes `const sku = \`DWG-${...}\`` at line 309. The `INSERT INTO items` just needs `sku` added to its column list. One-line change.

### 4. API — expose `sku` in item responses

`server/items.js` already returns `notes` and other fields in the row mapping. Add `sku: row.sku` to the same shape. No new endpoint needed.

### 5. Display

**Item modal** (`public/v2/js/modals/item-modal.js` + corresponding HTML):
- Show SKU as a read-only badge near the item name
- Only renders if `record.sku` exists — non-DG items show nothing

**Label modal** (`public/v2/js/modals/label-modal.js` + corresponding HTML):
- Show SKU prominently at the top alongside `itemName`
- Purpose: "go grab DWG-042 off the shelf before you ship"
- Only renders if `record.sku` exists

## What This Is Not

- No SKU editing UI
- No manual SKU assignment for non-bulk-listed items
- No changes to the eBay API flow beyond saving the SKU on INSERT
- No support for re-assigning a SKU to a different item (would require direct DB surgery — intentional friction)

## Enforcement

The constraint is architecturally self-enforcing: a SKU only exists if an item went through the sheet → bulk-list API → eBay pipeline. Items manually listed on eBay won't have a local DB record, so there's nothing to attach a SKU to.
