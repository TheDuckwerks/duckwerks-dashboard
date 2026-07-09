# Frontend Reference: Duckwerks Dashboard

> Load this file when working on Alpine views, modals, CSS, or frontend architecture.

---

## Alpine Architecture

### Core Conventions
- **Store** (`Alpine.store('dw', {...})`) is the single source of truth for shared data: records, lots, categories, sites, loading state, active view/modal, active record id.
- **Views** (`Alpine.data('xyzView', ...)`) read shared data from `$store.dw.*`. View-scoped data that isn't part of the shared store (comp search results, traffic stats, catalog form lookups, live order/listing fetches in `sitesView`) is fetched directly in the view component.
- **Modals** (`Alpine.data('xyzModal', ...)`) follow the same split: shared data from the store; modal-scoped calls (label rates/purchase in `labelModal`, order detail fetches) made directly. Open/close state managed via `$store.dw.activeModal`, `activeRecordId`, `activeLotName`.
- **No imports.** Files loaded via `<script src>` in order in index.html.
  Load order: config.js → notifications.js → store.js → sidebar.js → sortable.js → views/* → modals/* → Chart.js CDN → charts.js

### File Structure
```
public/v2/
  index.html              ← shell: layout, CDN scripts, view + modal containers
  css/
    main.css              ← design tokens, sidebar, layout grid
    components.css        ← badges, pills, stat cards, tables, modal overlays
  js/
    config.js              ← constants (CAT_BADGE, CAT_COLOR, APP_VERSION)
    notifications.js       ← DwNotifications, order-check browser permission + polling
    store.js                ← Alpine.store('dw'), all data, helpers, modal state
    sidebar.js               ← Alpine.data('sidebar'), search + nav state
    sortable.js              ← window.dwSortable, shared localStorage sort-state utility
    charts.js                ← Alpine.data('chartsSection'), Chart.js dashboard momentum chart
    views/
      dashboard.js          ← Alpine.data('dashView')
      items.js              ← Alpine.data('itemsView')
      lots.js               ← Alpine.data('lotsView')
      analytics.js          ← Alpine.data('analyticsView'), Listed/Sold traffic tabs
      comps.js               ← Alpine.data('compsView'), comp research UI
      catalog.js              ← Alpine.data('catalogView'), disc intake form + inventory list
      sites.js                 ← Alpine.data('sitesView'), orders, combine-ship, link listings, listing-detail sync
    modals/
      item-modal.js           ← Alpine.data('itemModal')
      add-modal.js             ← Alpine.data('addModal')
      lot-modal.js              ← Alpine.data('lotModal')
      label-modal.js            ← Alpine.data('labelModal'), shipping label flow
      shipping-modal.js         ← Alpine.data('shippingModal'), in-transit tracking
      multi-unit-modal.js       ← Alpine.data('multiUnitModal'), per-unit sale progress for quantity > 1 items
```

### Data Layer
- `$store.dw.records[]`: all inventory items, fetched on init
- `$store.dw.lots[]`: all lot records, fetched on init
- `$store.dw.categories[]` / `$store.dw.sites[]`: reference data, fetched on init alongside records/lots
- `$store.dw.trackingData{}`: shared tracker cache keyed by `tracking_id`, populated by `loadTrackers()` (fired from `fetchAll`). Delivered shipments seed from stored fields via `storedTracker()`; only in-flight ones poll EasyPost. All views read it through `store.trackerFor(shipment)` — they don't fetch trackers themselves (#160)
- `$store.dw.fetchAll()`: re-call after any write that affects displayed data
- `CAT_COLOR` / `CAT_BADGE` in `config.js`: category display config (CSS color var + badge class), keyed by category name; matches server seed data

---

## Fee & Profit Math

Platform fees are DB-driven off the `sites` table (`fee_rate`, `fee_flat`, `fee_on_shipping`). There is no hardcoded per-site table. `siteFee(site, price, ship)` on the store is the single fee formula; `estProfit()` and `payout()` build on it, resolving the site from the item's `activeListing()`. `lot-modal.js` and the `items`/`lots` sort keys call these store methods directly rather than reimplementing them.

Those are estimates for listed items (yellow). Realized numbers never use the formula: `orders.sale_price` is the post-fee payout (eBay `totalDueSeller` split, Reverb `direct_checkout_payout`), so `orders.fees` is normally 0 and both the server-computed `order.profit` and the momentum chart in `charts.js` read the stored column instead of recomputing. Applying `siteFee()` to a realized sale double-counts (the #136 trap).

---

## Design System

- Dark theme, `Space Mono` body, `Bebas Neue` large numbers
- CSS vars: `--green`, `--yellow`, `--red`, `--blue`, `--purple`, `--orange`, `--muted`, `--surface`, `--border`, `--border2`, `--ebay`, `--reverb`, `--white`
- `--white: #f0f0f0` is primary text/high-contrast, defined in `main.css :root`
- Color semantics: yellow = estimate/pending, green = actual/positive, red = cost/negative, blue = action

---

## Views

| View | Default filters | Notes |
|---|---|---|
| Dashboard | none | KPIs, lot recovery table, recently sold |
| Items | Status: Listed, Site: All | Daily driver: inline status edit, EAF payout column |
| Lots | All lots | Click row → Lot Detail modal |
| Analytics | none | Listed/Sold tabs: traffic (views, impressions, CTR) via eBay Analytics API |
| Comps | none | Comp research pipeline: search raw listings, analyze with Claude (see Comp Research View) |
| Catalog | Status: ALL | Disc intake form (DB-backed) + inventory list with status filter (ALL / INTAKE / LISTED) and inline eBay bulk-list/photo/price tools |
| Sites | none | Primary order-fulfillment surface: orders + combine-ship, link listings, listing-detail diff/sync (see Sites View) |

### Sort Architecture
`sortable.js` exports `window.dwSortable`, a shared localStorage-backed sort-state utility keyed per view (`dw_sort_<view>`):
- `dwSortable.load(view, defaultCol, defaultDir)`: call once in `init()`; seeds `sortKey`/`sortDir` from localStorage or the given defaults
- `dwSortable.save(view, col, dir)`: call at the end of `sortBy(key)`, after computing the new col/dir

This is the canonical pattern for any new sortable table, used by `itemsView`, `lotsView`, `analyticsView`, and `compsView`. Each view keeps its own `sortKey`/`sortDir`/`sortBy(key)`/`sortGlyph(key)` (returns `'↕'`, `'↑'`, or `'↓'`); `dwSortable` only persists the `(col, dir)` pair.

The catalog inventory table (`catalogView.invSortKey`/`invSortDir`) is the one holdout: local state that resets on reload instead of going through `dwSortable`. Moving it onto the shared utility is tracked under #153.

Table header markup pattern:
```html
<th class="sortable" :class="{'sort-active': sortKey==='x'}" @click="sortBy('x')">Label<span x-text="sortGlyph('x')"></span></th>
```

Defaults: Items `createdTime` desc, Lots `name` asc, Analytics `views` desc, Comps `sold_price` desc.

**Date formatting convention**: `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` → `"Mar 15"`. Style: `color:var(--muted); white-space:nowrap`. Always first column.

### Items View: Filter Architecture
Three independent filter axes, all applied in `itemsView.rows` getter:

| Filter | Lives in | Default |
|---|---|---|
| `statusFilter` | `itemsView` local state | `'Listed'` |
| `siteFilters` | `itemsView` local state | `[]` (empty = no site filter) |
| `categoryFilter` | `$store.dw` | `null` (= no filter) |

**Navigating with filters**: use `$store.dw.navToItems(status, category, site)`. Sets `pendingFilters` on the store (single object so watcher always fires); `itemsView` consumes it on next tick. Unspecified args default to `'All'`/`null`, so every navigation is a clean slate.

**Rule:** clicking any status or site pill clears `categoryFilter`. Pills represent complete filter state; never silently combine with a hidden category filter.

**Item modal drill-down**: Status, Category, and Site badges are clickable and call `navToItems()`. Lot field calls `openModal('lot', null, lotName)`.

---

## Sidebar

- **ADD ITEM** → opens Add modal
- **Quick Find**: live search against `$store.dw.records` in memory (no API calls)
  - Results: Items (→ Item modal), Lots (→ Lot modal), Categories (→ Items view filtered)
  - Sold items shown dimmed, not hidden
  - Keyboard: `/` or `cmd+k` focuses; ↑/↓ navigates; Enter selects

---

## Modal Patterns

### Modal Back-Navigation
- `store.previousModal`: stashes `{ type, recordId, lotName }` before opening a child modal
- `closeModal()` restores previous modal if set, then clears it
- Used by lot modal's `openItem()` so Close returns to the lot
- `navToItems()` clears `previousModal` before closing to prevent unintended restores
- Lot modal escape handler guarded with `activeModal === 'lot'` check to prevent double-fire

### Label Modal: Ship Workflow
- Weight input is lbs + oz (combined as `lbs + oz/16` for API)
- On open: fetches the Reverb or eBay order to auto-fill shipping address
- On label purchase: auto-fires `markShipped()`/`markShippedEbay()` + `saveShipping()` immediately; don't wait for a button click
- `saveShipping()` writes shipping cost + status=Sold + dateSold + sale price + tracking for every affected record; `dw.createShipment()` (new shipment) calls `fetchAll()` internally, `dw.updateShipment()` (existing shipment) does not
- Sale price: Reverb uses `order.direct_checkout_payout` (post-fee) with fallback to `order.amount_product.amount`; eBay splits `order.paymentSummary.totalDueSeller` proportionally across line items by discounted line total (`_fetchOrderGroup()`)
- `date_sold`: uses `platformSaleDate` (from Reverb `created_at` / eBay `creationDate`) with fallback to today
- `activeReverbOrderNum` / `activeEbayOrderId` / `activeEbayOrderGroups`: store fields set by the Sites view before opening the label modal; cleared on read in `_open()`

**Combine-ship (eBay only)**: the Sites view groups 2+ selected same-address orders into `$store.dw.activeEbayOrderGroups` (`combineSelectedEbay()` in sites.js); the label modal builds one `orderGroups[]` entry per order via `_fetchOrderGroup()` (resolves line items, per-item sale price, address, order date), and one label covers every record across every group.
- `markShippedEbay()` pushes the same tracking number to **every order** in the group (`POST /api/ebay/orders/:id/tracking`), so none flag as unshipped
- `saveShipping()` amortizes the label's total cost evenly across every record in every group (`Math.floor(totalCost / n * 100) / 100` per record), with the rounding remainder added to the **first** record

**Insurance toggle**: `insureEnabled` defaults to `false` when the item's category is "Disc Golf" (case-insensitive match, set in `_open()`), `true` otherwise. Unchecked, `/api/label/purchase` omits the `insurance` field from the request body entirely rather than sending `0`.

**Ship queue (eBay + Reverb)**: the Sites view builds `$store.dw.labelQueue` (one entry per selected order: `{type:'ebay',orderId,lineItemIds,recs}` / `{type:'reverb',orderNum,rec}`, `queueSelectedOrders()` in sites.js) and opens the label modal on the first entry. Each entry is its own label — no same-address requirement, unlike combine-ship.
- The result step's NEXT LABEL button (`nextInQueue()`) shifts the next entry, stages it via `dw.openLabelEntry()`, and re-runs `_open()` in place — the modal never closes mid-queue, so the modal-close → `fetchOrders` refetch fires once, at the end
- NEXT is disabled while `queueBusy` (save/notify writes from the previous label still in flight — `_open()` would reset state under them)
- `parcel` (weight/dims/type) is deliberately not reset by `_open()`, so package data carries across queue steps; address, insurance, rates, and messages reset per entry
- `labelQueueTotal` drives the "label N of M" header line; `closeModal()` clears both fields, so closing mid-queue abandons the rest

### Shipping Modal: In Transit
- Shows sold+tracked items not yet delivered, or delivered within last 3 days
- Membership lives in `store.isInTransit(r)` — a pure function of stored shipment fields (`tracking_status`/`delivered_at`), no live data needed; update the window there, not in each view (#160)
- Tracker data is shared: dashboard, items, and this modal all read `$store.dw.trackingData` (see Data Layer) rather than fetching independently
- `deliveredAt` extracted from EasyPost `tracking_details` event with `status === 'delivered'`
- EasyPost test mode uses historical fake delivery dates, so items may disappear immediately after delivery; expected behavior

---

## Sites View

The primary order-fulfillment surface (`sites.js` / `sitesView`). Three sections, each independently fetched:

- **Orders**: `fetchOrders()` pulls eBay + Reverb orders awaiting shipment and matches them to local records by `platform_listing_id`. SHIP opens the label modal (`openEbayShip()` / `openReverbShip()`). eBay orders sort by buyer name so same-buyer orders cluster.
  - **Combine & ship**: select 2+ eBay orders (`orderSel`); `combineReady` requires every selected order to share one normalized shipping-address key (buyer name + address line 1 + postal code). `combineSelectedEbay()` builds `$store.dw.activeEbayOrderGroups` and opens the label modal once for the whole group.
  - **Ship queue**: the same checkboxes (plus `reverbSel` on Reverb rows) feed `queueSelectedOrders()` — one label per order, stepped inside the modal via `$store.dw.labelQueue` (see Label Modal → Ship queue). Available from 1+ selected, any addresses.
- **Listings**: `fetchListings()` diffs live eBay/Reverb listings against locally-linked `platform_listing_id`s to find unlinked ones. **Link** an unlinked listing to an existing local record (`linkSelections` dropdown, `saveLinks()`), or **import** it as a brand-new item + listing (`importAll()`, with optional lot/category assignment).
- **Listing Details**: `fetchDetails()` computes name/price diffs between local records and live listings; `syncAllDetails()` applies the selected changes.
  - Listings are fetched with full pagination (Reverb: follows `_links.next.href`)
  - Any write that updates fields visible elsewhere calls `dw.fetchAll()` before re-diffing, so the store is fresh going into the next check

### Reverb Order `_links`
When a Reverb order is opened for shipping (Sites view `openReverbShip()` → label modal), the order's `_links` object drives the ship flow in `label-modal.js`:
- `_links.ship.href`: direct href, POST to mark the order shipped (`markShipped()`)
- `_links.packing_slip.web.href`: public reverb.com URL, opened directly (no proxy needed)
- `order.direct_checkout_payout`: post-fee seller payout; `order.amount_product.amount` is pre-fee, used as fallback
- `order.shipping_address`: buyer address, auto-fills the label modal's address field

`sites.js` uses `_links` differently, for its own listing fetches: `_fetchAllReverbListings()` follows `_links.next.href` for pagination, and a newly-imported listing stores `raw._links.web.href` as its URL.

---

## Comp Research View

Two-step pipeline: **search** raw listings → **analyze** with Claude.

**Entry points:**
- Direct nav: sidebar "Comps" pill → empty form
- From item modal: "Research Comps" → `store.navToComp(r)` → populates `store.pendingComp` → `compsView.init()` pre-fills on next tick

**`store.navToComp(r)` pre-fill logic:**
- `name`: first segment of `r.name` before ` - `
- `notes`: remainder after ` - `
- `sources`: inferred from item's active listing site; falls back to `'ebay'`
- `minPrice`: 60% of current list price

**Search** (`POST /api/comps/search`):
- eBay: SerpAPI `engine=ebay`, `show_only=Sold`, optional `_udlo` (min price). Up to 50 results.
- Reverb: Puppeteer + stealth plugin scrape of `reverb.com/marketplace?show_only_sold=true`. First page only (~20-30 listings). Requires `CHROME_PATH` in `.env`.
- Both sources parallel per item; items parallel across each other.

**Analyze** (`POST /api/comps/analyze`):
- Sends listings to Claude (`claude-sonnet-4-6`). System prompt from `docs/gear-comp-research.md`. Changing that doc changes AI behavior.
- Response parsed into `ANALYSIS:` paragraph + `CSV:` fenced block.
- Sequential (not parallel) to avoid rate limits.

---

## Adding a New View

Four touch points, none of which alone is enough. `sites.js` (`sitesView`) is the cleanest working template (self-contained state, one `init()` wiring `$watch`es off `$store.dw.activeView`/`activeModal`, view-scoped fetches kept local to the component).

1. **Partial**: add `public/v2/partials/views/<name>.html` (root element `x-show="$store.dw.activeView === '<name>'"`, `x-data="<name>View"`), and add its `<!-- partial: views/<name> -->` placeholder to the view container in `index.html` (index.html:165-171). `assembleHTML()` in `server.js` inlines partials into the shell at request time via the `PARTIAL_RE` regex; no build step.
2. **Component**: add `public/v2/js/views/<name>.js`, registering `Alpine.data('<name>View', () => ({...}))` on `alpine:init`.
3. **Script tag**: add `<script src="js/views/<name>.js"></script>` to the load order in `index.html` (index.html:200-206), after `sortable.js`/`sidebar.js` and before the modal scripts.
4. **Rail link**: add a `.rail-link` button to the sidebar (index.html:82-109) that sets `$store.dw.activeView = '<name>'`.

**Persistence (easy to miss)**: `store.js`'s `init()` only restores `activeView` from `localStorage` for views in an explicit whitelist (`dashboard`, `items`, `lots`, `analytics`). A new view needs adding to that list if it should survive a page reload; otherwise it silently falls back to `dashboard` on next load.

---

## Debugging Alpine Issues

- **Always ask for browser console output** first. Alpine expression errors give exact expression + element.
- Alpine expression errors crash reactivity for that binding; symptoms can look unrelated to root cause.

**Common pitfalls:**
- `x-if="!someGetter"` renders when getter returns false for null state; guard: `x-if="record && !someGetter"`
- Direct property access in templates (`record.fields[x]`) throws if object is null; use `record?.fields?.[x]` or `x-show="record"` outer guard
- `x-show` hides elements but Alpine still evaluates all bound expressions; only `x-if` prevents evaluation
- `Alpine.effect(() => { ... })` works inside `Alpine.store` init() for reactive side effects
- `x-for="(item, i) in list"`: use when you need the loop index in template expressions
- For hard-to-reproduce bugs: add `console.log` inside store methods or `init()` hooks, ask Geoff to trigger and share output
