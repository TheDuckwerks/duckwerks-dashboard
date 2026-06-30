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

**server/catalog.js** (mounted at `/api`)
- `GET /api/sites` — all sites
- `GET /api/categories` — all categories

**server/catalog-intake.js** (mounted at `/api/catalog-intake`)
- `GET /api/catalog-intake/next-disc-num` — returns next sequential disc number from Google Sheet
- `GET /api/catalog-intake/manufacturers` — unique manufacturer list from sheet column F
- `POST /api/catalog-intake/disc` — appends a new disc row to the Google Sheet
- Requires service account key at `docs/handicaps-244e5d936e6c.json` (not an env var)
- Sheet ID: `1Gmdw2qcHRA_9wz29CXul3pTCT92pX56V4FPLkrhNnHE`, tab: `duckwerks-dg-catalog`

**server/items.js** (mounted at `/api/items`)
- `GET /api/items` — all items with nested listings, order, shipment, category, lot
- `POST /api/items` — create item. Body: `{ name, category_id, lot_id, cost, notes }`
- `PATCH /api/items/:id` — update item fields (`name`, `status`, `category_id`, `lot_id`, `cost`, `notes`)

**server/lots.js** (mounted at `/api/lots`)
- `GET /api/lots` — all lots with nested items
- `POST /api/lots` — create lot. Body: `{ name }`

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

**server/ebay.js** (mounted at `/api/ebay`)
- `GET /api/ebay/auth` — redirects to eBay OAuth consent page (one-time setup)
- `POST /api/ebay/auth/exchange` — exchanges auth code for tokens
- `GET /api/ebay/orders` — orders awaiting fulfillment (`NOT_STARTED|IN_PROGRESS`)
- `GET /api/ebay/orders/:id` — single order (buyer address + `pricingSummary.totalDueSeller` payout)
- `POST /api/ebay/orders/:id/tracking` — push tracking; marks order shipped, triggers payout flow

**eBay OAuth notes:**
- Tokens stored in `data/ebay-tokens.json` (gitignored). Access token auto-refreshes every 2hr; refresh token lasts 18 months.
- Re-auth: visit `/api/ebay/auth`, complete sign-in, land on `duckwerks.com/ebay-oauth-callback.php`, copy code, run the displayed curl command.
- eBay carrier codes: `USPS`, `UPS`, `FEDEX`, `DHL` (mapped from EasyPost names in `server/ebay.js`)
- `totalDueSeller` = post-fee seller payout (equivalent to Reverb's `direct_checkout_payout`)

---

## SQLite Schema

DB location: `data/duckwerks.db`

- `items` — core inventory: name, status, cost, category_id, lot_id
- `listings` — platform listings per item: site_id, list_price, shipping_estimate, url, platform_listing_id
- `orders` — sale data: listing_id, sale_price, profit, date_sold, platform_order_num
- `shipments` — shipping data: item_id, tracking_id, tracking_number, label_url, shipping_cost
- `sites` — platform lookup: name, fee_rate, fee_flat, fee_on_shipping
- `categories` — category lookup: name, color, badge_class
- `lots` — lot groupings: name
