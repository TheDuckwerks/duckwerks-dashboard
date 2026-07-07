# Tracker terminal-state persistence

**Status:** approved, building
**Ticket:** #160
**Date:** 2026-07-06

## Problem

Every "Sold + has tracking_id" record re-polls EasyPost live on every page load, forever. There is no persisted terminal state, so the only way the client distinguishes in-transit from delivered is to ask EasyPost each time. The set grows unbounded with sales history — currently 554 live tracker calls on a dashboard/items load, all queued through the browser's 6-connection limit (9-13s each, ~14s to settle).

Three views each loop `fetchTracker` over the full sold set independently: `dashboard.js:22`, `items.js:291`, `shipping-modal.js:37`. The tracker route `server/label.js:238` is a straight EasyPost passthrough with no persistence.

## Approach

Freeze delivered shipments in the DB and never poll them again. A shipment reaches `delivered` (terminal), we store it, and it drops out of the live-poll set permanently. Steady state collapses from 554 → the count of genuinely in-flight packages (~11), and it stays bounded regardless of history size.

**Why not cache the in-flight ones too (full DB cache):** the volatile statuses (pre_transit, in_transit, out_for_delivery) are exactly what you want fresh on each load — putting the DB in that path buys staleness or a TTL/refresh layer to re-solve freshness we get for free by polling. We freeze only the safe-to-freeze set (delivered = never changes) and leave the volatile set live.

**Why only `delivered`, not other terminal states:** return_to_sender / failure / cancelled you likely want to keep seeing update. Freeze the overwhelming-majority happy path; widen the terminal set later only if it earns it.

## Design

### Schema (migration)
Add to `shipments`:
- `tracking_status TEXT` — last known EasyPost status; the freeze signal when `= 'delivered'`.
- `delivered_at TEXT` — delivery timestamp, needed for the client's 3-day post-delivery grace.

`server/items.js:28` selects `SELECT * FROM shipments`, so both columns flow onto `r.shipment` automatically — no payload change.

### Server — persist on delivery
In `GET /api/label/tracker/:id` (`label.js:238`): after the EasyPost response, if `data.status === 'delivered'`, UPDATE the shipment row (matched by `tracking_id`) with `tracking_status = 'delivered'` and `delivered_at` = the delivered event's datetime (`tracking_details` find `status === 'delivered'`), before returning. Idempotent — only writes when not already terminal (`AND tracking_status IS NOT 'delivered'` or equivalent guard). Single writer, no client race, fires regardless of which view triggered the poll.

### Client
Once `tracking_status` + `delivered_at` are stored on the record, delivered-ness is a property of loaded data — no live fetch needed to know it. Two consumers, two shapes:

**In-Transit widget** (dashboard, shipping modal): membership is one direct filter over stored fields —
`tracking_status !== 'delivered' || delivered_at > now-3d`.
`isInTransit` (`store.js:451`) rewrites to this: a pure function of `r.shipment.tracking_status` / `delivered_at`, no dependency on the live `trackingData` fetch. Within that display set, poll live only the `!== 'delivered'` members (the delivered-in-grace ones already have everything from the DB). The live poll now only enriches the current-status detail for in-flight packages; it no longer determines membership.

**Items table** (`items.js`): the one genuine iterate-all-sold consumer — paints a per-row tracking badge on every sold row in the table. Each row reads `tracking_status` from its already-loaded record and polls live only if `!== 'delivered'`; delivered rows render the stored status.

Fetch filter at every call site — `dashboard.js:22`, `items.js:291-296` (single-item + multi-unit order branches), `shipping-modal.js:37` — adds `&& r.shipment?.tracking_status !== 'delivered'`.

### Backfill
Existing delivered shipments have `tracking_status = NULL`, so they'd poll once more, self-heal on that poll, then freeze. Acceptable — the 554 becomes ~11 after the first load-and-freeze cycle. No explicit backfill script needed; optionally run one to freeze the known-delivered history in a single pass so the very first post-deploy load isn't still heavy.

## Out of scope (separate)
- Consolidating the three per-view `trackingData` stores into one shared store-level fetch so in-session view-switching reuses the in-flight polls. Real win, separate change (relocates where `trackingData` lives). Fast-follow or ticket.
- Wider terminal set, lost-package give-up-after-N-days.

## Verify
- Dashboard/items load fires live tracker calls only for in-flight packages, not the full sold history (network tab: ~11, not 554).
- A delivered item still shows in the In-Transit widget within 3 days of delivery, then drops off — with no live tracker call for it.
- After first load, delivered shipments carry `tracking_status = 'delivered'` + `delivered_at` in the DB.
