# Catalog/Item Lifecycle — Canonical Homes for Price, Title, Status

**Issue:** #134
**Date:** 2026-07-01
**Status:** Approved — ready to build

---

## For the cold session reading this

This spec is written to be built by someone (or some session) with no memory of the design conversation. It is a **five-phase lifecycle refactor** of how a disc's price, title, and status are stored. Each phase is independently shippable — deploy at its checkpoint before starting the next. Phase 1 is the urgent one (a live-price-reversion hazard); Phases 2–5 are the structural cleanup that removes the whole class of bug.

Read these first (per the project's read-enough-to-act rule):
- This spec, top to bottom.
- `docs/claude/codebase-map.md` — file roles.
- `server/ebay-listings.js` (routes `bulk-list`, `bulk-update`), `server/ebay-builders.js` (`buildDiscPayload`, `generateDiscTitle`), `server/catalog-intake.js` (intake), `server/inventory.js` (the `/api/inventory` join), `server/orders.js` (sold path), `public/v2/js/views/catalog.js` (catalog UI: `inventoryDisplayTitle`, `savePriceEdit`, `ebayConfirmUpdate`, sort).

---

## The problem

A disc's price and title each live in **two stores with no sync between the write paths**, so edits drift the stores apart and a catalog-driven push shoves a stale value to eBay.

| Concept | Store A (the blob) | Store B (the engine) | Who writes A | Who writes B |
|---|---|---|---|---|
| Price | `inventory.metadata.listPrice` | `listings.list_price` | catalog price-edit UI | mint (`bulk-list`), skill `update-item` |
| Title | `inventory.metadata.list_title` | `items.name` | catalog blob edit | mint (`bulk-list`) |

`bulk-update` (the disc push path) reads **only the blob** — `buildDiscPayload` does `blob.list_title || generateDiscTitle(blob)` for the title and `parseFloat(blob.listPrice)` for the price — and never writes the engine row back. So:

- Any price edit (which lands in the blob) drifts from `listings.list_price`, and a blind `bulk-update` reverts the live eBay price to the stale blob value. **Real hit:** DWG-009 blob `$89` vs live `$24` — a title regen would have pushed a $24 disc back to $89. (Reconciled by hand on 2026-07-01; the underlying wiring is what this spec fixes.)
- The catalog view and the dashboard can show different titles for the same disc, because the catalog reads the blob and the dashboard reads `items.name`.

---

## The model — every field has one canonical home

The blob is a **spec + junk-drawer**, never the live truth for anything that has a column. The invariant:

> If a concept has a canonical column, that column is the truth. The blob holds only the intake *spec* (the input to materialization) or genuinely homeless fields.

| Concept | Canonical home | Blob's role |
|---|---|---|
| **Live price** | `listings.list_price` (per marketplace) | `listPrice` = **staging only** — the intended price pre-list. Seeds the listing at mint, then nulled. |
| **Title** | `items.name` (materialized) | `list_title` = **spec** — a custom override string, or `null` meaning "generate me." Input to materialization, not a second copy of the answer. |
| **Lifecycle status** | `items.status` (`Prepping`/`Listed`/`Sold`) | none — `inventory.status` is retired. |
| Specs (plastic, run, color, notes, weight, mold, manufacturer, type, flight numbers, condition, description) | none — these are genuinely homeless | the blob **is** their home. |

**Why price stays on `listings`, not `items`:** price is per-marketplace — the same item on eBay and Reverb can carry different prices (the multi-listing design, `docs/specs/2026-03-30-multi-listing-design.md`). Putting a price on `items` would recreate the exact drift this spec kills, one level up (`item.price` vs `listing.list_price`). Pre-list, before any listing row exists, the *staging* price has no listing to live on, so it stays on the blob — which is correct, because a staging price is intake-phase data.

---

## The lifecycle (target state)

1. **Intake** (`catalog-intake POST /disc`): create the `inventory` (blob) row **and** the `items` row together. `items.name` = resolved title from the spec (`list_title` override, else `generateDiscTitle`). `items.status = 'Prepping'`. The blob carries specs + `listPrice` (staging) + `list_title` (spec).
2. **List** (`bulk-list`): the `items` row already exists — **find and associate, don't create**. Re-materialize `items.name` from the current spec (the spec may have been edited since intake). Create the `listings` row with `list_price = blob.listPrice`, then **null `blob.listPrice`**. Flip `items.status = 'Listed'`.
3. **Post-list price edit** (catalog UI): the disc is `Listed` → write `listings.list_price` and push to eBay. `Prepping` → write `blob.listPrice` (staging), as today.
4. **Push** (`bulk-update`): the builder receives `items.name` (title) and `listings.list_price` (price) from the route. The blob still provides specs/description/aspects. The builder no longer digs the title or price out of the blob.
5. **Sold** (`orders.js`): `items.status = 'Sold'`, `listings.status = 'sold'`. The `inventory.status` / `markDiscSold` write is removed.

**"Almost everything gets listed"** is the invariant that makes coupling-at-intake safe: today 290 of 292 inventory rows already have an `items` row; the only 2 without are the 2 still in `intake`. Coupling just creates the item row a step earlier.

---

## Data model changes

- **No new columns.** `items.name`, `items.status`, `listings.list_price` already exist and already carry these meanings.
- **`inventory.status` retired.** It only ever surfaced via the catalog "hide sold" filter (`/api/inventory?excludeStatus=sold`), and was only ever `intake` (default) or `sold` — never `listed`. Its job moves to `items.status`. The column has a `CHECK` + `NOT NULL DEFAULT`, so a physical `DROP COLUMN` needs a SQLite table rebuild; **retire it logically** (stop all reads/writes, leave the column as a documented tombstone). Physical drop is an optional later cleanup, not part of this work.
- **`inventory.js` join** must expose `items.name` and `listings.list_price` (it already LEFT JOINs both tables and exposes `ebay_listing_id`).

---

## Phase 1 — Price authority: the listing row owns post-mint price

**The urgent phase. Ship alone.** Kills the live-price-reversion hazard.

### Safety gate (run before touching code)
Confirm the listing row is trustworthy as the authority. Already verified 2026-07-01: **zero numeric drift** between `listings.list_price` and `blob.listPrice` across all 93 active discs, both non-null. Re-run before building:
```sql
SELECT it.sku, l.list_price, json_extract(inv.metadata,'$.listPrice')
FROM listings l JOIN items it ON it.id=l.item_id JOIN inventory inv ON inv.sku=it.sku
WHERE it.sku LIKE 'DWG-%' AND l.status='active'
  AND CAST(l.list_price AS REAL) <> CAST(json_extract(inv.metadata,'$.listPrice') AS REAL);
```
Zero rows = safe to proceed. Any rows = reconcile those to true live eBay price first (the listing row must equal live eBay, since we're about to trust it).

### Changes
1. **`bulk-update` route (`ebay-listings.js`)** — resolve price from the active listing row for the SKU, not the blob. Look up `listings.list_price` via `items.sku` join; pass it into `buildDiscPayload`. If no active listing exists (shouldn't happen on this path), fall back to `blob.listPrice` with a logged warning.
2. **`buildDiscPayload` (`ebay-builders.js`)** — accept a resolved price instead of reading `parseFloat(blob.listPrice)` internally. Signature: `buildDiscPayload(blob, { price })`; `minOffer` derives from the passed price. Keep the blob fallback inside the builder only if `price` is undefined, so `bulk-preview` (which has no listing context) still works for unlisted discs.
3. **`bulk-preview` route** — for a listed disc, preview the listing price (same resolution as `bulk-update`) so the preview matches what will actually push. For an unlisted disc, preview `blob.listPrice` (staging).
4. **`inventory.js` join** — add `l.list_price AS listing_price` to `listAll`.
5. **Catalog UI (`catalog.js`)** — for listed discs, read/sort/seed price from `listing_price`, not `metadata.listPrice`:
   - `invSort` price branch (line ~84): sort by `listing_price ?? metadata.listPrice`.
   - `startPriceEdit` seed (line ~411): `row.listing_price ?? metadata.listPrice`.
   - `savePriceEdit`: if `row.ebay_listing_id` (disc is listed) → write the listing row + push to eBay (write `listings.list_price` then call `bulk-update` for the SKU so eBay + DB stay in lockstep). If not listed → write `blob.listPrice` as today. **Check `server/listings.js` for an existing list_price PATCH route to reuse** before adding one.
6. **Migration (NUC)** — null `blob.listPrice` for active-listed discs so the staging value can't silently re-drift. Confirmed equal to the listing row, so this is lossless:
   ```sql
   -- DRY RUN first: SELECT the rows. Then, with --confirm:
   UPDATE inventory SET metadata = json_remove(metadata, '$.listPrice')
   WHERE sku IN (SELECT it.sku FROM items it JOIN listings l ON l.item_id=it.id
                 WHERE l.status='active' AND it.sku LIKE 'DWG-%');
   ```
   (Follow Direct Data Operations: SELECT first, confirm, execute, verify.)

### Verification (manual, in the browser)
- Edit a listed disc's price in the catalog → it writes the listing row and pushes; refresh shows the new price; the eBay listing shows the new price.
- Run a `bulk-update` (title regen) on a disc whose blob had a *different* stale price historically → the pushed price is the listing price, **not** reverted.
- An unlisted disc still stages its price on the blob and previews correctly.

### Checkpoint: ship (Ship Procedure). This closes the acute bug.

---

## Phase 2 — Couple item at intake; unify status on `items.status`

**Structural foundation.** Makes `items.name` exist from birth (Phase 3 needs it for unlisted discs) and collapses two status fields into one.

### Changes
1. **`catalog-intake POST /disc`** — after upserting the `inventory` blob, upsert the `items` row for the same SKU: `name` = resolved title (see Phase 3's `resolveDiscTitle`; until Phase 3 lands, inline `blob.list_title || generateDiscTitle(...)`), `status='Prepping'`, `cost=0`, `lot_id=9`, `category_id` = Disc Golf, `sku`. Idempotent: `ON CONFLICT(sku)` update `name` (re-materialize) but **do not** regress `status` (a `Listed`/`Sold` disc re-saved at intake stays listed/sold).
2. **`bulk-list` (`ebay-listings.js`)** — `dbWriteDiscListing` becomes find-or-create: the item row now exists from intake, so look it up by SKU, create only the `listings` row, and set `items.status='Listed'`. Keep the create path as a fallback for any SKU without an item row (defensive).
3. **`orders.js` sold path** — drop the `markDiscSold(sku)` call (and remove/retire `markDiscSold` + `markSoldStmt` in `catalog-intake.js`). `items.status='Sold'` + `listings.status='sold'` already fire there.
4. **`inventory.js`** — stop reading/writing `inventory.status`:
   - `listAll`: add `it.status AS item_status`.
   - The `excludeStatus` filter and POST/PATCH `status` handling: retire (the catalog sold filter moves to `item_status`). Leave the column defaulting to `intake` on insert (harmless tombstone); remove `status` from the upsert/patch `SET` lists.
5. **Catalog UI (`catalog.js`)** — the "hide sold" filter (`inventoryShowSold` → `excludeStatus=sold`) filters client-side on `item_status === 'Sold'` instead of the server `excludeStatus` param (or keep a server param that now filters on `item_status`).

### Migration (NUC)
Backfill `items` rows for the 2 intake-only inventory rows (verify count first — `SELECT sku FROM inventory inv WHERE NOT EXISTS (SELECT 1 FROM items it WHERE it.sku=inv.sku)`). For each: insert an `items` row (`name` = resolved title, `status='Prepping'`, `cost=0`, `lot_id=9`, Disc Golf category, `sku`).

### Verification
- Catalog an all-new disc → an `items` row appears immediately (`Prepping`), catalog shows it, no listing yet.
- Hide-sold filter still hides sold discs (now driven by `item_status`).
- List a `Prepping` disc → status flips to `Listed`, one listing row, no duplicate item.
- Sell a disc → `Sold`, hidden by the filter.

### Checkpoint: ship.

---

## Phase 3 — Title materialization: `items.name` canonical, blob is spec

With item rows guaranteed (Phase 2), point every title read at `items.name`.

### Changes
1. **`ebay-builders.js`** — extract `resolveDiscTitle(blob)` = `blob.list_title || generateDiscTitle({ ...blob, condition: normalizeCondition(blob.condition) })`, and export it. Export `generateDiscTitle` too if intake needs it directly.
2. **`buildDiscPayload`** — accept the title from the route (`buildDiscPayload(blob, { price, title })`) instead of resolving it internally. Fallback to `resolveDiscTitle(blob)` only when `title` is undefined (keeps `bulk-preview` working standalone).
3. **`bulk-update` / `bulk-list` routes** — pass `items.name` as the title into the builder. `bulk-list` re-materializes `items.name = resolveDiscTitle(blob)` at mint before creating the listing (spec may have changed since intake).
4. **`bulk-preview`** — preview `resolveDiscTitle(blob)` (the materialized-to-be title) so preview matches the push.
5. **Catalog UI `inventoryDisplayTitle` (`catalog.js`)** — read `item_name` (from the join) as the display title, falling back to the blob-built string only when no item row exists (shouldn't happen post-Phase-2).
6. **`inventory.js` join** — add `it.name AS item_name` to `listAll` (the join already exists; this is the field the catalog display now reads).
7. **Scripts** — `scripts/bulk-list-discs.js` currently reads `meta.list_title`/`meta.listPrice` and passes `list_title: p.title` into `bulk-update`. Reconcile: the route now owns title (from `items.name`) and price (from the listing). Update the script so it no longer forces title/price through the blob for updates; for the initial *list* path it still seeds from the spec. `scripts/clean-disc-titles.js`'s regen role is superseded by Phase 4's refresh command — leave it or delete once Phase 4 lands.

### Verification
- Catalog view and dashboard show the **same** title for a given disc.
- Edit a disc's `list_title` spec (override) → materialize (re-list or refresh) → both surfaces + eBay show the override.
- Null a disc's `list_title` → materialize → both show the generated title.

### Checkpoint: ship.

---

## Phase 4 — Refresh command: formalize the rubric-change regen

When `generateDiscTitle` changes, `items.name` for generated discs must be recomputed. This is the 2026-07-01 94-disc regen, done by hand — formalize it.

### Changes
- **`scripts/refresh-disc-titles.js`** (follows the project script convention: dry-run default, `--confirm` to write, idempotent):
  - For every non-sold disc with a **null `list_title`** (generated titles only), recompute `items.name = generateDiscTitle(...)` from the current spec+template. **Leave overrides (non-null `list_title`) untouched** — so custom titles survive a template change for free.
  - Dry-run prints a diff (old `items.name` → new) per SKU; `--confirm` writes `items.name`.
  - `--push` flag (optional): after writing, run `bulk-update` for the changed SKUs to sync eBay. Without it, refresh is DB-only and eBay syncs on the next push.
- Retire `scripts/clean-disc-titles.js` (superseded).

### Verification
- Change `generateDiscTitle`, run dry-run → diff lists only generated discs, no overrides.
- `--confirm` → `items.name` updated for generated discs; overrides unchanged.
- `--push` → eBay titles match.

### Checkpoint: ship.

---

## Phase 5 — Cleanup: docs + GOTCHAS

- **`GOTCHAS.md`** — add a dated entry under a disc/catalog subsystem heading: the two price stores (and two title stores) can silently disagree; post-refactor the canonical homes are `listings.list_price` and `items.name`, the blob is spec/staging only; verify catalog vs listing before any catalog-driven bulk push. Note `inventory.status` is a retired tombstone (authority is `items.status`).
- **`docs/claude/codebase-map.md` / `api-reference.md`** — update the disc lifecycle description and the `/api/inventory` join fields (`item_name`, `listing_price`, `item_status`).
- **`docs/session-log.md`** — entry per the Ship Procedure.
- Confirm `scripts/README.md` reflects the new `refresh-disc-titles.js` and the retired `clean-disc-titles.js`.

### Checkpoint: ship (final).

---

## Out of scope

- Physical `DROP COLUMN inventory.status` (needs a table rebuild; retired-in-place is enough).
- Merging `inventory` and `items` into one table (they serve different shapes — category blob vs normalized ledger; coupling-at-birth is the right weight).
- Reverb-side title/price materialization (this spec is the eBay/disc path; the model generalizes but isn't being retrofit here).
- Multi-listing price divergence UI (already covered by the multi-listing design; unaffected).

---

## Sequencing summary

| Phase | Delivers | Depends on | Migration |
|---|---|---|---|
| 1 | Price authority = listing row (kills the reversion bug) | — | null `blob.listPrice` for 93 active discs |
| 2 | Item minted at intake; status unified on `items.status` | — | backfill 2 orphan item rows |
| 3 | Title canonical = `items.name`; blob = spec | 2 | — |
| 4 | Refresh command (formalized regen) | 3 | — |
| 5 | GOTCHAS + docs | 1–4 | — |

Phase 1 is independent and urgent — build and ship it first even if 2–5 wait.
