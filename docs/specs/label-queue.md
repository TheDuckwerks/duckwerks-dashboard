# Label Queue — ship multiple orders without the one-by-one loop

**Ticket:** #159 · **Status:** building

## Problem

Shipping N orders means N full round trips: SHIP → label modal → rates → purchase → print → close → refetch orders → find the next row → repeat. The label work itself is fine (HITL per label stays); the surrounding navigation is the bother.

## Design

A queue of ship descriptors that lives across label-modal steps. The operator selects orders in the Sites view, launches the queue, and the modal advances order-to-order in place — no close, no interim refetch. One `fetchOrders` refresh fires when the modal finally closes (existing watcher, untouched).

Per-order flow collapses to: confirm address → weight/dims (prefilled from the previous label) → GET RATES → pick rate → PRINT → NEXT.

### Sites view (`sites.js` + `views/sites.html`)

- Checkboxes become dual-purpose: combine-ship (existing) and queue selection.
- Reverb rows get checkboxes too — the queue spans both marketplaces.
- New `SHIP QUEUE (N)` button, sibling to `COMBINE & SHIP`:
  - Visible from 1+ selected (combine bar stays at its 2+ threshold).
  - No same-address requirement — queue entries are separate labels.
- `queueSelectedOrders()` builds descriptors and hands off:
  - eBay entry: `{ type: 'ebay', orderId, lineItemIds, recs }`
  - Reverb entry: `{ type: 'reverb', orderNum, rec }`
  - Sets `dw.labelQueue` to entries after the first, applies the first entry to the existing store scalars (`activeEbayOrderId`/`activeEbayLineItemIds`/`activeEbayOrderRecs` or `activeReverbOrderNum`), and opens the label modal — identical contract to `openEbayShip`/`openReverbShip` today.
- Selection state: eBay uses existing `orderSel`; Reverb gets a parallel `reverbSel` keyed by order_number (kept separate so combine logic stays eBay-only untouched).

### Store (`store.js`)

- One new field: `labelQueue: []`. Sites view writes it; label modal consumes it. Cleared on modal close so nothing leaks.

### Label modal (`label-modal.js` + `modals/label.html`)

- Result step: when `$store.dw.labelQueue.length`, show `NEXT LABEL (N LEFT) →` button.
- `nextInQueue()`: shift the next descriptor off `dw.labelQueue`, apply it to the store scalars + `dw.activeRecordId`, call `_open()`. Same modal instance, no close.
- Header shows queue position while a queue is active (`label 2 of 5`).
- **Package data persists across queue steps** — `_open()` already doesn't reset `parcel`; this is now load-bearing, noted in code. Same-size runs (discs) fill weight/dims once.
- Per-item state still resets each step as today: address, insurance (disc check + sale-amount bump), rates, result, messages.
- Modal close mid-queue abandons the rest (queue cleared in `closeModal` path); the close-watcher refetch picks up whatever shipped. No skip button in v1 — close is the escape hatch.

## Not building

- One-click batch purchase (no HITL) — explicit non-goal; rate selection and print stay per-label.
- Combine-groups as queue entries (select 5, two share an address → 4 labels). Queue and combine stay separate actions on the same checkboxes.
- Skip button — revisit if abandoning-via-close proves annoying.

## Docs touched

- `docs/claude/frontend-reference.md` — label modal state/flow section gains the queue.
- `docs/claude/codebase-map.md` — `sites.js` line mentions queue alongside combine-ship.

## Verify (manual, browser)

1. Select 2 eBay + 1 Reverb order → SHIP QUEUE (3) → modal steps through all three; parcel data carries forward; each purchase auto-fires mark-shipped + save.
2. Combine bar still behaves: 2+ same-address selection combines as before.
3. Close mid-queue → orders list refreshes once; remaining orders still listed, shipped ones gone.
4. Single-order SHIP button unchanged.
