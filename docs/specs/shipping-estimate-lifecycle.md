# Shipping estimate: one stored value, no read-time guessing

**Ticket:** #137 (estimate half; the realized half shipped 57a0cc1) · **Status:** building

## Problem

`shipping_estimate` is nullable and read sites paper over the nulls with divergent guesses (`?? 7` in three store.js calcs, `~$7` display in items.js), while the two eBay list-time INSERTs disagree on the default (7 vs 0). "What's the shipping on this listing" has no single answer.

## Design

Store the value at write time; read the column plainly. Grounded in actuals: 165 disc labels average $6.98, 141 non-disc labels average $11.29.

- **Defaults (`server/shipping-defaults.js`, new ~15-line module):**
  `CATEGORY_DEFAULTS = { 'Disc Golf': 7 }`, `FALLBACK = 11`, `defaultShippingEstimate(itemId)` resolves the item's category and returns the default. Tune the map there, nowhere else.
- **Write paths:**
  - `server/listings.js` POST: `shipping_estimate` null/absent → helper fills it.
  - `server/ebay-listings.js` both INSERTs (list-item at :148, bulk-list at :177): literal `7` / `0` → helper value. The two paths stop disagreeing.
  - PATCH stays as-is (explicit updates always win; label-purchase actuals live on `shipments.shipping_cost`, unchanged).
- **Backfill (one-shot, NUC db, confirm-gated):**
  `UPDATE listings SET shipping_estimate = 7 WHERE shipping_estimate IS NULL AND item is Disc Golf` (~124 rows); same with `= 11` for the rest (~62 rows). Idempotent via `IS NULL`.
- **Reads — delete the guesses:**
  - `store.js` `activeListing` estNet: `l.shipping_estimate ?? 7` → `?? 0` (arithmetic guard, not a default — nulls can't occur post-backfill).
  - `store.js` `estProfit`: keep actual-cost-first order (`shipment.shipping_cost` → `shipping_estimate`), delete the `else ship = 7` placeholder branch and its comment.
  - `store.js` `payout`: `?? 7` → `?? 0` guard.
  - `items.js` `shipDisplay`: `'~$7'` → `'—'`; `shipIsEst` keeps working (it flags estimate-vs-actual styling, which survives).

## Not building

- No NOT NULL constraint / table rebuild — the write-path defaults + backfill make nulls unreachable through the app; a constraint costs a SQLite table rebuild for zero behavior.
- No per-weight or per-site estimates — category granularity matches how labels actually price at this scale.

## Docs touched

- `docs/claude/codebase-map.md` — new `shipping-defaults.js` line.
- `docs/claude/api-reference.md` — POST /api/listings notes the server-side default.

## Verify (browser + db)

1. `SELECT COUNT(*) FROM listings WHERE shipping_estimate IS NULL` → 0 after backfill.
2. Items view: no `~$7` anywhere; est-profit numbers shift slightly on previously-null non-disc rows (7 → 11 assumption).
3. List a disc via bulk-list → row lands with `shipping_estimate = 7`.
