# eBay Bulk Listing — Design Spec
_2026-04-04_

## Goal

Create a pipeline for bulk-listing disc golf inventory on eBay from a CSV, without manual data entry on eBay's UI. The script runs on a Mac, proxies all eBay API calls and DB writes through the dashboard server, and writes results back to the source CSV. Idempotent — safe to re-run as new rows are priced and titled.

---

## Architecture

```
Mac (script)                        NUC (dashboard server)               eBay API
────────────────────────────────    ─────────────────────────────────    ────────────────
scripts/bulk-list-discs.js          POST /api/ebay/bulk-list
  reads CSV                     →    save photos → public/dg-photos/
  filters by --ids range              PUT  inventory_item/{sku}       →   create item
  sends disc data + photos            POST offer                      →   create offer
  skips sold rows                     POST offer/{id}/publish         →   go live
                                 ←    INSERT items + listings into DB
                                      return { discId, listingId, url }
```

Target API base is configurable: `--api http://localhost:3000` (dev, default) or `--api https://dash.duckwerks.com` (prod).

---

## Script: `scripts/bulk-list-discs.js`

### CLI flags

| Flag | Required | Description |
|---|---|---|
| `--csv` | yes | Path to duckwerks-dg-catalog.csv |
| `--photos` | yes | Path to directory containing DWG-*.jpg files |
| `--ids` | yes | Disc ID range to process, e.g. `--ids 1-20` |
| `--api` | no | API base URL (default: `http://localhost:3000`) |
| `--dry-run` | no | Validate CSV + photos, print plan, no listings created |

### Idempotency

Safe to re-run the same `--ids` range. DB writes are gated on `platform_listing_id` uniqueness; eBay deduplicates inventory items by SKU.

### Per-disc validation (skip with warning if any fail)

- `List Title` is non-empty
- `List Price` is a positive number
- At least one photo file matching `DWG-{id}-*.jpg` exists in `--photos` dir

### Output

```
[1/10] DWG-001  MVP Time-Lapse Simon Line...       listed  https://ebay.com/itm/123456
[2/10] DWG-002  MVP Time-Lapse Simon Line...       listed  https://ebay.com/itm/123457
[3/10] DWG-003  Axiom Hex Eclipse Lizzotle...      skipped — no List Price

Done: 9 listed, 1 skipped
```

---

## Server Route: `POST /api/ebay/bulk-list`

New file: `server/ebay-listings.js`, mounted at `/api/ebay` in `server.js`.

### Request format

`multipart/form-data`:
- `discs` — JSON string: array of disc objects (see field mapping below)
- `photos[DWG-001-1]`, `photos[DWG-001-2]`, etc. — photo file buffers

The script sends one disc at a time (not a full batch in one request) to keep payloads small and allow per-disc error reporting.

### Per-disc server flow

1. **Save photos** to `public/dg-photos/` — skip files already present (idempotent on re-run)
2. **Fetch fulfillment policies** (shipping, return, payment) — cached after first call per request
3. **PUT** `/sell/inventory/v1/inventory_item/DWG-{id}` — create/update inventory item
4. **POST** `/sell/inventory/v1/offer` — create offer with price + policies
5. **POST** `/sell/inventory/v1/offer/{offerId}/publish` — go live, returns `listingId`
6. **Insert** `items` row — skip if SKU already exists in DB
7. **Insert** `listings` row — skip if `platform_listing_id` already exists in DB
8. **Return** `{ discId, sku, listingId, url }`

### Error behavior

Errors on a single disc return `{ discId, error }` — server continues processing subsequent discs. Script logs the error and writes no URL for that row.

---

## eBay API: Field Mapping

### Inventory Item (`PUT /sell/inventory/v1/inventory_item/{sku}`)

