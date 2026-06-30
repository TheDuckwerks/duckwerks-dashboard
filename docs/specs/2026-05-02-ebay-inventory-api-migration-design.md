# eBay Inventory API Migration — Design Spec

## Goal

Migrate all eBay listings in the dashboard to eBay's Inventory API model so that SKU and offer ID are captured locally for every listing. This is the prerequisite for spec 2 (replacing Browse API with Inventory/Sell APIs).

## Background

New disc golf listings are already created via the Inventory API (bulk-list-discs.js) and have SKUs stored on the `items` table. However:
- The `listings` table has no `sku` or `offer_id` column
- Manually-created eBay listings (everything outside DG discs) have never been migrated to the Inventory model
- DG disc listings have SKUs on `items` but no `offer_id` anywhere
- The Browse API (buyer-facing) is used for listing sync — it doesn't expose seller quantity, offer state, or condition details

After this migration, every eBay listing in the DB will have a `sku` and `offer_id`, enabling spec 2 to replace the Browse API entirely.

## Data Model

**New column on `listings` table:**
```sql
ALTER TABLE listings ADD COLUMN sku TEXT;
ALTER TABLE listings ADD COLUMN offer_id TEXT;
```

Migration state is implicitly derivable:
- `sku IS NULL` → not yet migrated to Inventory API
- `sku IS NOT NULL AND offer_id IS NULL` → migrated (or created via Inventory API) but offer ID not yet captured
- `sku IS NOT NULL AND offer_id IS NOT NULL` → fully migrated

Note: `sku` on the `items` table (DG discs) is separate from `sku` on `listings`. The listings-level SKU is the eBay Inventory API SKU for that specific listing. They may differ for non-DG items where eBay auto-generates the SKU on migration.

## New API Routes (`server/ebay.js`)

### `POST /api/ebay/migrate-listing`

Accepts up to 5 legacy eBay listing IDs, calls `POST /sell/inventory/v1/bulk_migrate_listing`, returns SKU and offer ID per listing.

**Request:**
```json
{ "listingIds": ["168349612758", "168347256666"] }
```

**Response:**
```json
[
  { "listingId": "168349612758", "sku": "ebay-generated-sku", "offerId": "4**********", "error": null },
  { "listingId": "168347256666", "sku": null, "offerId": null, "error": "Not eligible for migration" }
]
```

Uses `getAccessToken()` (user token with `sell.inventory` scope — already present).

### `GET /api/ebay/offer?sku={sku}`

Wraps `GET /sell/inventory/v1/offer?sku={sku}`, returns the offer ID for a given SKU.

**Response:**
```json
{ "offerId": "4**********" }
```

Returns `{ offerId: null }` if no offer found. Used by the bulk script pass 2 to backfill offer IDs for DG disc listings that already have SKUs.

## Import Flow Change (`public/v2/js/views/sites.js` `importAll`)

When importing a new eBay listing (platform === 'eBay'):
1. Call `POST /api/ebay/migrate-listing` with `[listing.listingIdKey]`
2. If successful, add `sku` and `offer_id` to `listingFields` before calling `dw.createListing()`
3. If migration fails (eBay error), log a warning and continue — import still succeeds, listing created without SKU/offer ID

This is a single extra fetch per eBay listing import. Reverb imports are unaffected.

## `server/listings.js` Changes

- `POST /api/listings` — accept `sku` and `offer_id` in request body, insert into DB
- `PATCH /api/listings/:id` — add `sku` and `offer_id` to the `allowed` fields list

## Bulk Migration Script (`scripts/migrate-to-inventory-api.js`)

Two sequential passes, dry-run by default, `--confirm` to apply. Routes all eBay calls through the local server (`http://fedora.local:3000`) — no token management in the script itself.

### Pass 1 — Migrate listings with no SKU

```
SELECT id, platform_listing_id FROM listings
WHERE platform_listing_id IS NOT NULL
  AND sku IS NULL
```

- Chunk into groups of 5
- POST each chunk to `POST /api/ebay/migrate-listing`
- Dry-run: print `listing_id → sku, offer_id` (or error)
- Confirm: `UPDATE listings SET sku = ?, offer_id = ? WHERE id = ?`

### Pass 2 — Backfill offer IDs for listings with SKU but no offer ID

```
SELECT id, sku FROM listings
WHERE sku IS NOT NULL
  AND offer_id IS NULL
```

- For each listing, GET `/api/ebay/offer?sku={sku}`
- Dry-run: print `sku → offer_id` (or "not found")
- Confirm: `UPDATE listings SET offer_id = ? WHERE id = ?`

Both passes run in sequence in a single script invocation. Each reports its own count of found/migrated/errored. If pass 1 finds nothing it says so and proceeds to pass 2.

## What This Enables (Spec 2)

- Listing sync can call `GET /sell/inventory/v1/inventory_item/{sku}` instead of Browse API → gets real quantity
- Multi-unit import auto-detects quantity on sync (solves the towel problem)
- Order sync can call `POST /sell/inventory/v1/bulk_update_price_quantity` to keep eBay quantity in sync
- `offer_id` enables price/status updates via `PUT /offer/{offerId}` without needing the legacy Trading API

## Out of Scope

- Creating new eBay listings from the dashboard (future "listing creator")
- Replacing the Browse API sync flow (spec 2)
- Updating eBay quantity via `bulk_update_price_quantity` on order sync (spec 2)
- Any changes to how DG disc listings are created (bulk-list-discs.js unchanged)
