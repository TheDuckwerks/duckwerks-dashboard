# Codebase Map — Duckwerks Dashboard

> File-by-file roles for the server and frontend. Regenerate / correct this when you add or move a file — it's a reference, not a contract. Endpoint details live in [`api-reference.md`](api-reference.md); Alpine architecture in [`frontend-reference.md`](frontend-reference.md).

## Server

- `server.js` — Express entry point: mounts routers, serves static, redirects `/` → `/v2`
- `server/db.js` — opens SQLite db via better-sqlite3; shared across all routers
- `server/catalog.js` — `/api/sites`, `/api/categories`
- `server/catalog-intake.js` — `/api/catalog-intake/*` — disc intake (manufacturers, molds, plastics, disc save) + `refresh-titles`; DB-only. Disc save mints the `items` row alongside the `inventory` blob (item coupled at intake, #134)
- `server/items.js` — `/api/items` CRUD
- `server/lots.js` — `/api/lots` CRUD
- `server/listings.js` — `/api/listings` CRUD
- `server/orders.js` — `/api/orders` CRUD
- `server/shipments.js` — `/api/shipments` CRUD
- `server/label.js` — provider-agnostic label routes (`/api/label/*`)
- `server/print.js` — label print (`POST /api/print/label`) → raw TCP socket to Zebra ZD420D at `ZEBRA_PRINTER_IP:9100`
- `server/comps.js` — comp research (`/api/comps/*`) — SerpAPI + Puppeteer + Claude
- `server/reverb.js` — Reverb proxy (`/api/reverb/*`)
- `server/ebay-auth.js` — eBay OAuth (one-time setup + auto-refresh)
- `server/ebay.js` — eBay Sell Fulfillment + Inventory API (`/api/ebay/*`); includes `POST /api/ebay/migrate-listing` and `GET /api/ebay/offer`
- `server/ebay-client.js` — shared eBay API plumbing (headers, policies, EPS upload, inventory item PUT/GET, offer upsert/update/publish)
- `server/ebay-builders.js` — disc payload builder (`buildDiscPayload`), title resolver (`resolveDiscTitle` = `list_title` override else `generateDiscTitle`), description renderers; add new category builders here. `buildDiscPayload(blob, {title, price})` — route passes canonical title (`items.name`) + price (listing row), #134
- `server/ebay-listings.js` — eBay listing routes: `bulk-list`, `bulk-list-photos` + `photo-status` (disk-backed photo staging, #139), `bulk-photos`, `bulk-preview`, `bulk-update`, `list-item`, `update-item`; thin handlers only. The catalog's web bulk-list UI (#139) is the primary listing path; `scripts/bulk-list-discs.js` is the secondary CLI path (`--photos-only` batches, scripted runs)
- `server/inventory.js` — local inventory CRUD (`GET /api/inventory`, `GET /api/inventory/:sku`, `PATCH /api/inventory/:sku`); `GET /api/inventory` LEFT JOINs items+listings to return `item_name`, `item_status`, `listing_id`, `ebay_listing_id`, `listing_price` per row. PATCH re-materializes `items.name` from the blob for non-Sold disc rows (#134)
- `server/flight-numbers.js` — flight number lookup (`GET /api/flight-numbers?manufacturer=X&mold=Y`) from the `flight_numbers` reference table, keyed on normalized manufacturer/mold strings
- `server/inventory-schemas.js` — canonical per-category inventory blob schemas (`SCHEMAS.disc`); `normalizeBlob()` overlays a blob onto its schema so every key is present, missing values null
- `server/shippo.js` — Shippo shipping proxy (`/api/shippo/*`): `GET /usage` (30-day label count against the free-tier limit), `POST /rates`, `POST /purchase`, plus a generic authenticated GET/POST passthrough for other Shippo endpoints

## Scripts

- `scripts/db.sh` — sanctioned SQLite access (sqlite3 CLI against the NUC db; never `node -e`). See [GOTCHAS](../../GOTCHAS.md#database-sqlite)
- `scripts/deploy.sh` — deploy to the NUC (Duck Ops rsync-artifact standard): ship committed tree → `npm ci` on NUC → symlink state → atomic swap → PM2 reload → health check. See [`../deploy.md`](../deploy.md)
- `ecosystem.config.js` (repo root) — PM2 process definition (`duckwerks`, fork, `:3000`, cwd = `/srv/duckwerks/dash/current`)
- `scripts/deploy-nuc.sh` — **retired** (old git-pull flow); superseded by `deploy.sh`
- `scripts/bulk-list-discs.js` — bulk eBay lister; idempotent (safe to re-run)
- `scripts/README.md` — index of all active scripts with usage examples
- `data/ebay-tokens.json` — eBay OAuth tokens (never commit)

> `scripts/archive-grabber/` was extracted out of dashboard per issue #118; it now lives under `/Users/Shared/duckwerks/projects/duckwerks-media/archive-grabber/`.

## Frontend

- `public/v2/index.html` — app shell with `<!-- partial: views/foo -->` and `<!-- partial: modals/foo -->` comment placeholders; server assembles the final HTML at request time by inlining partials (see `server.js` `assembleHTML()`)
- `public/v2/partials/views/` — view HTML partials (dashboard, items, lots, analytics, comps, catalog, sites)
- `public/v2/partials/modals/` — modal HTML partials (item, add, lot, label, shipping, multi-unit)
- `public/v2/js/config.js` — constants: `CAT_BADGE`, `CAT_COLOR`, `SITE_FEES`, `APP_VERSION`
- `public/v2/js/notifications.js` — browser push notification module: permission, 5-min order poller, delta tracking; test page at `/push-test`
- `public/v2/js/store.js` — `Alpine.store('dw')` — all data, helpers, modal state; includes `trafficMap: {}` (session cache of `{ [legacyListingId]: { views, impressions, ctr } }`) and `trafficLoading: bool` — populated by whichever view loads first (analytics or catalog)
- `public/v2/js/sidebar.js` — search + nav state
- `public/v2/js/charts.js` — `chartsSection` Alpine component (dashboard); builds the Chart.js momentum chart (3d/7d/14d/30d net vs. cost+fees, per-site stacked bars with a hero overlay)
- `public/v2/js/sortable.js` — `window.dwSortable`, shared localStorage-backed column sort state (`load`/`save` per view); catalog's table uses its own non-persisting local sort instead, a divergence to watch for when copying its pattern
- `public/v2/js/views/` — Alpine component definitions for each view
  - `analytics.js` — fetches eBay traffic via `POST /api/ebay/traffic`; uses `TOTAL_IMPRESSION_TOTAL` (includes promoted); writes result into `$store.dw.trafficMap` for sharing
  - `catalog.js` — DG intake form + inventory list; `loadTraffic()` reads `trafficMap` if already populated, otherwise fetches and writes it; `sortedInventory` getter sorts by any column incl. traffic metrics; drives the web bulk-list UI (#139) via `POST /api/ebay/bulk-list` + `bulk-list-photos`
  - `sites.js` — Sites view: eBay + Reverb order fetch/combine-ship, unlinked-listing import/link (`POST /api/ebay/migrate-listing`), live-vs-local detail diff and sync
- `public/v2/js/modals/` — Alpine component definitions for each modal (item, add, lot, label, shipping, multi-unit)
  - `multi-unit-modal.js` — per-order breakdown for multi-quantity items: remaining units, recovered/realized/forecasted profit, progress bar