| eBay field | Source |
|---|---|
| `product.title` | `List Title` (max 80 chars) |
| `product.description` | Auto-generated from Manufacturer, Mold, Type, Plastic, Run/Edition, Notes, Weight |
| `product.imageUrls[]` | `https://dash.duckwerks.com/dg-photos/DWG-{id}-{n}.jpg` |
| `product.aspects.Brand` | `Manufacturer` |
| `product.aspects.Model` | `Mold` |
| `product.aspects.Plastic Type` | `Plastic` |
| `product.aspects.Weight` | `Weight (g)` + `g` suffix (if set) |
| `condition` | `Unthrown` → `NEW` / `Some wear` or any other → `USED` |
| `availability.shipToLocationAvailability.quantity` | `1` |
| `sku` | `DWG-{zero-padded-3-digit-disc-id}` |

### Offer (`POST /sell/inventory/v1/offer`)

| eBay field | Source |
|---|---|
| `sku` | `DWG-{id}` |
| `marketplaceId` | `EBAY_US` |
| `format` | `FIXED_PRICE` |
| `listingPolicies.fulfillmentPolicyId` | From `/sell/account/v1/fulfillment_policy` |
| `listingPolicies.returnPolicyId` | From `/sell/account/v1/return_policy` |
| `listingPolicies.paymentPolicyId` | From `/sell/account/v1/payment_policy` |
| `pricingSummary.price.value` | `List Price` |
| `pricingSummary.price.currency` | `USD` |
| `categoryId` | eBay disc golf category (verify during implementation — approx. 26441) |
| `listingDescription` | Same as inventory item description |

---

## Photo Hosting

Photos are uploaded from the Mac to the server as multipart file fields. The server saves them to `public/dg-photos/` (permanently — serves as archive). File naming: `DWG-001-1.jpg` exactly as produced by the photo workflow.

The NUC serves `public/` as static files via Express, so photos are immediately accessible at `https://dash.duckwerks.com/dg-photos/DWG-001-1.jpg`. eBay fetches these URLs when the offer is published.

No EPS (eBay Picture Services / Trading API) is needed.

---

## DB Writes

### Pre-flight: Disc Golf category

On first run, check for a `Disc Golf` category in the `categories` table. If absent, insert:
- `name`: `Disc Golf`
- `color`: `#4ade80`
- `badge_class`: `badge-green`

Both inserts are gated on a single check: if `platform_listing_id` already exists in the `listings` table, skip both inserts entirely. This handles the crash-before-CSV-write edge case on re-run.

If the check passes (no existing record):

**`items` insert**

| Column | Value |
|---|---|
| `name` | `List Title` |
| `status` | `Listed` |
| `category_id` | Disc Golf category ID |
| `cost` | `0` (unknown at listing time) |

**`listings` insert**

| Column | Value |
|---|---|
| `item_id` | ID from items insert above |
| `site_id` | eBay site ID (looked up from `sites` table by name) |
| `list_price` | `List Price` from CSV |
| `platform_listing_id` | eBay listing ID returned by publish |
| `url` | `https://ebay.com/itm/{listingId}` |

---

## eBay Sync Compatibility

Since `platform_listing_id` is written at creation time, the eBay modal's "Link Listings" section will never surface these items as unlinked. "Awaiting Shipment" matching is also `platform_listing_id`-driven and will work automatically when orders come in. No risk of duplicate records on sync.

---

## Business Policies Pre-flight

The server fetches fulfillment, return, and payment policies from `/sell/account/v1/*_policy` on each `bulk-list` request (cached in memory for the duration of the request). If no policies exist, the route returns a clear error:

```json
{
  "error": "No eBay business policies found. Enable them at Seller Hub > Account > Business policies."
}
```

This surfaces on first `--dry-run` before any listings are created.

---

## Out of Scope

- Description templating beyond the auto-generated format (can be iterated later)
- Support for multiple quantities per SKU
- eBay category lookup UI (category ID hardcoded, verified once during implementation)
- Relisting / editing existing listings (separate feature)
- Dashboard UI for triggering bulk listing (follow-up ticket)
