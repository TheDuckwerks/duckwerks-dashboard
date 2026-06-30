# Combine same-buyer eBay orders into one shipment

**Issue:** [#123](https://github.com/TheDuckwerks/duckwerks-dashboard/issues/123)
**Date:** 2026-06-29

## Problem

One buyer places multiple separate eBay orders (distinct order IDs, same shipping address). Today each order ships as its own label. The only way to ship them together is buy one label, then hand-paste that tracking onto each order in eBay Seller Hub so none flag late/unshipped. Happens often enough to build the real thing (bother principle).

## Scope

- **eBay only.** Reverb is out (separate-order combining is an eBay pattern; Reverb's ship-push API differs).
- **No auto-grouping magic.** Plain checkboxes on the sites-page order cards; user picks which to combine.
- **Same shipping address gate.** Combine is one label, so it's only valid across orders going to the same place.

## Design

### The reused spine

The label modal already does the hard part: one label → propagate tracking + sale price + sold-status to N records, push to eBay. It's just hard-keyed to a single order ID (`ebayOrderId` scalar; the secondary-rec loop at `label-modal.js:322` stamps every rec with that one order num).

Generalize the modal's internal model from **"one order, N line items"** to **"N order-groups, one label."** The existing secondary-rec loop becomes the case where a single group has >1 rec. `markShippedEbay` loops over each group's order ID instead of pushing to one — that's what removes the manual Seller-Hub paste.

### Modal internal model

Replace the scalar eBay fields with an `orderGroups` array. Each group:

```
{ orderId, recs[], lineItemIds[], lineItemPrices[], address }
```

- `orderGroups[0]` is the primary: its `address` fills `addrText`, its sale total seeds the insurance default.
- One label is purchased (unchanged rate/purchase flow).
- `saveShipping()` loops every group, and within each group every rec: create/update the order, mark Sold, attach tracking. Shipping cost is **evenly amortized** across all recs (total label cost ÷ total rec count, rounded to cents; the rounding remainder lands on the first rec so the per-item costs sum to the real total). This also replaces today's "all cost on primary, $0 secondaries" behavior for the existing multi-item-in-one-order path — both flow through the same loop, so both get honest per-item EAF.
- `markShippedEbay()` loops every group, pushing that group's `lineItemIds` to `POST /api/ebay/orders/:orderId/tracking`.

Extract `_fetchOrderGroup(orderId, recs, lineItemIds)` → fetches the order, runs the existing `totalDueSeller` proportional split for `lineItemPrices`, parses `address`. `_open()` calls it once per group. This refactors today's single-order path into the loop (length-1 array), so the normal one-order ship and combine share one code path.

### Store handoff

New field `activeEbayOrderGroups: []` on the store. The sites view sets it; the modal consumes and clears it (same leak-guard pattern as the existing `activeEbay*` fields). Single-order ship keeps using the existing scalar fields, OR is migrated to a length-1 group — migrate it, so there's one path. `openEbayShip` builds a length-1 group; a new `combineSelectedEbay` builds an N-group array.

### Sites page UI

- Checkbox on each eBay order card; `selectedOrderIds` set in `sitesView`.
- A "Combine & ship (N)" button, shown when 2+ are checked. Enabled only when all checked orders share a shipping address (compare the parsed `shipTo`); if addresses differ, disable with a one-line reason.
- On click: build the order-groups array from the checked orders (each carries its recs + lineItemIds, already in hand from the orders fetch), set `activeEbayOrderGroups`, open the label modal on the primary group's first rec.

### Weight

Keep the normal parcel defaults — a combined box needs more than 3× a single disc's weight (box/extra cardboard), and the user always sets weight before pulling rates. No auto-suggest.

## Build checklist

1. **store.js** — add `activeEbayOrderGroups: []`.
2. **label-modal.js** — extract `_fetchOrderGroup()`; refactor `_open()` eBay branch to build `this.orderGroups` (from `activeEbayOrderGroups`, else a length-1 group from the scalar fields); rewrite `saveShipping()` and `markShippedEbay()` to loop groups. Even-amortize shipping cost across all recs (remainder on first rec).
3. **sites.js** — `selectedOrderIds` state, checkbox toggle, same-address gate, `combineSelectedEbay()` builder; keep `openEbayShip` working (length-1 group).
4. **sites view partial** — checkboxes on order cards + the "Combine & ship (N)" button.

## Verify (manual, browser)

- **Regression:** a normal single eBay order still ships, prints, marks sold, pushes tracking — unchanged.
- **Regression:** a single eBay order with multiple line items still splits sale price and pushes all line items — now with shipping cost evenly split across the items (changed from all-on-primary).
- **New:** check 2–3 same-buyer orders → Combine → one label → all records marked Sold with the same tracking, shipping evenly amortized across items, eBay shows all orders shipped (no manual paste).
- **Gate:** orders with different addresses can't be combined.
