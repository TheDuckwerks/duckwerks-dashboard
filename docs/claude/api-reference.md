# API Reference — Duckwerks Dashboard

> Load this file when working on server routes, environment config, or database schema.

---

## Environment Variables (.env)

```
SHIPPING_PROVIDER=EASYPOST         # EASYPOST or SHIPPO
EASYPOST_TEST_MODE=false
EASYPOST_TEST_TOKEN=EZTK...
EASYPOST_LIVE_TOKEN=EZAK...
SHIPPO_TEST_MODE=false             # retained but inactive
SHIPPO_TEST_TOKEN=shippo_test_...
SHIPPO_LIVE_TOKEN=shippo_live_...
EBAY_CLIENT_ID=GeoffGos-duckwerk-PRD-...
EBAY_CLIENT_SECRET=PRD-...
EBAY_RUNAME=Geoff_Goss-GeoffGos-duckwe-qevlykrb
FROM_NAME=Geoff Goss, Duckwerks Music
FROM_STREET1=...
FROM_CITY=San Francisco
FROM_STATE=CA
FROM_ZIP=...
FROM_COUNTRY=US
FROM_PHONE=...
ANTHROPIC_API_KEY=sk-ant-...    # comp research — Claude analysis
SERPAPI_API_KEY=...              # comp research — eBay sold listings via SerpAPI
CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome  # Reverb Puppeteer scrape
ZEBRA_PRINTER_IP=192.168.1.50    # label print — Zebra ZD420D over raw TCP
ZEBRA_PRINTER_PORT=9100          # optional — defaults to 9100
```

## Shipping Provider Test vs Live
- `SHIPPING_PROVIDER=EASYPOST` or `SHIPPO` in `.env` — requires server restart
- `EASYPOST_TEST_MODE=true/false` — test labels don't count against quota (3000/month on live)
- `SHIPPO_TEST_MODE=true/false` — retained but Shippo is inactive; test labels count against 30/month quota
- Startup log shows active provider + mode, e.g. `Shipping provider: EASYPOST` / `EasyPost: mode=LIVE`

---

## Server API Endpoints

All credentials injected server-side from `.env` — never exposed to the browser.

**Adding a new integration:** create `server/yourapi.js`, add `app.use('/api/yourapi', require('./server/yourapi'))` in server.js.

**server.js** (root-level route, not a mounted router)
- `GET /api/config` — client bootstrap info. Returns `{ shippingProvider, hostname, environment }`, read from `.env`/OS at request time

**server/catalog.js** (mounted at `/api`)
- `GET /api/sites` — all sites
- `GET /api/categories` — all categories

