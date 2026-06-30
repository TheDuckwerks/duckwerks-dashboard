# Analytics View — Design Spec
**Issues:** #53 (Analytics), #64 (Pending Feedback)
**Date:** 2026-03-27

---

## Overview

New top-level nav view: **Analytics**. Two tabs toggled by local state:
- **Listed** — listing performance stats (views, watchers, impressions, CTR) from Reverb and eBay
- **Sold** — sold orders with no buyer feedback yet, with direct platform order links

No new nav items beyond "Analytics." No buyer messaging in this iteration.

---

## Architecture

- **New file:** `public/v2/js/views/analytics.js` — `Alpine.data('analyticsView', ...)`
- **New routes in `server/ebay.js`:**
  - `GET /api/ebay/traffic` — wraps eBay Sell Analytics traffic report, last 30 days, per-listing breakdown
  - `GET /api/ebay/feedback` — wraps eBay Sell Feedback API, returns feedback received (type=BUYER, i.e. buyer left for seller)
  - `GET /api/ebay/orders/fulfilled` — wraps eBay Sell Fulfillment API filtered to FULFILLED orders (last 90 days)
- **Reverb:** uses existing generic proxy at `/api/reverb/*` — no new server routes needed
- **`index.html`:** add Analytics nav pill in sidebar; add analytics view container

Each tab fetches its data independently on first activation and caches results for the session (no auto-refresh). Fetches run in parallel within each tab. Client-side joins with `$store.dw.records` by `platform_listing_id` (listed tab) and `platform_order_num` (sold tab).

Toggle state: `activeTab: 'listed' | 'sold'` in `analyticsView` local state.

---

## Listed Tab

### Data Sources

**Reverb:** `GET /api/reverb/my/listings` — paginated, follows `_links.next.href`. Extracts per listing:
- `id` (platform_listing_id)
- `title`
- `stats.views`
- `stats.watches`

**eBay:** `GET /api/ebay/traffic` — new server route wrapping eBay Sell Analytics v1 `traffic_report` endpoint. Request: last 30 days, dimension = `LISTING_ID`. Extracts per listing:
- `listingId` (legacy item ID)
- page views
- watchers
- impressions (organic + store combined)
- CTR (clicks / impressions, expressed as %)

### Join

Both result sets joined with `$store.dw.records` by `platform_listing_id` to get local item name and category. Unmatched platform rows display the platform title only (no cost or category data).

### Columns

| Column | Reverb | eBay | Sortable |
|---|---|---|---|
| Item | ✓ | ✓ | ✓ |
| Site | ✓ | ✓ | ✓ |
| Views | ✓ | ✓ | ✓ |
| Watchers | ✓ | ✓ | ✓ |
| Impressions | — | ✓ | ✓ |
| CTR | — | ✓ | ✓ |

- Reverb rows show `—` for Impressions and CTR
- Default sort: Views desc
- Sort pattern same as existing `itemsView` / `lotsView` (`sortKey`, `sortDir`, `sortBy()`, `sortIndicator()`)

---

## Sold Tab

### Data Sources

**Reverb:** `GET /api/reverb/my/orders/selling` — paginated, all shipped/sold orders. Filter client-side for `needs_feedback_for_seller: true`. Extracts per order:
- `order_number` (platform_order_num)
- `title` (item name fallback)
- `created_at` (sale date)
- `_links.web.href` (order URL for buyer nudge link)

**eBay (fulfilled orders):** `GET /api/ebay/orders/fulfilled` — new server route wrapping eBay Sell Fulfillment v1, filter `orderfulfillmentstatus:{FULFILLED}`, last 90 days. Extracts per order:
- `orderId`
- `legacyOrderId`
- `creationDate`
- buyer `username`

**eBay (feedback received):** `GET /api/ebay/feedback` — new server route wrapping eBay Sell Feedback v1 `GET /feedback`, type=BUYER (feedback buyer left for seller). Returns list of `legacyOrderId` values with feedback.

### Cross-Reference (eBay)

Client-side: build a Set of `legacyOrderId` values from feedback response. Filter fulfilled orders to those whose `legacyOrderId` is NOT in the Set — these are orders missing buyer feedback. eBay order link: `https://www.ebay.com/mesh/ord/details?orderId={orderId}`.

### Join

Both result sets joined with `$store.dw.records` by `platform_order_num` for local item name. Falls back to platform order title if no match.

### Columns

| Column | Notes |
|---|---|
| Item | Local name or platform title |
| Site | Reverb / eBay badge |
| Sold Date | `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` |
| Days Since Sale | Computed from sale date to today |
| Order Link | External link to platform order page |

- Default sort: Days Since Sale desc (oldest first — most urgent)
- No feedback period filter in this iteration; show all pending feedback

---

## Sidebar Nav

Add "Analytics" pill between Lots and the Actions section (or after Lots — wherever it fits cleanly). Follows existing nav pill pattern: `@click="$store.dw.activeView = 'analytics'"`, active class on match.

---

## Out of Scope (this iteration)

- Buyer messaging / nudge buttons on either platform
- Feedback period filter (N days since delivery)
- Caching analytics data across sessions
- Reverb impression or CTR data (not available in listing stats)
