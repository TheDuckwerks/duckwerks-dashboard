# Sites View — Design Spec
**Issue:** #115
**Date:** 2026-04-21

---

## Overview

Replace the two per-platform sync modals (Reverb, eBay) with a unified **SITES** view — a full sidenav view that serves as the control panel for all platform interactions. The primary workflow is order fulfillment (check for new orders → ship); secondary workflows are listing linkage/import and listing detail sync.

The existing modal pattern is retired. The label modal and its store state (`activeEbayOrderId`, `activeReverbOrderNum`, `activeEbayLineItemIds`, `activeEbayOrderRecs`) are untouched — SITES replaces the entry point, not the ship flow itself.

---

## Ticker Button

A small **ORDERS** button lives in the ticker bar (right side). It is the lightweight, intentional entry point for checking whether there's anything to ship — no auto-polling, no background timers.

**States:**
- **Idle:** shows `ORDERS` — tap to fetch orders from both platforms in parallel, shows spinner
- **Loaded (nothing):** brief "nothing to ship" feedback, returns to idle
- **Loaded (results):** shows count e.g. `2 ORDERS` — tap again to navigate to SITES view

Count persists in memory until hard refresh, next manual check, or navigating to SITES. Navigating to SITES clears the ticker count (the view takes over as the live state) so the button is ready to use again on next check. Does not auto-recheck on a timer.

Store additions: `orderCount: null` (null = unchecked, 0 = checked/empty, N = results), `checkingOrders: false`, `checkOrders()` async method that fetches both platforms in parallel and sets `orderCount`.

---

## Navigation

- New sidenav entry: **SITES**, same pattern as INVENTORY, LOTS, ANALYTICS
- Navigating to SITES triggers a fresh order fetch on entry (both platforms in parallel)
- Orders fetched by ticker button are reused if already loaded; a **"CHECK FOR NEW ORDERS"** button in the orders section allows a manual re-fetch at any time (essential mid-fulfillment session when new orders may arrive)

---

## SITES View — Layout

Three stacked sections, each independent. No tabs. Vertically scrollable.

### 1. Orders

Loads automatically on view entry. Both platforms fetched in parallel. Independent error handling — a failure on one platform shows an error for that block only and does not affect the other.

**eBay block:**
- Header: `EBAY` + order count + `CHECK FOR NEW ORDERS` button
- Each order: buyer name, item title(s), SKU/metadata, `SHIP` button
- Multi-item orders: all line items shown, SHIP sets `activeEbayOrderId` + `activeEbayLineItemIds` + `activeEbayOrderRecs` then opens label modal with `previousModal: { type: 'sites' }` so back-navigation returns to SITES
- Empty state: "nothing to ship on eBay"
- Error state: error message, does not affect Reverb block

**Reverb block:**
- Same structure as eBay block
- SHIP sets `activeReverbOrderNum` then opens label modal
- Empty state: "nothing to ship on Reverb"

After shipping and returning to SITES, the fulfilled order should no longer appear (re-fetch on label modal close or on SITES re-entry).

### 2. Listings

On-demand. A **"SYNC LISTINGS"** button fetches unlinked listings from both platforms.

Default action is **import**: for each unlinked platform listing, create a local item + listing record. Category and lot pickers are available before import (same as current modal). A single **"IMPORT ALL"** button imports everything selected.

Manual link override available for edge cases (relist created a new listing ID but local item exists): a dropdown to match an unlinked platform listing to an existing local record. This is the minor use case; import is the primary path.

Both platforms shown in a single unified list — the operation is identical regardless of platform.

### 3. Details

On-demand. A **"CHECK DETAILS"** button fetches live listing data from both platforms and computes diffs against local records (name and price).

Shows count of drifted items. Single **"SYNC ALL"** button applies all diffs — no cherry-picking. Platform is source of truth. Confirmation not required (deterministic, reversible via item edit).

---

## File Changes

**New:**
- `public/v2/js/views/sites.js` — `Alpine.data('sitesView', ...)` — all three section states + fetch/action methods

**Modified:**
- `public/v2/js/store.js` — add `orderCount`, `checkingOrders`, `checkOrders()` for ticker button
- `public/v2/index.html` — add SITES nav item; add ticker ORDERS button; add sites view template; remove reverb and eBay modal HTML; update `previousModal` wiring in `openShip` to use `'sites'` instead of `'ebay'`
- `public/v2/js/sidebar.js` — wire SITES nav entry

**Deleted:**
- `public/v2/js/modals/reverb-modal.js`
- `public/v2/js/modals/ebay-modal.js`

---

## Gotchas & Edge Cases

- **Independent platform error handling:** fetch failure on one platform must not block or hide the other. Each block has its own error state.
- **`previousModal` wiring:** label modal uses `dw.previousModal` to route the back button. Currently set to `{ type: 'ebay' }` in `ebayModal.openShip`. Must be updated to `{ type: 'sites' }` so closing the label modal returns to SITES view, not a dead modal.
- **Ticker count staleness:** count persists in memory and is intentionally not auto-cleared. User understands it reflects the last check, not live state. The CHECK FOR NEW ORDERS button in the view is the refresh mechanism.
- **Mid-session new orders:** the CHECK FOR NEW ORDERS button in the orders section is essential — user may be mid-fulfillment when new orders arrive. Must be prominent, not buried.
- **Listings import: category/lot pickers** must carry over from the current modal UI — easy to drop in translation.
- **View re-entry after ship:** returning from the label modal to SITES triggers view re-entry (nav switch), which re-fetches orders. Fulfilled items won't linger.

---

## Out of Scope

- Bulk relist, end listings, pull sold history — future SITES actions, not this iteration
- Per-platform detail diff separation — details section is unified, platform is source of truth across the board
- Auto-polling or background order checks — intentional manual-only for API conservation
