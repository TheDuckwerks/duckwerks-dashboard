# Multi-Listing Per Item — Design Spec
**Date:** 2026-03-30
**Status:** Approved

## Overview

Support multiple active listings per item (e.g., same item listed on Facebook Marketplace AND Craigslist simultaneously). The 1:many schema (items → listings) already exists. This is purely a UI/UX change to expose what the data model already supports.

Primary use case: local cash sales on FB + CL where there is no API sync — all listing management is manual.

---

## Data Layer

**No schema changes required.** `item.listings[]` is already fetched as an array per item.

### Store helper changes

- `siteLabel(r)` — currently returns the first active listing's site name. Change: if item has >1 active listing, return `'Multiple'`.
- `activeListing(r)` — unchanged. Still returns the first active listing. Used for price display on single-listing items; not relied upon for multi-listing items.

### Site filter logic (items view)

Change from exact-match (`siteLabel(r) === siteFilter`) to contains-match: filter passes if the item has **any** active listing on the selected site. A multi-listing item (FB + CL) appears under the Facebook filter, the Craigslist filter, AND All. `siteLabel` returning `'Multiple'` is display-only and does not affect filter behavior.

---

## Add Item Modal

Replace the single site dropdown with checkboxes — one per site (loaded from `$store.dw.sites`). Shown only when status = "Listed".

- One shared `list_price` field
- One shared `shipping_estimate` field (FB/CL local pickup → $0)
- `platform_listing_id` and `url` left blank at creation — filled in later from item modal

On submit: POST /api/items → loop POST /api/listings once per checked site, all with the same price/shipping.

If status is not "Listed", no site checkboxes shown (same as today).

---

## Items View — Site Badge

- Add `badge-multiple` CSS class (neutral/muted color — no single platform color applies)
- `siteLabel` returning `'Multiple'` automatically flows through to badge rendering — no other items view changes needed

---

## Item Modal — Listings Mini-Table

Replace the single listing section with a small inline table.

**Columns:** Site | Status | URL / Listing ID | Action

**Display mode:**
- Site: existing site badge (badge-ebay, badge-reverb, badge-facebook, etc.)
- Status: badge showing `active`, `sold`, or `ended`
- URL: truncated link if set, muted dash if not
- Action: **Mark Sold** button — shown only on `active` rows

**Edit mode:**
- `url` and `platform_listing_id` become text inputs per row
- Price and shipping remain item-level fields (shared across listings)

### Mark Sold flow

Clicking **Mark Sold** on an active listing row expands that row inline:

```
[badge-facebook] [active] [facebook.com/...] Sale price: [_____] [Confirm] [Cancel]
```

On Confirm:
1. PATCH `/api/listings/:id` → `status='sold'`
2. PATCH all other active listings for this item → `status='ended'`, `ended_at=now`
3. POST `/api/orders` → `{ listing_id, sale_price }` (no platform_order_num required for FB/CL)
4. PATCH `/api/items/:id` → `status='Sold'`
5. `$store.dw.fetchAll()`

No modal-within-modal. Sale price captured inline on the row.

---

## What This Enables Later

- Site performance comparison: head-to-head FB vs CL sell-through rate once enough data accumulates (ended_at populated on the losing listing)
- The schema is already ready for this — no future migration needed
