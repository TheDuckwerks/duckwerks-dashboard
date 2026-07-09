# Catalog: days-on-market + stale report

**Ticket:** #151 (slim rescope: items 1 + 3 of the pack; items 2/4/5 dropped as garnish) · **Status:** building

## Problem

"What's still dead" is answered by hand every time (the #135 baseline and its 07-09 re-measure both hand-rolled it). The data is already in the app — `listings.listed_at`, the traffic map the catalog view already loads — it just isn't joined up on screen.

## Design

The catalog inventory table becomes the stale report. No new view, no script.

- **Server (`server/inventory.js`):** `listAll` gains `l.listed_at AS listed_at`. Nothing else changes.
- **DOM column (`catalog.js` + `catalog.html`):** "Days" column after Price — days since `listed_at` for rows with an active listing, blank otherwise. Sortable (`dom` key) through the existing `invSortBy`/`dwSortable` path.
- **Stale flag (`catalog.js`):** `isStale(row)` = has active listing AND `dom >= STALE_DOM_DAYS` AND `(views ?? 0) <= STALE_MAX_VIEWS`. Traffic is already loaded on catalog entry, so this is computable synchronously; rows with no traffic data yet count views as 0 (a listing with no traffic row IS the dead cohort).
- **Constants (`config.js`):** `STALE_DOM_DAYS = 21`, `STALE_MAX_VIEWS = 5` (the ticket's "stalled tail" threshold). Tune there, not in code.
- **UI:** STALE toggle chip beside the status filter chips; composes with them (filter by status, then stale-only). Chip shows the live count (`STALE (n)`). The DOM cell renders red on stale rows even when the toggle is off, so the table telegraphs rot passively.

## Not building

- Sell-through by mold/plastic, weekly velocity, funnel row (items 2/4/5) — dropped with the rescope.
- A standalone script/report — the view IS the report; the underlying data stays queryable via `db.sh` if a one-off cut is ever needed.

## Docs touched

- `docs/claude/frontend-reference.md` — catalog view section: DOM column + stale flag.
- `docs/claude/api-reference.md` — GET /api/inventory response gains `listed_at`.
- `docs/claude/codebase-map.md` — inventory.js line mentions listed_at.

## Verify (browser)

1. Catalog table shows Days column; sorts; blank for unlisted/sold rows.
2. STALE chip count roughly matches this morning's hand count (48 discs ≤5 views, minus <21-day listings).
3. Toggle filters the table; composes with a status chip; red tint on stale DOM cells regardless of toggle.