**server/catalog-intake.js** (mounted at `/api/catalog-intake`) — DB-backed (SQLite), no Google Sheets
- `GET /api/catalog-intake/next-disc-num` — next sequential `DWG-NNN` number (from the `inventory` table)
- `GET /api/catalog-intake/manufacturers` · `/molds` · `/plastics` — lookup lists from `flight_numbers` / `disc_plastics`
- `POST /api/catalog-intake/disc` — upsert a disc: writes the `inventory` blob AND mints its `items` row (name materialized via `resolveDiscTitle`, status `Prepping`) — item coupled at intake (#134)
- `POST /api/catalog-intake/refresh-titles?confirm=` — re-materialize `items.name = resolveDiscTitle(blob)` for every non-Sold disc after a `generateDiscTitle` template change; dry-run unless `confirm=true`, returns the diff. CLI wrapper: `scripts/refresh-disc-titles.js` (run on the NUC)

**server/flight-numbers.js** (mounted at `/api/flight-numbers`)
- `GET /api/flight-numbers?manufacturer=&mold=` — flight-number lookup by normalized manufacturer/mold key. Returns `{ found: false }` or `{ found: true, speed, glide, turn, fade, stability }`

**server/inventory.js** (mounted at `/api/inventory`)
- `GET /api/inventory` — all inventory rows joined to item/listing state. Optional `?ids=1-20,25` (disc numbers, ranges or CSV), `?category=disc`, or `?excludeStatus=sold,...` (matched against `items.status`, case-insensitive)
- `GET /api/inventory/:sku` — single row
- `POST /api/inventory` — upsert by SKU. Body: `{ sku, location, category, status, metadata }` (`sku` required; omitted fields keep their prior value on conflict)
- `PATCH /api/inventory/:sku` — partial update; merges `metadata` rather than replacing it, then re-normalizes it via `normalizeBlob`. Also re-materializes `items.name` for disc categories via `resolveDiscTitle` (never touches a `Sold` item's name)

**server/items.js** (mounted at `/api/items`)
- `GET /api/items` — all items with nested listings, order, shipment, category, lot
- `POST /api/items` — create item. Body: `{ name, category_id, lot_id, cost, notes, quantity }` (`name` required; `quantity` defaults to 1)
- `PATCH /api/items/:id` — update item fields (`name`, `status`, `category_id`, `lot_id`, `cost`, `notes`, `quantity`)
- `DELETE /api/items/:id` — delete item; cascades to its listings, orders, shipments

**server/lots.js** (mounted at `/api/lots`)
- `GET /api/lots` — all lots with an item-count summary (`item_count`, `items_sold`, `items_listed`, `items_prepping`)
- `POST /api/lots` — create lot. Body: `{ name, purchase_date, total_cost, notes }` (`name` required)
- `PATCH /api/lots/:id` — update lot fields (`name`, `purchase_date`, `total_cost`, `notes`)
- `DELETE /api/lots/:id` — delete lot; 409 if it still has items

**server/listings.js** (mounted at `/api/listings`)
- `POST /api/listings` — create listing; auto-sets item status=Listed. Body: `{ item_id, site_id, list_price, shipping_estimate, url, platform_listing_id }`
- `PATCH /api/listings/:id` — update listing fields (`site_id`, `platform_listing_id`, `list_price`, `shipping_estimate`, `url`, `status`, `ended_at`)

**server/orders.js** (mounted at `/api/orders`)
- `POST /api/orders` — create order; auto-sets item status=Sold
- `PATCH /api/orders/:id` — update order fields

**server/shipments.js** (mounted at `/api/shipments`)
- `POST /api/shipments` — create shipment record
- `PATCH /api/shipments/:id` — update shipment fields (tracking_id, tracking_number, tracker_url, shipping_cost, label_url)

**server/label.js** (mounted at `/api/label`)
- `POST /api/label/rates` — create shipment, return sorted rates. Body: `{ toAddress, parcel }` (parcel weight in decimal lbs)
- `POST /api/label/purchase` — purchase a rate, return tracking + label URL. Body: `{ rateObjectId }`. EasyPost encodes `shipmentId|rateId` in `rateObjectId` — transparent to client
- `GET /api/label/tracker/:id` — proxies EasyPost tracker by ID; returns tracker object with status, carrier, tracking_details, etc.
- `GET /api/label/usage` — Shippo-only usage counter; returns `{ skipped: true }` when on EasyPost
- Carrier/service name maps: `CARRIER_NAMES`, `SERVICE_NAMES` in `server/label.js` — add entries there when new raw codes appear

**server/print.js** (mounted at `/api/print`)
- `POST /api/print/label` — fetches the ZPL from `{ url }` (the EasyPost ZPL label) and writes it over a raw TCP socket to the Zebra ZD420D at `ZEBRA_PRINTER_IP:ZEBRA_PRINTER_PORT` (default 9100); returns 503 if `ZEBRA_PRINTER_IP` is unset
- `GET /api/print/status` — `{ configured, ip, port }`
- Frontend (`store.printLabel(zplUrl, fallbackUrl)`) tries the ZPL print first, then falls back to opening the PDF label in a new tab if the printer is unreachable

**server/comps.js** (mounted at `/api/comps`)
- `POST /api/comps/search` — fetch raw sold listings. Body: `{ items: [{ name, sources, minPrice, notes, searchQuery }] }`. `sources`: `'ebay'`, `'reverb'`, or `'ebay,reverb'`. Returns `{ results: [{ name, hints, listings: [...] }] }`
- `POST /api/comps/analyze` — send listings to Claude for analysis. Body: `{ item: { name, hints, listings: [...] } }`. Returns `{ name, analysis, csv }`

**server/shippo.js** (mounted at `/api/shippo` — generic proxy only)
- `POST /api/shippo/:path` — generic Shippo proxy
- `GET /api/shippo/:path` — generic Shippo proxy
- `testMode` read from `.env` server-side — do not send from client

**server/reverb.js** (mounted at `/api/reverb`)
- `GET /api/reverb/*` — proxies to Reverb API with auth
- `POST /api/reverb/*` — proxies to Reverb API with auth

### eBay Listing Pipeline — do not reinvent

Listing creation and update live entirely in `ebay-listings.js` (routes) + `ebay-client.js` (Inventory API primitives: `putInventoryItem`, then `upsertOffer`, then `publishOffer`) + `ebay-builders.js` (category payload builders, e.g. `buildDiscPayload`). A new route should never call the eBay Inventory API directly; extend a builder instead.

The pipeline is a deliberate two-mode split. The **inventory-backed** path (`bulk-list`, `bulk-update`, `bulk-preview`, `bulk-photos`) runs a disc's inventory blob through `buildDiscPayload` in `ebay-builders.js`, which returns `{ title, description, specLines, condition, price, minOffer, categoryId, aspects }`; the route separately resolves `sku` (`DWG-{id}`) and photo URLs and hands everything to the shared Inventory API primitives. The **session-backed** path (`list-item`, `update-item`) takes a pre-built payload from a list-item skill checkpoint, shaped as `{ sku, title, price, ebayCategoryId, ebayConditionId, description, aspects, photos: [{ base64, filename }], minOffer, conditionNotes }`, and calls the same primitives directly (no builder). The two payload shapes use different field names for category and condition (`categoryId`/`condition` vs `ebayCategoryId`/`ebayConditionId`), and only the skill path carries `sku`/`photos` on the payload itself; the two modes converge on the same three Inventory API calls, not on one literal shared object type.

**server/ebay.js** (mounted at `/api/ebay`)
- `GET /api/ebay/auth` — redirects to eBay OAuth consent page (one-time setup)
- `POST /api/ebay/auth/exchange` — exchanges auth code for tokens
- `GET /api/ebay/orders` — orders awaiting fulfillment (`NOT_STARTED|IN_PROGRESS`); `?filter=sold` switches to `FULFILLED|IN_PROGRESS`
- `GET /api/ebay/orders/:id` — single order (buyer address + `paymentSummary.totalDueSeller` payout)
- `POST /api/ebay/orders/:id/tracking` — push tracking; marks order shipped, triggers payout flow. Body: `{ lineItemIds, trackingNumber, shippingCarrierCode }`
- `GET /api/ebay/listings` — all active seller listings via the Browse API (app token, no user OAuth). Requires `EBAY_SELLER_USERNAME` in `.env`. Returns `{ listings: [{ title, legacyItemId, price, watchCount, quantityAvailable }] }`
- `POST /api/ebay/migrate-listing` — migrate up to 5 legacy listings to the Inventory API model. Body: `{ listingIds: string[] }` (max 5). Returns `[{ listingId, sku, offerId, error }]`
- `GET /api/ebay/offer?sku=` — look up the offer ID for an inventory SKU. Returns `{ offerId }`
- `POST /api/ebay/traffic` — 30-day rolling traffic report (Sell Analytics API), batched 200 listing ids per request. Body: `{ listingIds: string[] }`. Returns `{ listings: { [listingId]: { views, impressions, ctr } } }`
- `GET /api/ebay/fulfilled-orders` — all FULFILLED orders from the last 60 days (paginated, filtered server-side since eBay's `{FULFILLED}` filter syntax is unreliable). Returns `{ orders }`

**server/ebay-listings.js** (mounted at `/api/ebay`) — the listing creation/update surface; see the pipeline note above
- `POST /api/ebay/bulk-list` — mint a disc listing from an inventory blob + photos. Body: multipart, `disc` (JSON field) + photo files, or no files if photos are already staged in `dg-photos/` via `bulk-list-photos`
- `POST /api/ebay/bulk-list-photos` — upload a photo pile, chunk N-per-disc across an ascending list of disc ids, write to `dg-photos/DWG-{id}-{n}.jpeg`. Body: multipart files + `perDisc` (int) + `discIds` (JSON array). Returns `{ mapping, totalFiles, leftover }`; re-uploading for a disc clears its prior photos
- `GET /api/ebay/photo-status` — photo count per disc id from `dg-photos/`, drives the catalog list-readiness badge. Returns `{ counts: { "<id>": n } }`
- `POST /api/ebay/bulk-photos` — replace photos on an already-listed disc without touching the offer. Body: multipart `disc` (JSON) + photo files (`photos[...]` fields)
- `POST /api/ebay/bulk-preview` — dry-run title/description/price for a disc, no eBay calls. Body: `{ disc }`. Returns `{ title, price, autoDecline, description }`
- `POST /api/ebay/bulk-update` — push title/price/description changes to an existing disc listing. Body: `{ disc }`. Title and price come from `items.name` / `listings.list_price` (the canonical fields, #134), not the blob
- `POST /api/ebay/list-item` — mint a one-off listing from a list-item skill checkpoint. Body: `{ sku, title, price, ebayCategoryId, ebayConditionId, description, aspects, photos: [{ base64, filename }], minOffer, conditionNotes }` (`sku`/`title`/`price`/`ebayCategoryId`/`ebayConditionId` required)
- `POST /api/ebay/update-item` — update an existing one-off listing from a skill checkpoint. Body: `{ sku, price, title?, description?, aspects?, ebayConditionId?, conditionNotes?, minOffer?, ebayCategoryId? }` (`sku`/`price` required)

**eBay OAuth notes:**
- Tokens stored in `data/ebay-tokens.json` (gitignored, lives in the persistent `data/` dir, survives deploys). Access token auto-refreshes every 2hr; refresh token lasts 18 months.
- Re-auth: visit `/api/ebay/auth`, complete sign-in, land on `duckwerks.com/ebay-oauth-callback.php` (external page, not in this repo), copy code, run the displayed curl command against `POST /api/ebay/auth/exchange` (body `{ code }`).
- Credential rotation (a new refresh token, or a scope change) requires the full OAuth dance above; there is no way to rotate `ebay-tokens.json` without it.
- eBay carrier codes: `USPS`, `UPS`, `FEDEX`, `DHL` (mapped from EasyPost names in `server/ebay.js`)
- `totalDueSeller` (`paymentSummary.totalDueSeller` on `GET /api/ebay/orders/:id`) is the **post-fee payout**, equivalent to Reverb's `direct_checkout_payout` (verified 2026-07-01 against Seller Hub: `pricingSummary.total` 17.00, `totalDueSeller` 14.39, fees 2.61). Available pre-fulfillment. It is what the ship flow stores as `sale_price`; the pre-fee buyer-paid total is `pricingSummary.total`.

---

## SQLite Schema

DB location: `data/duckwerks.db`

- `items` — core inventory ledger: name (**canonical materialized title**, #134), status (`Prepping`/`Listed`/`Sold` — the sole lifecycle owner), cost, category_id, lot_id, sku, quantity, quantity_sold, oversold (multi-unit listings; `quantity` defaults to 1, `oversold` flips to 1 if an order pushes `quantity_sold` past `quantity`)
- `listings` — platform listings per item: site_id, list_price (**price authority once listed**, #134), shipping_estimate, url, platform_listing_id, offer_id, status
- `inventory` — category intake blob keyed by sku: `metadata` JSON (disc specs + `list_title` title-spec + `listPrice` staging), location, category. `status` is a **retired tombstone** — lifecycle lives on `items.status` (#134)
- `orders` — sale data: listing_id, sale_price, date_sold, platform_order_num, fees. **`sale_price` is the post-fee seller payout** (eBay: `totalDueSeller` split per line item; Reverb: `direct_checkout_payout`) — platform fees are already out of it, so never subtract a formula fee from a realized number (that double-counts, the #136 trap). `fees` defaults to 0 and exists for manual correction. There is no stored `profit` column; realized profit is computed per request (see Profit Formulas below)
- `shipments` — shipping data: order_id, carrier, service, tracking_id, tracking_number, tracker_url, label_url, shipping_cost
- `sites` — platform lookup: name, fee_rate, fee_flat, fee_on_shipping
- `categories` — category lookup: name, color, badge_class
- `lots` — lot groupings: name, purchase_date, total_cost, notes
- `flight_numbers` — disc flight-number lookup keyed by (manufacturer_key, mold_key): manufacturer, mold, speed, glide, turn, fade, stability. Served by `GET /api/flight-numbers`
- `disc_plastics` — disc plastic-tier lookup keyed by (manufacturer_key, plastic): manufacturer, tier (`Premium`/`Baseline`). Created and seeded by `scripts/seed-plastics.js`, not in the main `db.js` schema block

### Data-Model Invariants

- Cascade rules: `listings.item_id`, `orders.listing_id`, `shipments.order_id` are `ON DELETE CASCADE`; `items.lot_id`, `items.category_id` are `ON DELETE SET NULL`.
- One order per listing, one shipment per order is an application invariant, not a database constraint (there is no `UNIQUE` on `orders.listing_id` or `shipments.order_id`). A label reprint `PATCH`es the existing `shipments` row's `label_url`; it never inserts a new shipment.
- SKU is write-once: not in the `items` `PATCH` allowlist, no UI edit field. Reassignment requires deliberate DB surgery (intentional friction, per the disc-sku-storage spec).
- Zero is an assertion, NULL is an absence. A stored 0 in a money column (`items.cost`, `lots.total_cost`, `orders.fees`, `shipments.shipping_cost`) means genuinely zero (personal-collection items, payout-stored prices, free shipping) and is never a gap to backfill. NULL means never captured. Do not "fix" zeros. (Calibration example: the DG lot's costs are 0 on purpose; the discs predate the business.)
- Lot costing is per-item: a purchased lot's basis is amortized onto `items.cost` via the lot modal's REALLOCATE COSTS. `lots.total_cost` is vestigial (0 everywhere); rollups effectively always sum item costs.

### Profit Formulas

Two profit numbers exist and are not directly comparable.
- **Realized** (`order.profit`, computed in `server/items.js` `buildItem()`, not a stored column): `sale_price - fees - items.cost - shipping_cost`, where shipping_cost is the shipment's cost if shipped, otherwise the listing's `shipping_estimate`, otherwise 0 (the estimate fallback on shipped items is #137). Because `sale_price` is the post-fee payout, `fees` is normally 0 and the result is genuine take-home; never add a formula fee on top.
- **Estimated** (`estProfit()` in `public/v2/js/store.js`, for `Listed` items): `list_price - cost - shipping - fee`, where shipping falls back from shipment cost to listing estimate to a $7 placeholder, and fee is computed from the listing's `sites.fee_rate`/`fee_flat` (`fee_on_shipping` decides whether shipping is folded into the fee base).

This asymmetry (realized profit ignores fees, estimated profit subtracts them) is the mechanism behind #136.
