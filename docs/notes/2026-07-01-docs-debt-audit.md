# Docs & Debt Audit — 2026-07-01

> Synthesis of a five-agent archaeology pass (git history + old READMEs, session-log + specs/plans, eBay subsystem, disc-golf analytics, frontend/docs drift). This is the triage artifact for the burndown; the durable backlog is the tickets it spawned. Ephemera: consumed once triaged.

## The headline

The 2026-06-29 doc-split preserved the old CLAUDE.md content well. What rotted is different: **the three reference docs never caught up to features shipped after ~April**, and one section is actively wrong (documents deleted code with a "do not change" instruction). The near-rewrite of the eBay listing API traces to one hole: `docs/claude/api-reference.md` has **zero endpoint entries for `server/ebay-listings.js`**, the file that does all listing creation and update. A session grepping "how do I list on eBay" finds nothing and concludes it must be built.

## Core features a session must be able to reach (the maintain-at-a-moment list)

The eBay lifecycle, as it actually exists. All routes mounted at `/api/ebay` (both routers share the prefix, `server.js`).

| Flow | Chain |
|---|---|
| Mint new disc listing | `POST /bulk-list` (ebay-listings.js:179) → `buildDiscPayload` (ebay-builders.js:151) → photos `uploadToEPS` (ebay-client.js:72) → `putInventoryItem` → `upsertOffer` → `publishOffer` (ebay-client.js:99/117/150) |
| Mint one-off (skill) listing | `POST /list-item` (ebay-listings.js:389), same primitives, payload from list-item skill checkpoint |
| Edit live price/title/desc | `POST /bulk-update` (ebay-listings.js:332) → `resolveListedFields` (canonical: `items.name` + `listings.list_price`, never the blob) → `putInventoryItem` + `updateOffer`; one-offs via `POST /update-item` (ebay-listings.js:456) |
| Photos only | `POST /bulk-photos` (ebay-listings.js:276); staging via `POST /bulk-list-photos` + `GET /photo-status` (#139 disk-backed flow) |
| Preview (dry) | `POST /bulk-preview` (ebay-listings.js:314) |
| Import/diff live listings | `GET /listings` (ebay.js:117, Browse API, app token) → sites view link/import → `POST /migrate-listing` (ebay.js:162, max 5/req) |
| Orders + tracking push | `GET /orders`, `GET /orders/:id`, `POST /orders/:id/tracking` (ebay.js:54/70/85); combine-ship loops the tracking push over the order group (label-modal.js:361) |
| Traffic | `POST /traffic` (ebay.js:218, Analytics API, 30-day rolling, batched 200 ids); shared via `$store.dw.trafficMap` |
| Tokens | `getAccessToken()` / `getAppToken()` (ebay-auth.js:52/107). Never read `data/ebay-tokens.json` directly |

**Do-not-reinvent primitives:** `upsertOffer` (POST-falls-back-to-PUT on 25002), `updateOffer`, `publishOffer` (retries once on 25604), `putInventoryItem`/`getInventoryItem`, `getOfferBySku`, `uploadToEPS`, `fetchPolicies`/`getMerchantLocationKey`, `buildDiscPayload`/`resolveDiscTitle`, `renderDescriptionHtml`. New category = new builder in ebay-builders.js, never ad-hoc payload construction in a route.

**The architecture sentence that was never written down:** the listing pipeline is a deliberate two-mode split, inventory-backed (catalog → `buildDiscPayload`) and session-backed (list-item skill checkpoint), converging on one payload contract `{ sku, title, description, specLines, condition, conditionNotes, price, minOffer, categoryId, aspects, photos }`. It lives only in `docs/plans/2026-05-16-ebay-listing-refactor.md`.

## Doc drift, by file

**api-reference.md**
- Missing all 8 `ebay-listings.js` routes; missing 5 of 10 `ebay.js` routes (`/listings`, `/migrate-listing`, `/offer`, `/traffic`, `/fulfilled-orders`).
- Missing `GET /api/config`, `GET /api/flight-numbers`, `POST /api/inventory`, `DELETE /api/items/:id`, `PATCH`/`DELETE /api/lots/:id`.
- Schema section missing `flight_numbers`, `disc_plastics`, and the multi-unit columns (`items.quantity`/`quantity_sold`/`oversold`).
- Never states: cascade rules, one-order-per-listing / one-shipment-per-order, SKU write-once (intentional friction, no UI edit ever), `order.profit = sale_price - cost - shipping_cost` with **no platform fees** (the asymmetry behind #136).
- No credential-rotation runbook (rotating `ebay-tokens.json` requires the full OAuth dance through the external `duckwerks.com/ebay-oauth-callback.php` page, not in this repo).

**frontend-reference.md**
- Actively wrong: "Key Computed Values (do not change formula)" documents a `SITE_FEES` object that does not exist (only trace: dead comment index.html:190). Real fee math is DB-driven off `sites.fee_rate`/`fee_flat`, implemented independently 3x (store.js:244-265, charts.js:63-68, lot-modal.js ~78/141).
- Actively wrong: documents `reverb-modal.js` / `ebay-modal.js` (deleted Apr 21, commit 1768ca1) including a full section for the Reverb sync modal. That functionality is the **Sites view** (sites.js, 437 lines), which appears nowhere.
- Views table lists 4 of 7 views (missing Analytics, Comps, Sites). Catalog row still says "saves to Google Sheet" (false since 2026-05-16, commit 28b52d5).
- Missing: `sortable.js` / `dwSortable` shared sort pattern (catalog's table uses its own non-persisting local sort, a divergence a cold session would copy), multi-unit + shipping modal files, combine-orders label-modal mechanics (#123: order groups, even-amortized shipping, remainder on first rec), and any "add a new view" walkthrough (4 touch points: partial comment, script tag, rail-link, store whitelist).

**codebase-map.md**
- Missing files: `server/flight-numbers.js`, `server/inventory-schemas.js`, `server/shippo.js`, `public/v2/js/charts.js`, `public/v2/js/sortable.js`, `public/v2/js/modals/multi-unit-modal.js`, sites view files.
- `ebay-listings.js` parenthetical lists 6 of 8 routes (missing `bulk-list-photos`, `photo-status`).
- Doesn't say the web bulk-list UI (#139) is now the primary listing path with `scripts/bulk-list-discs.js` secondary (still useful for `--photos-only` and scripted runs).
- `scripts/README.md` still says deploy-nuc.sh "run after every push" (retired; deploy.sh is the standard).

**GOTCHAS.md** (backfill candidates, all dated, all currently only in the log/plans)
1. 2026-05-15 SQLite WAL bloat (5.8MB WAL vs 596KB db; hourly PASSIVE checkpoint in db.js; long-lived PM2 connection blocks auto-truncation)
2. 2026-04-19 Puppeteer moved to child process so a Chromium crash can't kill Express
3. 2026-03-30 eBay Browse/Finding bot-blocked; SerpAPI was the fix
4. 2026-04-06 + 2026-05-16 category 184356 silently requires USED_EXCELLENT (bit twice; `normalizeCondition()`)
5. 2026-05-01/02 eBay Motors fitment: Inventory API can't send it; manual recategorize workaround can break the listing
6. eBay OAuth refresh: do NOT send `scope` in the refresh body (rejected); scope changes need full re-auth
7. eBay query strings: build traffic-report/fulfillment filters as raw strings; URLSearchParams encodes `[ ] { } |` and eBay rejects them (bit two features)
8. `upsertOffer(offerBody, headers)` vs `updateOffer(offerId, offerBody, headers)`: transposed arg order landmine
9. EPS upload is two-step (POST → 201 + Location, then GET for imageUrl); caused a real bug 2026-04-05
10. `publishOffer` retries once on errorId 25604 after 3s (by design)

## DG sell-down analytics gaps (ranked)

1. **Cost-recovery is broken-shaped:** disc `items.cost` is hardcoded 0 at every insert (catalog-intake.js:15, ebay-listings.js:143,167); lot and dashboard rollups sum `items.cost` and never read `lots.total_cost` (captured at lot creation, never read). DG lot shows $0 cost and silently falls back to sold-count %. Fix is query/UI only; the dollar figure already exists.
2. **No price history:** `listings.list_price` overwrites in place. The Jul-1 surgical cuts exist only as prose in `docs/notes/dg-cohorts-worklog.md`. Blocks sold-vs-asking delta and #135's before/after.
3. **No persisted traffic:** `/traffic` is live-only, 30-day rolling, session-cached. A `traffic_snapshots` table (listing_id, pulled_at, views, impressions, ctr) turns #135-style revisits into one query instead of manual copy-paste.
4. **Query-only gaps, data already in schema:** sell-through by mold/manufacturer/plastic; stale-listing report (zero-view / views-but-no-sale; the #135 baseline found 24 zero-view, 68 at 5 or fewer); days-on-market column on the catalog table (`listings.listed_at` already used in analytics.js); DG-scoped weekly velocity (momentum chart is neither category-filtered nor week-bucketed); INTAKE/LISTED/SOLD funnel counts above the new v2.0.49 filter.
5. Blocked externally: watchers (`watchCount` null until eBay App Check approved, analytics.js:158). Needs-new-integration: best-offer data (Negotiation API).

## Cold-session drills (can the docs guide a change?)

- Add sortable column to catalog table: **partial** (would copy the wrong, non-persisting sort pattern)
- Add a modal: **partial** (GOTCHAS triad is accurate; file-structure examples are phantom files)
- Add a new view: **no** (4 touch points undocumented; sites.js is the perfect template and is invisible)
- Change price/fee rendering: **no, actively misleading** (SITE_FEES)
- Find which partial owns UI text: **yes** (grep works; no templating layer)

## Hygiene and misc

- Fee/profit math duplicated 3x (store.js, charts.js, lot-modal.js) and asymmetric with `order.profit` (no fees). Ref #136.
- `EBAY_STORE_CATEGORY = 'Multiple Discounts'` hardcoded in ebay-listings.js:23; a second category builder would need it moved into the builder layer. Note for when a second category is real, not before.
- `scripts/withdraw-offers.js` is a hardcoded one-time script (5 literal SKU/offer pairs); treat as reference code, and it reads as reusable in scripts/README.md.
- `scripts/ebay-traffic-merge.js` (CSV import) is easy to confuse with the live `/traffic` route; one-line disambiguation needed.
- Code-level hygiene is clean: no TODO/FIXME, no orphaned partials or scripts, 1:1 partial/script/placeholder match.

## Existing-ticket notes for triage

- **#119 and #120 are duplicates** (both "improve in-person / field sale mark-sold flow", filed 6 seconds apart).
- **#39** (listing creation tool) is largely superseded: web bulk-list (#139) covers discs; the list-item skill + `/list-item` route covers one-offs; Reverb minting is the only unbuilt part.
- **#117** (migrate off Browse API) connects to the watchers gap and `GET /listings`.
- **#89** (category-generic bulk workflow) is the eventual home for the generalization notes above.
- **#142** (Ended/pulled-unsold terminal status) confirmed by the schema read: no such state exists in the `items.status` CHECK constraint.
