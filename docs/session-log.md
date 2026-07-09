# Session Log
_Most recent first. Update this at the end of every session._

### 2026-07-09 (metagame) — Cooldown cleanups (v2.0.56)

Three fixes out of the session retro: zero-weight PUT guard hoisted from `update-item` into `putInventoryItem` (all GET→PUT round-trips safe by construction, GOTCHAS updated); comps search surfaces per-source errors to caller + UI instead of swallowing them (incl. SerpAPI's 200-with-embedded-error mode — verified against the live outage); list-item skill fully swept to the pond vhost (9 refs, first pass had caught only 2). Also flagged upstream: cross-project doc-rot on infra changes (fedora.local:3000 firewalled → skill rotted silently) wants a grep-siblings line in Duck Ops's close ritual.

### 2026-07-09 (later) — Triage sweep, stale report, shipping estimates, EQ recall pass (v2.0.55)

Big housekeeping + build day after the morning's ship queue. **Triage:** 5 subagents checked all 37 open tickets against code/git; 27 closed (verified-done, superseded, moot, or Geoff-ruled), including the whole 07-02 docs batch and the money cluster resolved by the post-fee reframe. Board is now 4: #159/#135 awaiting clocks, #140/#142 backlog. #135 retitled to re-measure on/after 2026-07-23; its 07-09 check confirmed the DG keyword thesis (zero-view 24→13, velocity +25%, the worklog-named Wave sold). **#151 slim rescope shipped:** days-on-market column + STALE (n) toggle on catalog (spec: `catalog-stale-report.md`). **#137 finished:** per-category shipping_estimate defaults from label actuals (`shipping-defaults.js`), ~200 nulls/zeros backfilled, read-time magic 7s deleted (spec: `shipping-estimate-lifecycle.md`). **EQ recall pass:** all 9 comic-lot titles rewritten with "Comic Lot"/"Pini" (same disease as the DG titles), pushed via update-item after fixing eBay's GET→PUT zero-weight self-rejection (25709, GOTCHAS'd). Comps blocked: SerpAPI's eBay engine returns empty for everything while their status page reads 99.997% — retry later. Also: #138 pond-domain docs sweep, #141 Duck Ops ingress.md cleanup (their repo, bb8a70a), fedora.local:3000 firewalled → list-item skill API base now the pond vhost.

### 2026-07-09 — Ship queue: multi-order label flow (v2.0.54)

Built the label queue from ticket #159 (spec: `docs/specs/label-queue.md`). Select N orders in the Sites view (Reverb rows gained checkboxes; eBay checkboxes now dual-purpose with combine) → SHIP QUEUE (N) steps the label modal order-to-order in place: NEXT LABEL button advances via `dw.labelQueue` + `dw.openLabelEntry()` without closing, so the orders refetch fires once at the end. Package data (weight/dims) deliberately carries across steps; address/insurance/rates reset per order. NEXT disabled while the prior label's save/notify writes are in flight. Combine-ship untouched — same checkboxes, separate action. Docs: frontend-reference (ship-queue section), codebase-map (sites.js). Verified live mid-session (3-order queue); Geoff to finish testing — #159 stays open.

### 2026-07-07 — Tracker terminal-state + shared cache (v2.0.53)

Killed the 554-tracker-calls-on-load problem (#160): every Sold+tracking_id record re-polled EasyPost live on every dashboard/items load, unbounded with sales history. Fix persists delivered shipments in the DB and polls only in-flight ones. Migration added `tracking_status` + `delivered_at` to `shipments`; the tracker route (`label.js`) freezes the row when EasyPost reports delivered (idempotent, single writer); `isInTransit` rewrote to a pure function of stored fields; delivered packages render from stored data via `storedTracker()`, never a live call. Backfill script (`scripts/backfill-tracker-status.js`) froze 251 delivered / 8 in-transit in one pass so the first post-deploy load was already clean. Then deduped the fetch (#160 follow-on): dashboard/items/shipping-modal each ran their own `_loadTracking` against separate `trackingData` stores, so each in-flight tracker was polled 2-4× per load. Hoisted into one shared `$store.dw.trackingData` keyed by `tracking_id` (a tracker belongs to a shipment), fetched once in `fetchAll`, read by all views. Net: 554 → 8 tracker calls, each fired once. Spec: `docs/specs/2026-07-06-tracker-terminal-state-design.md`. Filed #159 (bulk/queue label flow) and #161 (buyer_city rendered but never populated) as parked follow-ons.

### 2026-07-06 — Sites order-refresh cleanup (v2.0.52)

Diagnosed a page-load slowness Geoff noticed on the Sites/checkout view: the 4.8s wasn't server-side (TTFB ~180ms) but browser connection stall — order calls queued behind a hard-refresh's full boot traffic. Not a bug. The real cleanup (#158): `fetchOrders` had no in-flight guard (unlike `checkOrders`), so overlapping triggers from the three stacked `$watch` handlers (view-enter, modal-close, `ordersRefreshTick`) each ran the full pair of live eBay/Reverb calls — notably the header "check orders" button double-fires by setting `activeView='sites'` and bumping the tick in one expression. Fixed in `sites.js`: guard coalesces concurrent/re-entrant calls (collapses the double at the source, no index.html change), `try/finally` so the loading flag can't stick, and stopped blanking the lists up front (killed the blank-then-refill flash — helpers overwrite on success). Corrected a mid-session miss: `/api/inventory/{sku}` is a local SQLite read, not a live eBay call, so the per-SKU location fan-out is cheap. Filed #159 (bulk/queue label flow) as the separate UX bother. Verified empty-queue case live; the double-fire/flash fixes need real orders to fully confirm.

### 2026-07-01 (nightcap) — #156 CLI --update fix (v2.0.51)

Short session. Fixed #156: `bulk-list-discs.js --update` gated on `metadata.listPrice`, which #134 nulls once a disc is listed, so every listed disc skipped. Update mode now trusts the `/api/inventory` join: skips "not listed" when there's no active listing row, shows the live `listing_price` in the dry run, and stops reading the blob price entirely (title/price authority is server-side via `resolveListedFields`). Verified with a read-only dry run against the NUC over an SSH tunnel (DWG-009 shows its real $23). Context landed post-fix: the CLI is off the daily path (web catalog flow is the listing surface, retirement is #139 Phase 4), so this was a tail-fix on a deprecated tool; #156 closed with that note. #157 (Finances API fee capture) untouched, stays open.

### 2026-07-01 (later 8) — Fable audit night: docs burndown, money-model archaeology, TRS policy fix (v2.0.50)

Long warm session, three arcs. First Fable session; sonnet subagents did the legwork.

**Docs/debt audit + burndown.** Five-agent archaeology of what the doc-split lost (synthesis: `docs/notes/2026-07-01-docs-debt-audit.md`); filed #143–#153, then burned down the same night: api-reference carries the full `/api/ebay` surface + do-not-reinvent pipeline map + schema invariants (#143/#144); frontend-reference rewritten to code reality, Sites view documented, phantom SITE_FEES killed (#145); codebase-map + scripts/README swept (#146); GOTCHAS +10 dated war stories (#147); `price_history` + `traffic_snapshots` capture live (#149/#150); lot cost reads `lots.total_cost` (#148, needs the real DG figure to light up); catalog sort persists (#153); navToItems site-filter bug found by the doc agent while verifying, fixed (#154).

**Money model, settled the hard way.** #136 was a misdiagnosis (its "missing fees" math was circular): `orders.sale_price` IS the post-fee payout on both platforms, so realized profit was never fee-blind. What shipped: `orders.fees` column (defaults 0, escape hatch), profit = payout − fees − cost − actual shipping, momentum chart stops re-subtracting formula fees (it had been understating net), take-home labels, `siteFee()` as the one estimate formula (#152). One mid-thread overreach (storing gross + derived fees) got reverted; stored sale prices untouched. Shipping (#137, realized half): 68 pre-shipping-flow rows had their listing estimates materialized into `shipment.shipping_cost` (displayed numbers unmoved), then the estimate fallback on sold items died. Full forensics in GOTCHAS (tax hides in eBay's fee base; the Finances API basis excludes it).

**TRS discount hunt → real bug.** Added `sell.finances` scope (re-auth done). Root cause of sporadically missing Top Rated Plus discounts: return-policy roulette (`returnPolicies[0]` across four account policies, two of them hidden buyer-pays) plus offer PUTs stripping policy IDs off live listings (#155). Fixed: pinned free-returns policy (Geoff's deliberate call), explicit policy IDs on every PUT, fleet sweep re-attached 92/93 active discs (DWG-086 locked by a pending Best Offer, heals on next touch). CLI `--update` stale blob-price guard → #156. Finances-API fee capture parked as #157.

**Deferred to cold sessions:** #151 DG analytics pack (design together), #137 estimate half (stored mint defaults), DG lot `total_cost` value, the one non-disc listing still on buyer-pays returns, ghost-policy deletion in Seller Hub.

### 2026-07-01 (later 7) — #139 verified end-to-end + polish (v2.0.46–v2.0.49)

Tested the web bulk-list live and hardened it. **Full round-trip proven in production:** upload a photo pile → server chunks/maps to Prepping discs → preview → BULK LIST → 2 discs went live on eBay with the right title (`items.name`), staged price, SKU, photos → teardown (withdraw + delete offer/inventory-item on eBay, revert DB to Prepping, delete photos) left them pristine. Zero CLI.

Polish shipped while playing with it:
- **413 on upload** — nginx `dash-pond.conf` vhost had no `client_max_body_size` (1MB default) → added `512M` (Geoff ran the sudo; Beardy review = **#141**). App itself handled 5MB direct in 4ms; RAM headroom is fine (13Gi free) so multer stays memory-storage.
- **Disk-backed preview (v2.0.47):** preview reads `photo-status` (disk truth) instead of the last upload response, so it survives range changes.
- **Decoupled range from the preview set (v2.0.48):** the range is now only the *upload target*; the preview/list set = current range ∪ every Prepping disc with photos on disk (`blkReadyDiscs`/`blkPreview`). Populate large, re-shoot a few narrow, list the lot.
- **Title tooltip (v2.0.46)** and **catalog status filter ALL/INTAKE/LISTED (v2.0.49).**
- **Dead-disc cleanup:** the #134 item-at-intake backfill had resurrected two mislisted-and-ended orphans (DWG-178/224) as Prepping; the disk-backed ready-set surfaced them via old photos. Deleted them (records + photos). Filed **#142** — model gap: no terminal `Ended`/pulled-unsold item status.
- Test SKUs 293/294 deleted at session end (records + photos); `next-disc-num` back to 293.

**#139 lean v1 is done and proven.** Deferred: boundary-nudge, HEIC-in, Phase 4 cutover (retire the list CLIs).

### 2026-07-01 (later 6) — #139 web bulk-list: spec + Phases 1-3 lean v1 (v2.0.45)

Started "get listing off the CLI." Spec: `docs/specs/2026-07-01-web-bulk-list-design.md`.

- **Design (aligned in-session):** intake (done, #134) → shoot in DWG order → drag a JPEG pile into the catalog → server chunks by N + maps to Prepping discs ascending → preview → confirm → offers created + published. Browser upload over rsync (no reverse SSH — too fragile); associate at listing stage, not intake; JPEG-in baseline (HEIC deferred); immediate publish. Reuses the proven `bulk-list` mint path (CLI-first-then-absorb).
- **Phase 1 — disk-read mint (v2.0.43):** `bulk-list` reads photos from `dg-photos` (`DWG-{id}-{n}.jpeg`, unpadded id) when no multipart upload. Glob/sort verified (DWG-10 vs DWG-100 disambiguation, numeric suffix sort).
- **Phase 2 — upload/map + readiness (v2.0.44):** `POST /api/ebay/bulk-list-photos` (chunk by N, map to discIds, write `dg-photos`, clear a disc's prior photos on re-upload) + `GET /api/ebay/photo-status` (count per id). Both verified on the NUC.
- **Phase 3 lean v1 — the UI (v2.0.45):** a "Bulk List to eBay" section in the catalog: DWG range → resolves Prepping discs; photos + photos-per-disc → UPLOAD + MAP → thumbnail preview (disc ↔ photos ↔ title ↔ price) → BULK LIST → per-disc results. Skipped the boundary-nudge (fixed-N, polish later per the lean-first call).
- **NOT yet tested end-to-end** — listing publishes **live** to eBay, so Geoff drives that with real catalog items later today. Backend proven; the UI is unverified in-browser.
- Deferred to Phase 3.1+: boundary-nudge preview, pre-upload readiness badges, HEIC server-side, Phase 4 cutover (retire `bulk-list-discs.js`/`rename-disc-photos.js`/`convert-photos.js`).

### 2026-07-01 (later 5) — #134 Phase 5: docs + close

Closed out #134 (all five phases shipped + verified). Docs reconciled to the new lifecycle:
- **GOTCHAS.md** — new "Disc catalog & titles" war-story: the canonical homes (price → `listings.list_price`, title → `items.name`, lifecycle → `items.status`), the blob-is-spec/staging rule, and the `refresh-disc-titles` recovery. Also fixed a stale NUC DB path (pointed at the retired `/home/geoff/...` checkout → `/srv/duckwerks/dash/data/duckwerks.db`).
- **api-reference.md** — catalog-intake section was describing a dead Google-Sheets backend; rewrote to the DB-backed reality + the `refresh-titles` endpoint; schema notes `items.name`/`items.status`/`listings.list_price` as canonical and `inventory.status` as a tombstone.
- **codebase-map.md** — item-minted-at-intake, `resolveDiscTitle`, the enriched `/api/inventory` join, PATCH re-materialization.
- **scripts/README.md** — `refresh-disc-titles.js` replaces the retired `clean-disc-titles.js`.
- **CLAUDE.md** (earlier this session) — corrected the deploy model to working-tree rsync (deploy ≠ commit-gated), matching the Duck Ops NUC refactor.

**Net of #134:** one canonical home per fact (price/title/status), item coupled at intake, blob demoted to spec + junk-drawer, the third head (dashboard lagging eBay) reconciled, and the manual title regen formalized as a command. Follow-ups filed: #138 (domain/ZT doc), #139 (web LIST + image rsync), #140 (edit panel → structured inputs).

### 2026-07-01 (later 4) — #134 Phase 4: refresh command + third-head reconcile (v2.0.42)

Formalized the title regen and closed the "third head" (`items.name` lagging eBay).

- **`refresh-titles` endpoint + script.** `POST /api/catalog-intake/refresh-titles?confirm=` re-materializes `items.name = resolveDiscTitle(blob)` for every non-Sold disc (server-side, where the real DB lives); `scripts/refresh-disc-titles.js` wraps it (dry-run default, `--confirm`, `--push`). Runs on the NUC (`:3000` isn't LAN-exposed) — `ssh geoff@fedora.local "cd /srv/duckwerks/dash/current && node scripts/refresh-disc-titles.js …"`. Retired `clean-disc-titles.js` (pre-NUC, hit the stale local DB, and its null-then-regen would destroy overrides).
- **Caught + fixed a self-inflicted bug:** first cut *skipped* override discs (`if list_title continue`), which left their `items.name` stale. `resolveDiscTitle` already returns an override verbatim, so the skip was redundant AND harmful. Corrected to materialize all via `resolveDiscTitle` — overrides still survive template changes for free (the template can't move them), and their stale names get fixed.
- **Reconciled 93 discs, DB-only, zero eBay push:** 67 generated titles (old mint-time format → current recall-first template) + 26 curated overrides (`items.name` → the override value). All now equal what's on eBay (Geoff never hand-edits eBay, so template output == live). Idempotent: re-run reports 0. `items.name` is now the true source across catalog, dashboard, and push.
- Filed #138 (domain/ZT doc), #139 (web-based LIST + image rsync, retire CLI), #140 (edit panel → structured inputs). Fixed a pre-existing Alpine bug (inventory `x-for` had 3 root elements, silently dropping the edit + preview panels).

### 2026-07-01 (later 3) — #134 Phase 3: title materialization (v2.0.39)

`items.name` is now the canonical materialized title on every read; the blob's `list_title` is pure spec (override-or-null). Nothing generates a title on the hot path.

- **Hot path reads `items.name`.** `bulk-update`/`bulk-preview` resolve title + price from the engine via `resolveListedFields(sku)` (items.name + active listing price) and hand both to `buildDiscPayload(blob, {title, price})`. The builder only falls back to `resolveDiscTitle(blob)` when no name is passed (pre-item preview). `bulk-list` still materializes `items.name` at mint from the spec.
- **Catalog display reads `items.name`** (`item_name` added to the `/api/inventory` join); `inventoryDisplayTitle` falls back to the blob-composed string only for an item-less row.
- **Spec edits re-materialize.** PATCH `/api/inventory/:sku` now recomputes `items.name` from the merged blob for disc rows (never touches a Sold item's name), so a raw-editor spec/override change flows to the canonical title and the next push. `saveEdit` reloads the list to pick up the new join fields.
- Bundled a small pre-existing fix (v2.0.38): intake save now refreshes the inventory list so a just-cataloged disc appears without a manual reload.

### 2026-07-01 (later 2) — #134 Phase 2: couple item at intake + unify status (v2.0.37)

- **Item minted at intake.** `catalog-intake POST /disc` now creates the `items` row (status `Prepping`, name materialized via the new `resolveDiscTitle`) alongside the `inventory` blob — item exists from birth, so listing becomes pure association. `bulk-list`'s `dbWriteDiscListing` finds-and-associates the existing item (flips to `Listed`, re-materializes name) instead of always creating one; still creates as a fallback for pre-coupling SKUs.
- **Status unified on `items.status`.** `inventory.status` retired to a dormant tombstone: dropped the `markDiscSold` write (removed from `catalog-intake` + `orders.js`), and the catalog "hide sold" filter now reads `item_status` (added to the `/api/inventory` join), case-insensitive. This also fixes a latent bug — DWG-209 was sold but still showed in the catalog because its `inventory.status` was a stale `listed`; the `item_status` filter correctly hides it.
- **`resolveDiscTitle` extracted** in `ebay-builders.js` (the single title-resolution point: `list_title` override else generated) and shared by intake, mint, and `buildDiscPayload`.
- **Migration:** backfilled the 2 orphan intake rows (DWG-178, DWG-224) with `Prepping` items; zero orphans remain — every inventory row now has an item.

### 2026-07-01 (later) — #134 lifecycle refactor: spec + Phase 1 (price authority)

Turned the "one fact, three stores" drift (#134) into a design and shipped its urgent slice. Full design: `docs/specs/2026-07-01-catalog-item-lifecycle-design.md`.

- **The model.** One canonical home per concept: live price → `listings.list_price` (per marketplace), title → `items.name` (materialized), lifecycle → `items.status`. The blob is spec + junk-drawer — `listPrice` is intake *staging*, `list_title` is the title *spec* (override-or-null), and the genuinely-homeless fields (plastic, run, color, notes, flight numbers). Price stays on the listing, never `items` (an item's eBay and Reverb prices can differ; putting price on the item just recreates the drift one level up). Coupling `items` at intake is 99% de-facto true already (290/292 inventory rows have an item row).
- **Spec is 5 phases, each shippable:** (1) price authority [done], (2) couple item at intake + unify status on `items.status` + retire `inventory.status`, (3) title materialization (`items.name` canonical), (4) refresh command (formalize the 07-01 regen), (5) GOTCHAS + docs. Written cold-blind with per-phase migrations/verification/checkpoints.
- **Phase 1 shipped (v2.0.36).** `bulk-update`/`bulk-preview` now resolve price from the active listing row (new `resolveListingPrice` in `ebay-listings.js`), not `blob.listPrice` — so a catalog-driven push can no longer revert a live price to a stale blob value. `buildDiscPayload(blob, {price})` takes the resolved price; blob stays the fallback for unlisted previews. Catalog UI reads/sorts/seeds price from `listing_price` (added to the `/api/inventory` join alongside `listing_id`) via a new `displayPrice()` helper; `savePriceEdit` writes the listing row (PATCH `/api/listings/:id`) for listed discs, blob staging for unlisted.
- **Safety gate:** re-confirmed zero numeric price drift across all 93 active discs before flipping reads to the listing row.

Chased the "cool discs get zero views" puzzle to its root and reshaped the disc-listing pipeline. Analysis worklog: `docs/notes/dg-cohorts-worklog.md`.

- **Diagnosis: recall, not rank.** Traffic + SerpAPI field/sold scans showed the stalled tail was priced fine (at/below comp) but invisible: 26 Axiom/Streamline titles carried no "MVP" (the parent brand buyers search), 0/94 had "disc golf", 0 had a disc *type* word. Top-rated/promo/price are rank levers; they can't put you in a search your title doesn't match.
- **New title template** (`generateDiscTitle` in `ebay-builders.js`): recall-first — `[MVP] brand mold [notes] plastic type + Disc Golf + color + weight + condition`, priority-drop assembly under eBay's 80-char cap. `run` dropped by default; SimonLine normalized; factory/lab seconds surface their real grade instead of a false "Unthrown".
- **26 signature/event discs** got hand-curated `list_title`s (Lizotte, McBeth, Jennifer Allen, event stamps, First Runs) since the blanket template drops `run`.
- **Surgical price changes off SOLD comps**, not the big slash we assumed: 3 real cuts (Meteor $25→18, Time-Lapse $26→19, Saint $23→20) + −$1 on the seen-but-stuck view-getters. Zero-view discs left alone (never seen ≠ price problem).
- **Two denormalization bugs caught pre-push:** catalog `listPrice` drifted from the live listing (the $89 ghost on DWG-009) — hand-synced 11; and `bulk-list-discs` sent the curated title as `title` while the builder reads `list_title` — fixed. Filed **#134** for the underlying "one fact, three stores" (blob / `items.name` / `listings.list_price`).

### 2026-06-30 — Deploy migration onto the Duck Ops standard; Dash named

Continuation of the 06-29 session, into the org/ops collaboration.

- **Named the seat:** I'm **Dash** (for Dashiell Hammett, Pinkerton op turned detective novelist). Codified in CLAUDE with the sibling seats (Gator/Hunter/Beardy).
- **Printing docs fixed to current reality:** api-reference still described the old `PRINT_SERVER_URL` Mac-print-server proxy; the code moved to direct ZPL-over-raw-TCP to the Zebra ZD420D (`ZEBRA_PRINTER_IP:9100`, EasyPost ZPL, PDF fallback). Rollo is gone (sold).
- **Deploy migration (with Beardy/Duck Ops):** wrote a deploy-consumer brief (`docs/deploy-requirements.md`) as the NUC's biggest consumer. Surfaced the load-bearing catch — `better-sqlite3` is native, so "build on Mac → rsync node_modules" breaks (macOS-arm64 binary won't run on Linux-x64); resolved to `npm ci` on the NUC into the new release dir (atomic-swap preserves immutability, better-sqlite3 ships prebuilts). Beardy executed the cutover: state externalized to `/srv/duckwerks/dash/{data,dg-photos,.env}`, `scripts/deploy.sh` + `ecosystem.config.js` in the repo, `docs/deploy.md` is the live procedure.
- **Reconciled dash's docs to the cutover:** `db.sh` repointed to the /srv DB (was the retired /home/geoff checkout), CLAUDE deploy rules rewritten for `./scripts/deploy.sh` + the artifact model, codebase-map/docs-index/gitignore updated, package-lock root version synced for `npm ci`.
- **Topology call:** dash stays on Cloudflare ZT (no auth build); see the 06-29 entry below.
- Tickets: #133 tracks the dash adoption tail (verify token refresh, first real Mac deploy, retire old checkout). #132 parks a close-out skill. #123-131 closed.

### 2026-06-29 — Topology decision: dash stays on ZT, no auth build

Recon on Duck Ops (read-only) found the deploy standard is doctrine-locked (rsync immutable artifact → PM2, no git on NUC) but the spec is unbuilt: Ops #3 (deploy template) not started, #4 (dash migration spec) gated behind #3. So dash's deploy migration can't start yet; it stays parked until #3 lands.

The Ops #8 "drop Cloudflare → own nginx" goal carried a `blocked on dash auth` dependency. Geoff's call: that's a wild requirement for a single-user tool. Redefined the goal to *legible topology, not zero-Cloudflare*. **dash stays on Cloudflare ZT as the one tunnel app** (ZT is its auth, nothing critical on it); everything else consolidates onto nginx. This deletes the dash-auth build entirely and unblocks #8 by redefinition. Updated dash's CLAUDE org-place line to match. Pushback to be carried to the Ops #8 thread.

### 2026-06-29 — Doc-split: finish the org doc-surface conversion

Caught dash up to the org doc standard (recon: Gator standard + Hunt canon + dash gap). Filed #124–131, did all eight in one pass.

- **Surfaces built:** `GOTCHAS.md` now holds the migrated eBay traffic-metric + Alpine-modal gotchas plus new Database (node -e hang / stale local db) and NUC/PM2 (PIDFile) sections. New `docs/claude/codebase-map.md` (the file-by-file map extracted from CLAUDE). New `docs/index.md` (deeper-docs landing the public README links to). New `scripts/db.sh` (sanctioned sqlite3 wrapper, retires the node -e footgun).
- **CLAUDE.md thinned:** dropped duplicated Stack/Running Locally/Version Control facts; collapsed Checkpoint + Session Close into one Ship Procedure; dropped the WIP banner; kept the deploy-in-transition steer.
- **README → public face:** the repo is public, so README is now a lean overview (highlights, stack, quickstart, deploy one-liner) that links out to the case study (duckwerks.com/work/duckwerks-dashboard) and `docs/index.md`. Em-dash-free.
- **Key decision:** README is public here, inverting the org default (README = hook-injected spine). dash's cold-start spine = auto-injected CLAUDE + on-demand docs/. Verified by a README-hidden cold-read: orientation sufficient, no gap. So augmenting the inject-readme hook is optional org-tier cleanup, not needed for dash.
- Spec/recon notes: this was light-touch, no spec written; recon digests drove it.

### 2026-06-29 — Combine same-buyer eBay orders into one shipment

- One buyer placing multiple separate eBay orders can now be shipped on a single label (issue #123). Sites page: checkbox per eBay order, "COMBINE & SHIP (N)" bar at 2+ checked, gated to same shipping address.
- Generalized the label modal from "one order, N line items" to "N order-groups, one label." The old single-order and multi-item-in-one-order paths now flow through the same loop. `markShippedEbay` loops every group's order ID, so each order gets tracking pushed (kills the manual Seller-Hub paste).
- Shipping cost now **evenly amortized** across all records (was: all-on-primary, $0 secondaries) — applies to combine and the existing multi-item path.
- Packing slips: combine mode renders one per order (PACKING SLIP 1/2/3), reusing the existing per-order eBay print-page button. Modal header gains a "one label · N items" summary.
- eBay orders on the sites page now sort by buyer name, so same-buyer (combinable) orders cluster.
- ORDER DETAILS button on the label result now shows only on eBay-ship failure (was: any not-yet-shipped state), killing the flash-and-vanish as `markShippedEbay` resolves.
- Spec: `docs/superpowers/specs/2026-06-29-combine-orders-shipping-design.md`
- v2.0.31 → v2.0.34

### 2026-05-23 — Sortable DG inventory with analytics columns

- Added sortable table to catalog page inventory section (SKU, Loc, Mfg, Mold, Title, Price, Views, Imp, CTR)
- Traffic data (views/impressions/CTR) fetched from eBay on catalog page load, cached in shared `Alpine.store('dw').trafficMap` so analytics page reuses it without a second fetch
- `GET /api/inventory` now returns `ebay_listing_id` via LEFT JOIN on items/listings
- Analytics view writes traffic fetch into shared store
- Rewrote inventory list from flex divs to `table.tb` matching items view style; header sort clicks replace old sort-button bar
- v2.0.30 → v2.0.31

### 2026-05-23 — Fix analytics impressions metric

- Analytics page was showing `LISTING_IMPRESSION_TOTAL` (organic search only) instead of `TOTAL_IMPRESSION_TOTAL` (includes promoted listings)
- Discovered by comparing API data against eBay Seller Hub — towel showed 357 vs 2,272 impressions
- One-line fix in `server/ebay.js` traffic route
- v2.0.29 → v2.0.30

### 2026-05-18 — Listing session: 4 items (2 eBay, 2 Reverb)

- Listed Rollo X1038 thermal label printer on eBay — $100, free shipping (https://ebay.com/itm/168384727153)
- Listed Qogir disc golf resistance trainer on eBay — $20, Disc Golf lot (https://ebay.com/itm/168384756001)
- Wrote Reverb listing for Hercules GSP38WB PLUS wall hangers pair — $30
- Wrote Reverb listing for Donner Ultimate Comp compressor pedal — $25
- Created docs/ebay-category-map.json with Electronics > Printers (1245) and Disc Golf Accessories (184360)
- Learned condition enum format: Inventory API uses strings (USED_EXCELLENT, NEW_OTHER) not numeric IDs
- v2.0.28 → v2.0.29

### 2026-05-16 — Insurance toggle in label modal; disc golf defaults uninsured

- Added INSURE checkbox to label modal; unchecked = no insurance field sent to EasyPost at all
- Disc golf items default to unchecked; all other categories default to checked
- eBay high-value auto-bump (>$100 → insuredAmount = sale price) still works; just ignored for DG unless you check the box
- Fixed server-side `easypostPurchase` to omit `insurance` from payload when not passed (was always sending it before)

### 2026-05-16 — Inline price edit with keyboard tab flow in catalog inventory

- Price cell in inventory list is now focusable and editable inline — click, Enter, or type a digit to activate
- Tab from input → QUEUE button; Tab from QUEUE → saves to DB, queues for eBay batch update, advances to next row
- Typing a digit while focused on the price span seeds the input with that digit (no Enter required)
- v2.0.27 → v2.0.28

### 2026-05-16 — Catalog intake cleanup + script purge

- Stripped Google Sheets entirely from `catalog-intake.js` — `next-disc-num` now reads max SKU from inventory DB; disc POST writes directly to inventory DB; no network calls on save
- `catalog-intake.js` disc POST now calls `normalizeBlob` and includes `notes`; `_reset()` condition fixed from `'Unthrown'` → `'NEW'`; status set to `'intake'` on new discs
- Deleted 9 dead scripts (all sheet backfills, one-time migrations, dead print server, push-titles one-shot)
- Added `scripts/README.md` — one-liner index of all active scripts
- v2.0.26 → v2.0.27

### 2026-05-16 — eBay listing/update refactor (ref #121)

- Extracted `server/ebay-client.js` — all shared eBay API plumbing (headers, policies, location, EPS upload, inventory item PUT/GET, offer upsert/update/publish). Pure functions, no Express, no DB.
- Created `server/ebay-builders.js` — `buildDiscPayload(blob)` transforms inventory blob → normalized payload; `renderDescriptionHtml` unifies description rendering; `renderSkillDescriptionHtml` handles skill checkpoint text; `minOffer` helper
- Rewrote `server/ebay-listings.js` — 500 lines removed, thin route handlers only; all six route names preserved (zero changes to callers)
- Fixed trailing `\n` on Notes spec line (minor output cleanup)
- Confirmed pre-existing USED disc condition bug (errorId 2004) is unchanged/tracked as #121
- Fixed USED condition bug: migrated 12 DB rows USED → USED_EXCELLENT on NUC; added normalizeCondition() guard in builder. Category 184356 has no sub-grades in UI but API requires USED_EXCELLENT (its internal default for "Used")
- Documented two-mode architecture: inventory-backed (disc builder) vs session-backed (skill checkpoint) in plan doc
- v2.0.25 → v2.0.26

### 2026-05-15 — Title cleanup: remove Unthrown, clear curated titles

- Removed "Unthrown" from generateTitle(); USED discs still get "Used" appended
- Nulled list_title on all 87 non-sold inventory blobs
- Pushed regenerated titles to eBay for 145/153 active listings via bulk-update route
- 6 USED disc failures: pre-existing bug in bulk-update (condition serialization); titles already correct on eBay
- 2 eBay 500s (DWG-173, DWG-175): transient, listings exist
- Added push-titles-to-ebay.js one-shot script (delete after use)
- v2.0.24 → v2.0.25

### 2026-05-15 — SQLite WAL bloat fix

- 5.8M WAL against 596K main file; TRUNCATE checkpoint reclaimed it immediately
- Added hourly `PASSIVE` checkpoint via `setInterval` in `server/db.js`
- Root cause: long-lived PM2 process holds connection open, blocking WAL auto-truncation
- v2.0.23 → v2.0.24

### 2026-05-09 (continued) — catalog batch eBay update flow

- Edit row → save → row closes with blue QUEUED tag + left border indicator
- Batch banner shows queued count; "UPDATE ALL ON EBAY" fires sequentially with X / N progress
- UPDATED badge is a clickable link to the listing; individual UPDATE EBAY button still works independently
- Auto-trigger eBay preview after single row save (later replaced by queue flow)
- VIEW → link after single-row confirm update
- v2.0.22 → v2.0.23

### 2026-05-09 — inventory blob schema + condition enum cleanup

- `server/inventory-schemas.js` — canonical disc blob schema (17 keys); `normalizeBlob()` used by all write paths
- Backfill re-run: all 292 disc blobs now have all schema keys; missing values are `null` instead of absent
- Condition field migrated to eBay enums: `NEW` / `NEW_OTHER` / `USED` (was freeform `Unthrown`/`Used`)
- `ebay-listings.js` — condition passed through directly; title generator maps enum to display string
- Catalog intake condition buttons updated to the three enum values
- PATCH route normalizes metadata against schema on every write
- Added "The NUC" section to CLAUDE.md; clarified memory vs. CLAUDE.md boundary
- v2.0.21 → v2.0.22

### 2026-05-08 — analytics + network mapping (no code shipped)

- Investigated analytics view: Browse API used only for listing enumeration (to get IDs for traffic_report); Sell Analytics already in use
- All 202 active eBay listings have offer_id + item_sku via items join on NUC DB; listings.sku column is unused/null
- Concluded: Inventory API swap would be under-the-hood only, no new analytics data unlocked; Browse API left as-is
- Mapped home network devices via `sudo nmap -sn 192.168.68.0/24`; full device list documented in session log
- NUC SSH: `ssh geoff@fedora.local`, project at `/home/geoff/projects/duckwerksdash`

**Network map (192.168.68.x):**
.1 Deco node | .100 iPhone | .101 MBA wired | .102 Govee ceiling light | .103 AiDot kitchen bulb | .104 Govee curtain light | .105 Zebra printer | .106 Roku | .107 Govee icicle light | .108 Canon printer | .109 AiDot bedroom bulb | .110 iPad | .111/.112 AiDot kitchen bulbs | .113 Apple TV | .114 NUC (git.duckwerks.com) | .115 MBA wifi | .116 Zia's Govee ceiling light | .117 TCL TV | .118 Zia's Findpop ceiling light | .249/.250 Deco nodes

### 2026-05-06 (continued 3) — inventory catalog UX + eBay update flow

- Inventory summary row now shows category, location, list price, and generated display title (`list_title` if present, else assembled from disc metadata fields)
- `inventoryDisplayTitle()` helper in catalog.js — category-aware title generation
- `POST /api/ebay/bulk-preview` endpoint — generates title, description, price without touching eBay
- "UPDATE EBAY" button on each inventory row: preview → CONFIRM → POSTING TO EBAY... → POSTED TO EBAY inline result
- Sold discs hidden by default in catalog inventory; "SHOW SOLD" toggle added
- `GET /api/inventory?excludeStatus=` filter added to inventory router
- deploy-nuc.sh trimmed: removed one-time `migrate-plastics-table.js` and `sudo systemctl restart cloudflared` (was running on every deploy unnecessarily)
- v2.0.20 → v2.0.21

### 2026-05-06 (continued 2) — full metadata backfill (issue #119)

- `backfill-inventory-metadata-from-sheet.js` — reads all disc metadata cols (F-X: manufacturer, mold, type, plastic, run, notes, condition, weight, color, flight numbers) into blobs; run on both Mac and NUC
- Google Sheet is now fully redundant — all data is in the inventory DB
- 4 discs (DWG-146/147/148/158) have surviving AI-written descriptions from the list-item skill

### 2026-05-06 (continued) — inventory API + bulk-list + catalog edit (issue #119)

- `POST /api/inventory` upsert route added; `GET /api/inventory?ids=` range filter added
- `bulk-list-discs.js` rewritten to read from inventory DB instead of Google Sheet; drops `--sheet`/`--csv` flags
- Backfill script `backfill-inventory-copy-from-sheet.js` — merges list_title + listPrice from sheet into existing blobs (292 rows); run on both Mac and NUC
- Catalog inventory edit panel redesigned: EDIT explodes blob into all k/v pairs, all values editable inline
- v2.0.19 → v2.0.20

### 2026-05-06 — local inventory table (issue #119)

- New `inventory` SQLite table: `sku PK`, `location`, `category`, `status`, `metadata JSON`
- New `/api/inventory` router: GET list, GET by SKU, PATCH by SKU
- Backfill script reads Google Sheet cols A+B → 292 DWG-NNN rows with box locations; run on both Mac and NUC
- Catalog intake now writes to `inventory` on every new disc (location + full metadata blob); sheet kept as backup
- Location chip shown in sites view order rows (eBay + Reverb) after Check for New Orders
- Location column added to shipping (in-transit) modal
- Inventory table with inline location edit added to Catalog view
- v2.0.18 → v2.0.19

### 2026-05-05 (continued 4) — archive-grabber extracted (issue #118)

- Moved `scripts/archive-grabber/` to standalone repo `~/projects/archive-grabber`
- Added note to CLAUDE.md scripts table pointing to new location
- Webapp design spec written and committed in new repo — ready to build

### 2026-05-05 (continued 3) — backfill improvements + more artist runs

- `backfill-track-titles.py`: `--artist` no longer requires config entry — derives path from `output_dir/artist`; `--artist-dir` kept for explicit path override
- `backfill-track-titles.py`: `glob` → `rglob` for txt/FLAC discovery to handle nested IA item directories (some uploaders package files in subdirs)
- `backfill-track-titles.py`: added plain setlist fallback parser — handles `d1-Song` prefix format and plain lines under Set/Disc headers; covers most GD txt formats
- Galactic, MMW runs kicked off; GD, MMW, Galactic all running in parallel; backfill pending after completion
- Pending: run backfill for GD, MMW, Galactic when downloads finish

### 2026-05-05 (continued 2) — archive-grabber config + client setup

- Switched GD, Kimock, Galactic, MMW to `search_query` with server-side filters; GD needed `NOT collection:stream_only` (Dead locked all SBDs) + AUD added to sources
- Added `--query` CLI flag for ad-hoc grabs without touching config — takes raw IA query + `--artist` for output dir; optional `--sources`
- Discovered `stream_only` is a collection membership, not a field — `NOT collection:stream_only` is the correct filter
- Runs completed: JGB (328 shows), Kimock (filtered to 44 high-download 5-star shows), KVHW, GD (54 AUD shows)
- Switched iOS client from Symfonium to Amperfy — cleaner, no ads, CarPlay working
- `backfill-track-titles.py` run for GD, KVHW, Kimock, JGB

### 2026-05-05 (continued) — archive-grabber query optimizations

- `grabber.py`: `min_rating` now pushed into IA query for collection-based artists (was filtering locally — wasted API traffic)
- `grabber.py`: added `downloads` field to `search_items` fields list
- JGB `search_query` updated with `AND downloads:[100 TO null]` — trims 1,692 candidates to ~260
- All three runs (KVHW, Kimock 2001+, JGB) confirmed running; 323GB / 13,002 items on NUC at session close

### 2026-05-05 — v2.0.18 archive-grabber improvements + NUC infrastructure

- `backfill-track-titles.py`: added support for etree `d1t01 - Title` format; fixed pending medley flush when next numbered track is encountered
- `grabber.py`: added `search_query` config option (overrides collection-based search for mixed/non-standard collections); added `min_rating` filter
- Added KVHW collection to config; removed Steve Kimock `date_range`; fixed JGB to use `search_query: "collection:taperssection creator:Jerry Garcia"`
- Navidrome exposed externally at `music.duckwerks.com` via existing cloudflare tunnel (added ingress rule); added to PM2
- Gitea data moved from `/mnt/BRData/gitea` to `/mnt/BRPlayground/gitea`; fixed permissions (`chmod o+x /mnt/BRPlayground`)
- NUC git remote switched to SSH (`git@github.com:ringleader3/duckwerksdash.git`)
- Runs in progress: KVHW, Steve Kimock (2001+), Jerry Garcia Band (1970–1985)

### 2026-05-04 — v2.0.18 archive-grabber tool

- Built `scripts/archive-grabber/` — Python script to download high-quality live concerts from archive.org
- Config-driven: per-artist collections, source type filters (SBD/FM/AUD), optional date ranges
- Scoring: source rank × 10 + rating tiebreaker; picks best version per show date
- Downloads FLAC + SHN (converts SHN → FLAC via ffmpeg); also grabs txt/md5/ffp metadata files
- State tracked per-show in `state.json`; safe to kill and resume
- `backfill-tags.py` — writes artist/album/date ID3 tags to already-downloaded FLACs from folder structure
- `backfill-track-titles.py` — parses setlist txt files and writes title tags; priority chain: embedded filename titles → txt setlist → Disc X Track Y pattern
- Track title parser handles: numbered lists, `Title (mm:ss)` format, multi-line medleys (`song > song`), Set/Disc headers, technical note stop conditions
- Installed Navidrome on NUC (PM2), pointed at `/mnt/BRData/plex/music`; streaming working via browser + phone (Symfonium via Subsonic API)
- Verified: SHN conversion, FLAC tagging, Navidrome organization all working end-to-end on Steve Kimock collection
- First run: ~45 Kimock shows (1974–2000), 41/45 with proper track titles

### 2026-05-03 — v2.0.17 eBay Inventory API migration complete (Tasks 5-7)

- Task 5: `importAll` in `sites.js` now calls `POST /api/ebay/migrate-listing` before `createListing` for eBay imports, stores `offer_id` on listing
- Task 6: `scripts/migrate-to-inventory-api.js` — two-pass bulk backfill; pass 1 migrates legacy listings (items with no SKU), pass 2 backfills offer_id for DG discs via `GET /offer`
- Removed `listings.sku` — redundant with `items.sku`; only `offer_id` needed on listings
- Fixed `bulk_migrate_listing` route to parse per-item results from non-2xx responses instead of bailing on whole batch
- Production run: 215 listings written with offer_id; 1 skipped (HIKE IT — eBay Motors category, offer not available via Inventory API)
- 12 legacy items needed SKUs written to `items.sku` manually (eBay had them from prior migration, we never captured them)
- HIKE IT (DW-hikeit-hxs722-3) left with NULL offer_id — eBay Motors edge case, same as documented

### 2026-05-03 — eBay Inventory API migration findings

- Confirmed: `bulk_migrate_listing` requires a custom label (SKU) already set in Seller Hub — Geoff set labels on all non-Inventory-API listings manually
- Confirmed: listings created via list-item skill or bulk-list-discs.js are already inventory items — migrate call is a no-op for those, pass 2 (GET /offer) handles them
- Confirmed: `offerId` returned = listing is an inventory item — that's the definitive test
- Tested migration against Giants DVD listing (168293691925) on NUC — worked correctly, returned real SKU + offerId
- Remaining: Task 5 (wire into importAll), Task 6 (bulk script), Task 7 (production run) — start fresh session

### 2026-05-02 — v2.0.16 eBay Inventory API migration (Tasks 1-4 of 7)

- Spec + plan written: `docs/superpowers/specs/2026-05-02-ebay-inventory-api-migration-design.md`
- Schema: added `sku` and `offer_id` columns to `listings` table (migration runs on startup)
- Server: `listings.js` POST + PATCH accept `sku` and `offer_id`
- Server: `POST /api/ebay/migrate-listing` — migrates up to 5 legacy listings to Inventory API model, returns sku + offerId per listing
- Server: `GET /api/ebay/offer?sku=` — fetches offer ID for a given SKU (for DG disc backfill)
- Fix: both Inventory API routes require `Accept-Language: en-US` header (eBay rejects Node's default)
- Fix: migration response maps `inventoryItems[0].sku` and `inventoryItems[0].offerId` (not top-level fields)
- Remaining: Task 5 (frontend import change), Task 6 (bulk script), Task 7 (production run)
- Note: listings with no custom label in Seller Hub will fail migration (error 25002) — non-DG manually created listings may need custom labels set first

### 2026-05-02 — v2.0.16 Multi-unit listings complete (Tasks 10-11)

- Tracking view: multi-unit items expand to per-order rows; single-unit items pass through unchanged; tracking keyed by order-{id} vs item-{id}
- Multi-unit modal: fixed partial not loading (assembleHTML regex didn't allow hyphens in partial names)
- Multi-unit modal: guarded null item in forecastedProfit/listPrice
- Quantity badge: fixed wrapping with white-space:nowrap
- Towel item set to quantity=15 manually via sqlite on NUC (eBay Browse API doesn't expose seller quantity in search summaries)
- eBay debug log removed; dead estimatedAvailabilities fallback removed
- End-to-end: towel shows "15/15" badge, multi-unit modal opens correctly with stat cards, progress bar, sales table

### 2026-05-02 — v2.0.15 Multi-unit listings (Tasks 1-9 of 11)

- Schema: added quantity/quantity_sold/oversold columns to items (migration runs on startup — prod DB auto-migrated on deploy)
- Server: items API exposes and accepts quantity; orders POST decrements quantity_sold for multi-unit items, caps at quantity, sets oversold flag
- Browse API sync: captures quantityAvailable from eBay, passes through to item creation on import
- Frontend: quantity badge (X/Y) replaces status pill for multi-unit items in INV view; click routes to new multi-unit modal
- Multi-unit modal: lot-style layout with stat cards, progress bar, per-order sales table
- Item modal: editable quantity field visible on multi-unit items
- Remaining: Task 10 (tracking view per-order rows) + Task 11 (delete/reimport towel validation) — continue next session

### 2026-05-02 — Bask Kaleidoscope 3 towel listed

- Ran comps for Bask disc golf towel (no Bask-specific comps found; generic disc golf towel market $12-20, specialty tier up to $25-30)
- Priced at $20 with $15 min offer — specialty tier based on commissioned art, dual-material Bask construction, 15x23 size
- Copy written with credit to Enero (SF Bay Area street artist) and Innova sponsorship
- Listing posted manually by Geoff to eBay — item 168349612758, quantity 18, $20 OBO
- All listing-sessions folders moved to completed/

### 2026-05-02 — v2.0.14 HIKEit listing fixed

- Original HIKEit listing (168347134292) became unbuyable after manual category change to eBay Motors (9886) broke listing state
- Ended broken listing via Inventory API offer withdraw, relisted manually via Seller Hub — new listing 168347293594, $70, active
- eBay Motors category 9886 requires ASSEMBLY-based fitment table (US_CARS_AND_TRUCKS) — cannot bypass via item specifics alone
- Confirmed: "out of stock" banner in Motors = broken listing state, not inventory quantity issue

### 2026-05-02 — v2.0.13 Six baseball card lots listed

- Created "baseball" lot (id 14) and "Trading Cards" category (id 5697) via SSH to NUC
- Listed 6 baseball card lots to eBay (category 261329 — Sports Trading Card Lots):
  - Pete Rose Vintage (6 cards, 1973-80, OPC) — $25 — 168347256666
  - Pete Rose 80s Bulk (21 cards, 1981-87) — $18 — 168347256763
  - Rickey Henderson (3 cards, 1981 Fleer) — $12 — 168347256895
  - 90s Home Run Era (7 cards, McGwire/Bonds/Canseco/Bo) — $20 — 168347256937
  - 70s Misc Vintage (12 cards, Fingers OPC/Murphy) — $20 — 168347256968
  - Junk Wax Bulk (250 cards, 1987-91) — $25 — 168347256359
- Added conditionDescriptors support to list-item endpoint (server/ebay-listings.js)
- Updated ebay-category-map.json with Trading Cards > Baseball Cards entry (261329)
- Key lesson: for new eBay categories, ask Geoff to look up the category ID from a live listing URL — don't thrash on API calls

### 2026-05-01 — v2.0.12 HIKEit XS HXS-722 throttle controller listed

- Listed HIKEit XS HXS-722 pedal/throttle response controller to eBay, lot geoffmedia — $70, SKU DW-hikeit-hxs722-2
- eBay Motors subcategories (9886 etc) rejected via Inventory API — require fitment table data not passed; workaround is list as Consumer Electronics (258) then manually recategorize in Seller Hub
- Category map updated with CE 258 entry and note about Motors fitment requirement
- Session moved to completed/

### 2026-05-01 — v2.0.11 ElfQuest WaRP Graphics spinoffs listed

- Listed 5 ElfQuest spinoff comic lots to eBay (lot #13): Kahvi, The Rebels, Shards, Two-Spear + Metamorphosis, Wave Dancers
- HEIC photos converted to JPEG in-place via `scripts/convert-photos.js --inplace` before posting
- Moved all 5 completed listing sessions to `docs/listing-sessions/completed/`

### 2026-04-29 — v2.0.10 Zebra ZD420 ZPL printing via raw TCP

- Replaced Mac local print server (LP/CUPS) with direct TCP socket write to Zebra ZD420D on port 9100
- `server/print.js`: now opens raw TCP socket to `ZEBRA_PRINTER_IP:9100`, fetches ZPL from URL, sends directly — no drivers, no CUPS
- `server/label.js`: switched EasyPost label_format to ZPL; returns `labelZplUrl` alongside `labelUrl`; EasyPost always includes `label_zpl_url` when ZPL format is requested
- `store.js` + `label-modal.js`: print button passes ZPL URL to print endpoint, PNG URL as fallback for window.open
- NUC `.env`: `PRINT_SERVER_URL` replaced with `ZEBRA_PRINTER_IP=192.168.68.105`
- `scripts/print-server.js` is now dead code (Mac local print server no longer needed)
- Tested end-to-end: ZPL fetched from EasyPost, sent via TCP, printed correctly on Zebra
- Printhead had dead elements on arrival; resolved by printing full-black 4x6 label to burn them in

### 2026-04-28 — v2.0.9 catalog intake polish

- Replaced manufacturer dropdown with typeahead search input — type to filter, arrow keys to navigate, enter to select; handles new manufacturers too (no separate "or new" field needed)
- Fixed disc type not resetting when mold changes — was sticking on first auto-set value (e.g. putter) for all subsequent molds
- Added MVP/Axiom/Streamline short-name aliases to disc_plastics (flight_numbers uses "Axiom" not "Axiom Discs")
- Gap analysis against Google Sheet: added 40 missing plastics — DGA (Proline, SP Line), Innova glow variants, Axiom/MVP/Streamline Eclipse/R2/Prism variants, Infinite Discs, Kastaplast K1 Soft/Glow, Discmania Forge, Discraft Recycled ESP/Z Flx, Gateway Smugglers Coffee, Millennium Standard, Hyzerbomb, Trash Panda, Lone Star Disc

### 2026-04-28 — v2.0.8 catalog intake improvements + disc_plastics DB

- Added "or new manufacturer" and "or new plastic" text inputs inline to the right of their dropdowns (matching existing mold pattern); validation and submit handle either/or
- Fixed catalog label column width 120px → 140px with flex-shrink:0 to prevent label wrapping misaligning form
- Manufacturer and mold dropdowns now source from `flight_numbers` SQLite table (1913 molds) instead of Google Sheet — faster, much more complete
- Mold dropdown filters to selected manufacturer on change; plastic dropdown filters to selected manufacturer
- Auto-sets disc type from flight number speed on mold lookup (10+ = Distance Driver, 6-9 = Fairway Driver, 4-5 = Midrange Disc, 1-3 = Putting Disc)
- Error toasts extended to 5s (success stays 2s)
- Built `disc_plastics` table seeded from Trash Panda "Ultimate Guide to Every Disc Golf Plastic" — 286 rows across 39 manufacturers with Premium/Baseline tier; plastic dropdown now sources from DB filtered by manufacturer, shows `(base)` suffix on baseline plastics
- `scripts/seed-plastics.js` — parses the source txt file; `scripts/migrate-plastics-table.js` — self-contained migration with data embedded, runs on deploy via `deploy-nuc.sh`

### 2026-04-26 — v2.0.7 generic eBay listing API + first live comic listing

- Built `POST /api/ebay/list-item` — generic endpoint replacing disc-specific bulk-list for new items; accepts structured JSON from skill checkpoint (title, description, price, aspects, photos as base64, eBay category/condition IDs)
- Built `POST /api/ebay/update-item` — update title, description, price, aspects on any existing SKU; updates DB list_price
- Added `docs/ebay-category-map.json` — maps skill category labels to eBay Inventory API category IDs and ConditionEnum strings
- Fixed global Express JSON body limit to 25mb for photo payloads
- Aspect values auto-wrapped in arrays server-side (eBay Inventory API requires arrays)
- `listingDescriptionHtml()` — generic HTML generator: prose blocks → `<p>`, spec blocks (lines with ` | `) → `<ul>`, schema.org mobile wrapper; no DG boilerplate
- Tightened `.gitignore` to exclude only the Google Sheets key, not all docs JSON
- Skill Phase 7 now resolves eBay IDs from category map, derives SKU as `DW-<slug>`; Phase 8 POSTs to list-item and records listingId in checkpoint
- Photos: drop in `docs/listing-sessions/<slug>/photos/`, skill encodes and sends at post time; normal-export JPEGs (~1MB) work fine
- First live comic listing: ElfQuest Hidden Years — https://ebay.com/itm/168334714964

### 2026-04-26/27 — v2.0.6 listing skill + comp API integration

- Built out list-item skill flow: intake → gap analysis → comp terms → comp data → pricing → copy → metadata → listing
- Completed 12 eBay listing sessions: Strangers in Paradise TPB lot, ElfQuest Hidden Years, Jink, Vol 2, Blood of Ten Chiefs, Rebels, Shards, Wave Dancers, Kahvi, Two-Spear + Metamorphosis bundle
- Wired `POST /api/comps/search` + `POST /api/comps/analyze` into Phase 3/4 of the skill — comps now run automatically via the NUC API, no manual dashboard step
- Skill falls back to manual dashboard flow if API is unreachable
- Removed docs/tmp/ (legacy desktop Claude files no longer needed)

### 2026-04-25 — notification and shipping cost fixes

- ORDERS button now refreshes sites view when already on that page (via `ordersRefreshTick` store flag)
- Notification fires on first poll if orders already pending (not just on delta)
- Fixed `0 || estimate` fallthrough bug for zero ship cost — switched to `??` in both `server/items.js` profit calc and `item.html` display

### 2026-04-23 — v2.0.4 order push notifications

- New `public/v2/js/notifications.js` module: constants, permission request, delta tracking, notification firing
- 5-minute poller wired into `store.js` `init()`; permission requested on first ORDERS button click
- Fires on first poll if orders already pending; fires again only when count increases
- Hidden test page at `/push-test` for permission + notification testing without waiting for real orders
- Note: macOS hands Chrome notifications to OS — JS `onclick` handler doesn't fire, service worker required for click-to-focus (ruled out as overkill)

### 2026-04-22 — v2.0.3 inventory tracking fix

- Tracking badges now appear on inventory page on load
- Root cause: `_loadTracking()` fired at `init()` before store records were populated; added `$watch` on `dw.loading` to retry once data arrives

### 2026-04-22 — CLAUDE.md dev vs production clarification

- Rewrote Dev vs Production section: production is now the explicit default; local dev reserved for huge multi-session projects
- Removed ambiguity that caused repeated confusion about where to test

### 2026-04-22 — v2.0.2 poly mailer cubic pricing fix

- Label modal now passes width to EasyPost for poly mailers (was hardcoded to 1)
- Enables USPS cubic pricing on orders over 1 lb (3+ disc bundles)
- Defaults pre-filled: poly/9.5×9.5/H:1 — still editable per order
- Switching back to poly type restores those defaults

### 2026-04-21 — Rollo print fix: EasyPost PNG + 203dpi

- EasyPost PNG labels (1200×1800 @ 300dpi) now print correctly
- print-server.js: `resolution=203dpi` matches Rollo native resolution; removed margin options
- CUPS reset that actually works: `lpadmin -x Printer_ThermalPrinter` then replug USB
- `label_format: 'PNG'` kept in label.js (EasyPost returns clean 4x6 PNG)
- Drift after several labels is a hardware gap sensor issue, not software

### 2026-04-21 — v2.0.1 Rollo print debugging (inconclusive — hardware issue)

- Investigated label drift/tiling on Rollo thermal printer
- print-server.js: now handles PNG and PDF by detecting URL extension
- EasyPost already returning PNG (1200×1800 @ 300dpi = correct 4×6)
- Root cause: Rollo gap sensor losing calibration after ~5 labels — hardware failure, not software
- print-server.js left in clean state; no version bump (nothing shipped)

### 2026-04-21 — v2.0.1 add modal fix + session workflow improvements

- Fixed add modal never opening: stale `x-if` wrapper in `item.html` was preventing `addModal` from mounting; removed wrapper and orphaned closing tag from `add.html`
- Added `x-show`/`x-cloak`/`init()`+`$watch` pattern to `add-modal.js` to match other modals
- Updated CLAUDE.md: partials architecture, dev vs production workflow, session start/close checklists, NUC deploy step, Alpine modal gotcha
- Updated global `~/.claude/CLAUDE.md`: session start/end discipline aligned with project CLAUDE.md

### 2026-04-21 — v2.0.0 design system complete (#104 #105 #107)

- Analytics sold mode: added Revenue + Profit columns, sortable
- Closed #104 (analytics), #105 (comps), #107 (cross-cutting foundations) — design system refresh complete
- Bumped to v2.0.0

### 2026-04-21 — v1.1.56 dashboard income + analytics fixes (#101 #111)

- #101: eBay traffic API now only called on analytics view, not app load
- #111: Income windows — dropped YTD, added 60d (now 7/30/60/90d), date range labels per row, instant custom tooltips on bar segments (replaces slow native title)
- fmt0 now rounds to whole dollars (was showing 2 decimal places despite the name)
- Closed #101, #111

### 2026-04-21 — v1.1.55 lots view + modal improvements (#103)

- KPI overflow fixed: compact stat grid + fmt0 now rounds to whole dollars (affects all views)
- Lot modal header actions: RENAME (inline input), + ITEM (opens add modal with lot pre-selected), DELETE (only when empty)
- Normalized empty states: `$0.00` red → `—`, `n/a` → `—` throughout lot view and modal
- KPI order restructured: Cost → Recovered → Realized Profit → Forecasted Profit
- Add Lot CTA added to lots view hero
- Action row promoted: REALLOCATE COSTS + EXPORT CSV buttons above item table
- Server: added `DELETE /api/lots/:id` (rejects if lot has items)
- Closed #103

### 2026-04-21 — v1.1.54 index.html partial refactor (#116)

- Split index.html (2235 lines) into 12 partials: 7 views + 5 modals under `public/v2/partials/`
- Added Express assembler in `server.js` — reads shell + inlines partials at request time via regex replace
- Shell index.html is now 235 lines; adding a new view = one HTML file + one JS file + one shell placeholder
- Closed #116

### 2026-04-21 — v1.1.53 post-sites fixes

- Fixed: `sortGlyph` not defined in lot modal — renamed from `sortIndicator` during #107 but HTML wasn't updated
- Fixed: `r.category.toLowerCase is not a function` in dashboard — `r.category` is now an object; changed to `r.category?.name`
- Fixed: Sites view doesn't refresh after shipping — added `activeModal` watcher to re-fetch orders when modal closes while on sites view
- Filed #116: refactor index.html into per-view/per-modal partials served by Express

### 2026-04-21 — v1.1.52 Sites view (#115)

- Removed redundant "Save Match" button from Reverb sync modal (label modal already writes `platform_order_num` on ship)
- Added `previousView`, `orderCount`, `checkingOrders` to store; `checkOrders()` method fetches both platforms in parallel
- `closeModal()` extended: checks `previousView` first so label modal returns to Sites view instead of reopening a modal
- New `public/v2/js/views/sites.js` — `sitesView` Alpine component with three sections: Orders (ship pending), Listings (unlinked sync), Details (price/name drift)
- ORDERS ticker button in tape; SITES rail nav pill
- Deleted legacy `reverb-modal.js` and `ebay-modal.js` (functionality consolidated into Sites view)
- Fixed: sites view HTML was placed outside `</main>` during Python manipulation — moved inside main
- Fixed: modal HTML (item/add/lot/label/shipping) accidentally deleted during Python manipulation — restored from git
- Updated CLAUDE.md workflow table: "clear requirements 2-3 files" → just do it; full workflow splits into brainstorm→spec→build vs. written plan only for multi-session/complex work

### 2026-04-20 — v1.1.50 inventory workbench (#102 #110)

- `pipeline` getter moved from `dashView` to `Alpine.store('dw')`; forecast stat added to tape (between profit and inv)
- Inventory view: mode-switching tables — Listed (Added/Name/Cat/Site/Status/List/Payout/Profit/Days), Sold (Sold/Name/Cat/Site/Sale/Profit/Shipping/Tracking), All/Prepping (full table, now using `tb` class for consistent styling)
- Site filter: single-select → multi-select pills (`siteFilters[]` array, `toggleSite`/`clearSites` helpers)
- Date range filter: All time / 24h / 7d / 30d pills; appears only for Listed/Sold; timezone fix for `date_sold` (parse as local midnight with `T00:00:00`)
- Search expanded: name + SKU + lot name + notes
- All tables now use `tb` CSS class (14px, consistent headers/cells)
- #113 opened: store full ISO timestamp for `date_sold` (deferred — needs DB migration + backfill)

### 2026-04-20 — inventory workbench design + #109 bug fix

- **#109 bug (P1) — DONE:** Restored click handlers on all four dashboard sections (In Transit, Lot Recovery, Recently Sold, Recently Listed). Each row now opens the appropriate item or lot modal.
- **#102 + #110 — spec + plan written:** Inventory workbench redesign. Mode-switching tables (Listed/Sold/All), multi-select site filter, date range filter (24h/7d/30d), search expanded to name+SKU+lot+notes, pipeline getter moved to store, forecast stat added to tape. Plan at `docs/superpowers/plans/2026-04-20-inventory-workbench.md`. Implementation in next session.
- Bulk actions deferred (no strong use case identified).

### 2026-04-20 — v1.1.49 multi-item eBay order support (#112)

- eBay modal `_process()` now groups all lineItems per order (was hardcoded to `[0]`)
- eBay modal shows all items in order with SKU + title; one SHIP button per order
- `openShip()` passes all lineItemIds + all matched recs to label modal via store
- Label modal reads `activeEbayLineItemIds` / `activeEbayOrderRecs` on open
- `markShippedEbay()` sends full `lineItemIds[]` array to eBay tracking endpoint (one call marks all items shipped)
- `saveShipping()` loops secondary recs: creates order, marks Sold, saves shipment with same tracking
- Payout split: `totalDueSeller` proportionally divided by each lineItem's `total.value`; primary rec gets actual shipping cost, secondary recs get `$0`
- Server tracking endpoint changed from single `lineItemId` to `lineItemIds[]` array
- Fixed: `shipping_cost || null` coercion in `server/shipments.js` → `??` so `0` saves correctly

### 2026-04-20 — v1.1.48 flight numbers for disc golf eBay listings (#108)

- `flight_numbers` SQLite table seeded from `docs/tmp/all_discs.csv` (1918 discs, upsertable)
- `GET /api/flight-numbers?manufacturer=X&mold=Y` lookup endpoint
- `scripts/backfill-flight-numbers.js` — populated T:X on 249 existing sheet rows; dynamic header discovery
- `scripts/bulk-list-discs.js` — passes speed/glide/turn/fade/stability from sheet columns T:X
- `server/catalog-intake.js` — DB lookup at intake time, writes flight numbers to sheet (A:X range)
- `public/v2/js/views/catalog.js` + `index.html` — auto-displays flight numbers when mfg+mold selected
- `server/ebay-listings.js` — Stability + Flight Numbers lines in description; Speed/Glide/Turn/Fade as eBay item aspects (both bulk-list and bulk-update routes)
- Fixed: `|| null` → `!= null` checks so turn=0 and fade=0 are not silently dropped from aspects/description

### 2026-04-20 — v1.1.47 cross-cutting design foundations implementation (#107)

- Executed all 10 tasks from the cross-cutting foundations plan
- **Task 1:** `fmtMoney`, `isZero`, `allSame`, `filteredKpis`, `notify`/`dismissToast` added to store
- **Task 2:** CSS primitives — slim hero-band, filter-group-label, row-click affordance, tape-filtered, toast
- **Task 3:** `sortable.js` util + localStorage sort persistence across items/lots/analytics/comps; `sortGlyph` replaces `sortIndicator`
- **Task 4:** Slim hero-band applied to all 5 non-dashboard views
- **Task 5:** "Status:" / "Sites:" labels on inventory and analytics filter chips
- **Task 6:** `clickable` class on inventory and lots table rows (pointer + hover affordance)
- **Task 7:** Filter-aware KPI tape — filtered secondary values on cost/recov/profit/inv/listed
- **Task 8:** Comps type column auto-hides when all rows share same sale type; comps sort + glyph wired
- **Task 9:** Toast markup + auto-dismiss; success toasts on item save/delete/create
- **Task 10:** `exportCsv()` on items view + "⬇ Export" button in hero-band
- **Polish:** Slim hero-band photo zoom to 160%, removed redundant page title (breadcrumb only); inventory status+site filters persisted to localStorage

### 2026-04-20 — cross-cutting design foundations brainstorm + plan (#107)
- Ran full brainstorm for #107 — 10 cross-cutting themes: empty-states, sortable columns w/ localStorage, slim hero-band, filter chip labels, filter-aware tape KPIs, row-click affordance, auto-hide uniform columns, toast, catalog page shell, inventory export
- Deferred: row selection/bulk actions (replaced by export button), search upgrade (separate ticket), analytics row selection (pending view split)
- Spec: `docs/superpowers/specs/2026-04-20-cross-cutting-foundations-design.md`
- Plan: `docs/superpowers/plans/2026-04-20-cross-cutting-foundations.md` (10 tasks, all independently commit-able)
- No code changes this session — execute plan next session

### 2026-04-19 — v1.1.45 (duck mark + favicon)

- Replaced yellow DW square mark with vectorized rubber duck SVG (traced from PNG via vectorizer.io)
- Duck is accent yellow (#ffcf5c), DW text in body, positioned in tape-brand slot
- Updated favicon.svg to match duck mark
- Next: devil horns on duck (deferred), remaining views IA + design revs targeting v2.0

### 2026-04-19 — v1.1.44 (search overlay restore)

- Restored search bar lost in B design rewrite — `/` and `Cmd+K` open overlay, `Esc`/backdrop to close
- Added `⌕ Srch` rail button as clickable trigger
- Fixed `x-teleport` to body so overlay escapes sidebar `overflow:hidden` — full backdrop, no clipping
- Fixed `_scrollActiveIntoView` selector mismatch (`.search-result-active` → `.search-result.active`)
- Results list capped at `360px` with scroll

### 2026-04-19 — v1.1.43 (CSS size token system)

- Completed #100: added `--text-xs/sm/base/lg` size tokens to `:root`
- Replaced all hardcoded 10px/12px/15px font sizes in main.css + components.css with tokens
- Bumped scale for 3440x1440 readability: xs→11, sm→13, base→17, lg→19
- Content text (table rows, ship-nm, lot-mini nm, rail icons) now scales off `--text-base`
- Chrome/UI (tape, cell-head, badges, labels) uses `--text-xs/sm`
- Next: other views (Inventory, Lots, Analytics, Comps) IA + design revs, targeting v2.0

### 2026-04-19 — v1.1.42 (font size bump + misc polish)

- Bumped body to 15px, bumped hardcoded 13px → 15px on table.tb, ship-nm, lot-mini nm
- Browser tab title: Duckwerks v2 → Duckwerks Dash
- Version number added to rail nav below PROD/DEV indicator
- Filed #100: replace hardcoded font sizes with CSS size tokens (--text-xs/sm/base/lg)

### 2026-04-19 — v1.1.41 (dashboard layout polish)

**Post-refresh layout fixes:**
- Dashboard grid rearranged: Lot Recovery stacked under Income, In Transit absolutely-positioned beside both (fills height, scrolls within)
- Sold + Listed panels 50/50 side-by-side, uncapped rows
- deploy-nuc.sh: pm2 process name fixed duckwerk → duckwerks
- Breathing room: 20px side padding on #main, hero-band bleeds full width, 20px margin-bottom below hero-band on all views

### 2026-04-19 — v1.1.40 (B design system refresh — complete, Tasks 4–6)

**Plan:** `docs/superpowers/plans/2026-04-19-design-system-refresh.md`

**Completed this session (continuation):**
- Task 4: Dashboard HTML rewrite — hero-band with photo + crumbs, 12-col grid, 4 KPI cells (Cost/Recovered/Realized/Forecast), income waterfall with 7d/30d/90d/YTD rows + goal marker, In Transit panel, Recently Sold table (ctag + pmark), Lot Recovery mini bars, Recently Listed table with est. payout/profit + days
- Task 5: Hero-band headers added to all views (Items, Lots, Analytics, Comps, Catalog); legacy `.badge` compat CSS and `.tbl` token update already in place; analytics tabs moved to hero-tools as `tool-btn`
- Task 6: Bumped to v1.1.40

**Prior session (v1.1.39):**
- Task 1: Replaced CSS token system — IBM Plex Mono + Space Grotesk + Azeret Mono fonts, new `--ink` hierarchy, amber `--accent`, legacy aliases for backward compat
- Task 2: Replaced 220px sidebar with tape strip + 64px icon rail nav
- Task 3: Added `incomeWindows`, `tape24h`, and rendering helpers to `dashboard.js`

### 2026-04-19 — v1.1.38 (systemd PM2 crash loop fix + Puppeteer isolation)

**Root cause of all server instability (502s, random restarts, homepage crashes):**
- systemd was killing PM2 every ~45 seconds via SIGTERM due to a broken `PIDFile=` directive in `/etc/systemd/system/pm2-geoff.service`
- systemd couldn't read `/home/geoff/.pm2/pm2.pid` (Permission denied, or file missing after PM2 daemonized), declared start timeout, killed the process, restarted — 1,367+ times
- This was probably exacerbated by the Fedora OS upgrade changing file ownership on the PID file
- **Fix:** removed `PIDFile=` and changed `Type=forking` → `Type=oneshot` + `RemainAfterExit=yes` in the service file. This tells systemd not to verify a PID file — just trust the daemon is running after `pm2 resurrect` exits.
- **Next time symptoms appear:** immediately check `sudo journalctl -u pm2-geoff.service -n 20` for "Can't open PID file" or "Scheduled restart job, restart counter is at N". High N = this problem.
- **Diagnosis commands:** `sudo systemctl status pm2-geoff.service` (look for restart counter), `sudo journalctl -u pm2-geoff.service --since "5 minutes ago"`

**Comp scraper Puppeteer isolation (also fixed this session):**
- Moved Reverb scraping out of the Express process into a child process (`scripts/reverb-scrape.js`) so Chromium crashes can't kill the server
- Chromium on Fedora requires `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`
- Added `uncaughtException` / `unhandledRejection` handlers to `server.js` for crash visibility
- CHROME_PATH `/usr/lib64/chromium-browser/chromium-browser` is correct (it's a shell wrapper, that's fine)

### 2026-04-13 — v1.1.36 (eBay description formatting — mobile + desktop)

**eBay listing description overhaul (`server/ebay-listings.js`):**
- Replaced `<p>` paragraph format with schema.org `<div>/<span>` mobile snippet pattern per eBay Inventory API docs
- Mobile preview: pipe-separated spec fields (`Brand: X  |  Mold: Y  |  ...`), truncated by eBay at 800 chars
- Desktop / "see full description": `<ul><li>` spec bullet list + `<p>` footer paragraphs
- Curated descriptions: mobile preview = spec pipes + prose (eBay truncates mid-sentence); full = prose paragraphs + spec bullet list + footer
- Sanitized Google Sheet col D (74 cells, rows 2–71, 147–149, 158) — stripped embedded spec lines and footer from curated descriptions, leaving prose-only intros
- Bulk-updated all active listings via `--update` run; one listing skipped (active offer outstanding)

### 2026-04-11 — v1.1.35 (KPI normalization — dashboard + lot modal)

**Dashboard KPI row:**
- Renamed: Total Invested → Total Cost, Revenue → Recovered, Profit → Realized Profit, Upside Pending → Forecasted Profit (= realized + listed est.)
- Dropped Gross Pending card (redundant intermediate value)
- Realized Profit now shows ROI % sub-line
- Inventory card: cleaned up to "X sold · Y listed" + "N eBay · N Reverb" platform breakdown; dropped prepping/other

**Lot detail modal (ref #96):**
- Added Realized Profit KPI (sum of sold item profit after all fees)
- Dropped Est. Upside card; renamed Est. Total Profit → Forecasted Profit (realized + listed est.)
- Normalized all sub-labels: sum of cost basis, gross sold revenue, sold after all fees, realized + listed est.
- Realized Profit shows ROI % when lot has a cost basis

### 2026-04-11 — v1.1.34 (bulk-list fixes + auto-retry)

**bulk-list script improvements:**
- `scripts/bulk-list-discs.js`: auto-retry errored IDs up to 3 cycles (configurable via `--retries N`) with 10s delay between cycles — handles eBay's intermittent 500s without manual re-runs
- `scripts/bulk-list-discs.js`: print `Retry: --ids ...` at end of run for any still-failing IDs after all cycles
- `server/ebay-listings.js`: bulk-update now respects curated title/description from sheet cols C+D instead of always regenerating from metadata

### 2026-04-11 — v1.1.33 (eBay analytics traffic — full listing coverage)

**Analytics page now shows traffic data for all listings:**
- `server/ebay.js`: switched traffic route from GET to POST, accepts `listingIds[]`, batches 200 at a time using `listing_ids:{...}` filter — bypasses eBay's 200-record cap on dimension=LISTING
- `server/ebay.js`: fixed date format to `YYYYMMDD` per eBay docs; use yesterday as end date to avoid LA timezone future-date error
- `analytics.js`: fetch `/api/ebay/listings` first, derive IDs from response (not store — store not ready on init), then POST to traffic
- `analytics.js`: fixed Reverb 502 taking down entire eBay load — `_fetchReverbListings` now breaks on non-ok response instead of throwing
- `analytics.js`: restored missing `dw` store reference after refactor

### 2026-04-11 — v1.1.32 (eBay sync SKU display + sold status → Google Sheet)

**eBay sync modal shows SKU on awaiting shipment rows:**
- `public/v2/index.html`: SKU from eBay order line item shown inline with order ID (e.g. `Order: 13-xxx · SKU: DWG-119`)

**Sold status synced to Google Sheet automatically (issue #95):**
- `server/catalog-intake.js`: `markDiscSold(sku)` exported — maps `DWG-XXX` → sheet row, sets col E = TRUE
- `server/orders.js`: calls `markDiscSold` fire-and-forget on every `POST /api/orders` for items with a DWG SKU
- `server.js`: updated catalog-intake require to use `.router`
- `server/ebay.js`: collapsed `/orders/sold` into `/orders?filter=sold` — no behavior change for existing callers
- Sheet backfilled manually via MCP for 26 sold discs from existing eBay order history

### 2026-04-10 — v1.1.31 (eBay fee rate update + site fee tooling)

**eBay fee rate corrected to 13.6%:**
- `server/db.js`: seed updated from 13.25% → 13.6% (for fresh DBs)
- `scripts/update-site-fees.js`: new script to view and update site fee rates in production DB; edit `UPDATES` array for future changes; dry-run by default, `--confirm` to apply

### 2026-04-10 — v1.1.30 (Auto-generate eBay listing title — issue #94)

**Title generation at list time:**
- `generateTitle()` added to `server/ebay-listings.js` — builds `{Manufacturer} {Mold} {Plastic} [Run] {Weight}g {Color} {Condition}`, truncates at last full word ≤80 chars
- `/bulk-list` handler: `disc.title = disc.title || generateTitle(disc)` — sheet column C wins if populated (manual override), generates otherwise
- `/bulk-update` handler: always regenerates title + description from current metadata (`disc.title = generateTitle(disc)`, `disc.description = null`) — update implies metadata was corrected, so everything derived from it regens
- `scripts/bulk-list-discs.js`: removed "no List Title" warning — blank column C no longer blocks listing
- Validated live on NUC: "MVP Uplink Neutron 176g Orange Unthrown", bulk-update fixed "proton"→"Proton" casing + picked up new note

### 2026-04-10 — v1.1.29 (Catalogue form QoL improvements)

**Form enhancements:**
- Mold: select dropdown sourced from sheet column G + free-text "new mold" input below (new mold wins on submit)
- Plastic: select dropdown sourced from sheet column I
- Required field validation on submit: box, manufacturer, mold, type, plastic, weight, color, list price — notes and run/edition optional
- Removed default weight (175) and list price (25) — must be entered explicitly, enforced on reset too

**Opened issue #94:** Auto-generate eBay listing title from catalogue fields at save time

### 2026-04-10 — v1.1.28 (Catalogue view live testing + fixes)

**Catalogue intake view first real use:**
- Deployed credentials file (`docs/handicaps-244e5d936e6c.json`) to NUC — gitignored, must be manually copied on fresh deploy
- Fixed title: British spelling `catalogue`, `div` not `h2`, `view-title` class (not inline Bebas Neue)
- Tested end-to-end: disc 168 (MVP Uplink) written to Google Sheet row 169, form reset, disc # incremented, Box persisted via localStorage
- Tab order, typeahead dropdowns, condition toggle all verified working in production

### 2026-04-10 — v1.1.27 (Disc SKU storage and display — issue #93)

**SKU column added to items table:**
- `server/db.js` CREATE TABLE items: added `sku TEXT` for fresh DB creation
- `server/items.js`: `sku: row.sku` added to API response shape; `sku` intentionally excluded from allowed PATCH fields (immutable)
- `server/ebay-listings.js`: `dbWrite()` now accepts and INSERTs `sku` at bulk-list time

**Backfill script:**
- `scripts/backfill-skus.js` — one-time admin script; runs `ALTER TABLE ... ADD COLUMN` (noop if exists), enumerates all 167 eBay inventory items via GET /inventory_item, resolves listing IDs via GET /offer?sku= per item, matches to local DB, writes SKUs
- Default dry-run; `--confirm` to write
- Reports non-matches in both directions (eBay SKUs with no local listing; local DG items still missing SKU after run)
- All 167 DWG-XXX SKUs successfully backfilled and verified in production

**Display:**
- Item modal: SKU shown as muted subtext beneath item name (hidden if no SKU)
- Label modal: same treatment — SKU visible when creating shipping label for grab-from-shelf context

### 2026-04-09 — v1.1.26 (eBay disc type + condition fixes; script cleanup)

**eBay disc type normalization:**
- Catalog intake form `TYPES` updated to eBay-correct values: "Midrange Disc", "Putting Disc"
- `ebay-listings.js` now maps sheet values ("Putter" → "Putting Disc", "Midrange" → "Midrange Disc") via `normalizeDiscType()` — applied to both bulk-list and bulk-update paths, preserving the human-readable form in descriptions

**Condition case-sensitivity fix:**
- `disc.condition === 'Unthrown'` → `disc.condition?.toLowerCase() === 'unthrown'` — 61 discs were being listed as USED_EXCELLENT instead of NEW due to lowercase "unthrown" in the sheet
- Applied to both `putInventoryItem` (new listings) and `bulk-update` path (now uses sheet condition instead of preserving from eBay)

**bulk-list-discs.js improvements:**
- `--ids` now accepts comma-separated ranges: `1-20,25,30-35` — no more multi-command workarounds for non-contiguous IDs
- Dry run by default; `--confirm` to go live (standardized with other scripts)

**Script cleanup:**
- Standardized all scripts to `--confirm` pattern (dry run default): `rename-disc-photos.js`, `update-reverb-listings.js`, `assign-lot.js`
- Deleted dead scripts: `update-reverb-listings.js` (one-off Reverb docx rewriter), `backfill-sold-dates.js`, `match-reverb-orders.js`, `migrate-airtable-to-sqlite.js`, `fix-sold-dates.js` (all Airtable-era)

**Project root cleanup:**
- Removed: `duckwerks-dashboard.html` (v1 monolith, 359KB), `buy_browse_v1_oas3.json` (eBay API spec, 383KB), `CLAUDE_duckwerks_website.md`, `claude-personal.md`, `duckwerks-dg-catalog.csv`

**Google Sheets sold flag backfill:**
- Used MCP connector + prod DB query to identify 15 sold discs missing `Sold=TRUE` in the sheet; batch-updated via MCP `batch_update_cells`

**Bulk update run:**
- Fixed 96 listings for disc type and/or condition; 6 correctly skipped as sold

### 2026-04-09 — v1.1.26 (catalog intake form + eBay listing footer)

**Catalog intake form:**
- New hidden view accessible via "catalog" link in sidebar footer
- Form appends rows directly to the DG catalog Google Sheet via service account (`googleapis`)
- Fields: Disc # (auto), Box (persists via localStorage), Manufacturer (dropdown seeded from sheet), Mold, Type, Plastic, Run/Edition, Notes, Condition (Unthrown/Used toggle), Weight (default 175g), Color (eBay enum dropdown), List Price (default $25)
- Submit shows toast, resets form, increments Disc #, preserves Box
- New server routes: `GET /api/catalog-intake/next-disc-num`, `GET /api/catalog-intake/manufacturers`, `POST /api/catalog-intake/disc`

**eBay bulk listing description footer:**
- Extracted footer text to `LISTING_FOOTER` constant in `server/ebay-listings.js`
- Added `descriptionHtml(disc)` helper — used in both `putInventoryItem` and `createOffer`
- Footer now appended to all listings (both custom `disc.description` and auto-generated paths)
- Fixed stray label statement in `createOffer` that was causing lint errors

**Bulk listing lot assignment:**
- `dbWrite()` now assigns `lot_id=9` (Bulk-listed DG discs) on item create

**Sheet titles:**
- Generated and wrote titles for discs 135–167 (33 rows) via MCP google-sheets

### 2026-04-08 — v1.1.25 (lower default shipping estimate)

**Default shipping estimate: $10 → $7**
- Updated fallback shipping in `store.js` (3 places: `estNet`, `estProfit`, `payout`) and display label in `items.js`
- Est. Upside on 122-item Disc Golf lot went from $1,562 to $1,976 — more accurate for current inventory

### 2026-04-07 — v1.1.24 (eBay aspect key fixes + Color + Sold skip)

**eBay aspect key corrections (ref #91):**
- `Plastic Type` → `Disc Plastic Type`
- `Weight` → `Disc Weight`
- Added `Type: Disc Golf Disc` (constant for all disc golf category listings)
- Added `Disc Type` from spreadsheet `Type` column (Driver/Putter/etc.)
- Added `Color` aspect from spreadsheet `Color` column — validated against eBay enum (Beige/Black/Blue/Bronze/Brown/Gold/Gray/Green/Multi-Color/Orange/Pink/Purple/Red/Silver/White/Yellow); invalid values silently ignored
- Applied to both new-listing and `--update` paths

**Sold skip in bulk script:**
- New `Sold` checkbox column in spreadsheet (TRUE/FALSE)
- Rows with `Sold=TRUE` are skipped in both list and update modes (`skipped — sold`)

### 2026-04-06 — v1.1.20 (shipping display fixes + carrier warnings)

**Shipping column — actual cost display:**
- `shipDisplay` now prioritizes `shipment.shipping_cost` (actual) over `listing.shipping_estimate`. All sold+shipped rows now show actual cost in green.
- For sold listings with no shipment (in-person CL/FB), falls back to sold listing's `shipping_estimate`; if null and site is Craigslist or Facebook, defaults to $0.

**Carrier rate warnings in label modal:**
- EasyPost `messages` array (rate_error type) now passed through `/api/label/rates` response.
- Label modal displays carrier errors in yellow below the rate list (e.g. "UPS: UPS responded with an invalid JSON response, please try again").
- Added `scripts/test-rates.js` — debug utility to test EasyPost rate fetch + surface carrier errors for a given address.

### 2026-04-06 — v1.1.23 (bulk update aspects fix)

**Bulk update — aspects now rebuilt from sheet data:**
- Brand (Manufacturer), Model (Mold), Plastic Type, Weight now update alongside title/description/price in `--update` mode.
- Previously was preserving existing aspects from eBay inventory item.

### 2026-04-06 — v1.1.22 (bulk listing --update mode + 25604 retry)

**Bulk listing `--update` mode:**
- New `--update` flag: updates title, description, list price on existing eBay listings. No photos required, no republish needed.
- New `/api/ebay/bulk-update` route: GETs existing inventory item to preserve imageUrls/condition, PUTs with new title/description, PATCHes offer with new price.
- Usage: `node scripts/bulk-list-discs.js --sheet <url> --ids 1-52 --update`
- Photo updates deferred — future `--update-photos` flag.

**25604 transient error retry:**
- `publishOffer` now retries once on errorId 25604 "Product not found" with a 3s delay.

### 2026-04-06 — v1.1.21 (local print server for labels)

**Local print server (`scripts/print-server.js`):**
- Runs on Mac; exposes `POST /print/label` — downloads EasyPost PDF, sends to thermal printer via `lp` with `media=Custom.4x6in fit-to-page`. No print dialog.
- NUC proxy at `server/print.js` — `/api/print/label` forwards to `PRINT_SERVER_URL` (e.g. `http://MBA.local:3002`). Dashboard calls NUC, NUC calls Mac — no CORS issues.
- `store.printLabel()` now calls API first, falls back to `window.open` if print server unavailable.
- Config: `LABEL_PRINTER`, `PRINT_SERVER_PORT=3002` in Mac `.env`; `PRINT_SERVER_URL` in NUC `.env`.
- Start with: `node scripts/print-server.js`
- Packing slips stay as `window.open` — Reverb/eBay URLs require browser auth, no clean API path.

### 2026-04-06 — v1.1.19 (eBay multi-listing ship fix + bulk listing fixes)

**eBay label modal — multi-listing address bug:**
- `isEbay` was determined by `activeListing(r).site.name`, which returns the wrong site when an item has listings on multiple platforms (e.g. eBay + CL/FB). When the eBay modal sets `activeEbayOrderId` before opening label modal, that's the authoritative signal. Fixed: `isEbay = siteName === 'eBay' || !!dw.activeEbayOrderId`; `isReverb` guards against the eBay order ID to avoid double-triggering.

**eBay bulk listing — condition enum fix:**
- `USED` is not a valid ConditionEnum string in the Inventory API — it's just the UI display label.
- Category 184356 (Disc Golf Discs) only supports conditionId 3000 = `USED_EXCELLENT`.
- Added `scripts/check-conditions.js` — queries eBay Sell Metadata API to list valid conditions for any category (`node scripts/check-conditions.js 184356`).

**eBay bulk listing — bestOfferTerms fix:**
- `bestOfferTerms` was at the top level of the offer body — eBay accepts the PUT but silently drops it.
- Per `sell_inventory_v1_oas3.json`, `bestOfferTerms` is a property of `listingPolicies`, not the offer root. Moved it there — "or Best Offer" now appears on listings.

### 2026-04-05 — v1.1.17 (eBay bulk listing fixes + lots calc fix)

**eBay bulk listing fixes:**
- Fixed `bestOfferEnabled`: was incorrectly nested inside `pricingSummary` (silently ignored by eBay API); moved to top-level `bestOfferTerms: { bestOfferEnabled: true }`. Note: doesn't apply to already-published offers via PATCH — enable manually in Seller Hub for existing listings.
- Added `scripts/check-offer.js` — debug script to inspect eBay offer state for a given SKU (`node scripts/check-offer.js DWG-014`)
- Documented `bulk-list-discs.js` idempotency in CLAUDE.md: safe to re-run on already-listed items (existing offer is PATCHed via errorId 25002 handler, re-published in place, same listing ID returned)
- eBay 25604 "Product not found" errors on some SKUs: transient eBay-side issue; retrying resolved them. Manually edited listings convert from Inventory API-managed to legacy — Inventory API loses track of them.

**Lots view fix:**
- `lotsView.estUpside()` was using `dw.payout(r)` (fees only, no cost/shipping) and including non-Listed items — now matches lot modal: `dw.estProfit(r)` on `status === 'Listed'` items only

### 2026-04-05 — v1.1.16 (bulk workflow improvements + comp prompt caching)

**Bulk script improvements:**
- `bulk-comp-discs.js` and `bulk-list-discs.js` now accept `--sheet <url>` to read directly from a public Google Sheet CSV export — eliminates the export/scp cycle
- `bulk-list-discs.js`: removed CSV write-back of eBay Listing ID/URL — DB is the source of truth, range-based `--ids` arg makes it unnecessary
- `scripts/assign-lot.js` — new script: bulk-assigns items to a lot by category name; dry-run by default, `--confirm` to apply

**Comp analysis prompt:**
- Trimmed manual workflow sections (search URLs, workflow steps, search hints) — these were from the old Claude Desktop extension workflow, no longer relevant
- Added category-specific analysis guidance: Music Gear, Consumer Electronics, Comics, Disc Golf sections
- Added: Recency Weighting, Thin Comp Pool Protocol, Outlier Protocol, Price Synthesis sections
- Added disc golf-specific guidance on plastic tiers, run/edition premiums, weight, condition
- Prompt now ~3000 tokens (doc) — over the 2048 minimum for prompt caching on claude-sonnet-4-6
- Enabled prompt caching via `cache_control: { type: 'ephemeral' }` on system content block

**Prompt caching debugging notes (for future reference):**
- `claude-sonnet-4-6` requires **2048 token minimum** for caching (not 1024 — that's for older models). Documented in Anthropic's prompt caching docs.
- `cache_control` goes on the system content block array (explicit breakpoints approach) — standard `anthropic.messages.create()`, no beta header needed
- Caching silently does nothing if under the token minimum — no error returned, check `cache_creation_input_tokens` in response to verify
- Lesson: always check the actual Anthropic docs for model-specific requirements before implementing

**Workflow context:**
- Disc golf inventory: ~26 listed, ~250 total planned across multiple batches
- Google Sheet (`duckwerks-dg-catalog` tab) is now the source of truth for the CSV data — scripts read from it directly
- Next up: comics lot coming; scripts need to be more generic for other lot/category types
- Longer term: UI for bulk comp and bulk listing workflows (see GitHub issue)

### 2026-04-05 — v1.1.15 (EPS image upload fix)
- Fixed eBay Media API integration: correct host (apim.ebay.com), correct endpoint (/image/create_image_from_file), correct response flow (201 + Location header → GET imageUrl)
- All 11 disc golf listings now showing EPS-hosted thumbnails in eBay search
- Added explicit multer error handling with console.error logging for easier diagnosis

### 2026-04-05 — v1.1.14 (disc golf scripts)
- New: `scripts/rename-disc-photos.js` — sorts photos by creation time, renames to DWG-{id}-{n}.jpeg; supports --per, --dry-run
- New: `scripts/bulk-comp-discs.js` — batch comp research from CSV; uses Comp Pull column as search query, falls back to List Title; outputs combined analysis + CSV to file

### 2026-04-05 — v1.1.13 (eBay bulk listing pipeline)
- New: `scripts/bulk-list-discs.js` — CLI script reads CSV, validates, sends one disc at a time to server
- New: `server/ebay-listings.js` — POST /api/ebay/bulk-list: saves photos, eBay Inventory API (item → offer → publish), DB writes
- Photos served from `public/dg-photos/` via static route; hosted at dash.duckwerks.com/dg-photos/
- eBay category: 184356 (Disc Golf Discs) — verified via taxonomy API
- Merchant location auto-created from FROM_ env vars on first run
- CSV columns: Disc #, List Title, List Price, Condition, Manufacturer, Mold, Type, Plastic, Run / Edition, Weight (g), Notes, Description, eBay Listing ID, eBay URL
- Description column: if set, used as listing description (HTML paragraphs); falls back to auto-generated metadata block
- Idempotent: skips rows with eBay URL set; reuses existing offer on re-run; skips DB write if listing_id exists
- Dependencies added: multer (multipart upload), csv-parse (CSV parsing)

### 2026-04-03 — v1.1.11 (manual shipment tracking fields in item edit modal)
- Added Tracker ID, Tracking #, Tracker URL, and Ship Cost fields to edit modal Shipment section
- Widened read-view tracking section to show when tracking_number or tracker_url present without a tracking_id
- Fixed clearTracking: optimistic store mutation prevents race between fetchAll and modal reopen reloading stale tracking
- Fixed clearTracking: now calls fetchAll() so cleared state reflects without hard refresh

### 2026-04-03 — v1.1.10 (capture actual shipping cost incl. insurance fee — #88)
- Insurance passed at buy step (not shipment creation — EasyPost ignores it there)
- `easypostPurchase` sums all fees from response and returns `totalCost`
- `saveShipping` uses `totalCost` instead of `ratePrice` so shipping_cost includes insurance fee
- Result step in label modal now displays total cost instead of just carrier rate

### 2026-04-02 — v1.1.9 (configurable insured amount in label modal — #88)
- Added INSURED field to label modal form, defaults to $100
- Auto-fills from sale amount (Reverb/eBay) if > $100
- Insurance value passed through `/api/label/rates` → `easypostRates()` → EasyPost shipment creation

### 2026-04-02 — v1.1.8 (hardcode $100 EasyPost insurance — #88)
- Added `insurance: '100.00'` to EasyPost shipment creation call in `server/label.js`
- EasyPost account default ($50) was not being honored for API-created shipments
- Filed #88 for future configurable insured amount per shipment

### 2026-04-01 — v1.1.6 (per-listing shipping + best-net activeListing — #87)
- Item modal edit: shipping_estimate moved from shared Financials to each listing card (existing + pending)
- Save loop: all per-listing fields (price, shipping, URL, listing ID) now updated together per listing
- `activeListing()` now picks by highest estimated net (price - shipping - fees) instead of highest list price
- Est. Profit qualifier updated to "(best net)" for multi-listing items

### 2026-04-01 — v1.1.5 (per-listing shipping estimate editing — #87)
- Item modal edit: shipping_estimate field added to each listing card
- Pending listings carry shipping_estimate through to createListing

### 2026-04-01 — v1.1.4 (per-listing price editing and display — #87)
- Item modal read: price column added to listings table (yellow, per-listing)
- Item modal read: "Est. Profit" label shows site name + "(best price)" qualifier for multi-listing items
- Item modal edit: list price moved from shared Financials section into each listing card (existing + pending)
- "+ ADD LISTING" now seeds `list_price: ''` in the pending listing object
- Save loop refactored: shipping stays shared across active listings; list_price, URL, and listing ID updated per-listing

### 2026-04-01 — v1.1.3 (edit modal new listing UX — #86)
- Item modal edit: new listing form now includes URL + Listing ID fields (no more save→reopen cycle)
- Item modal edit: "+ ADD LISTING" button stays visible — can add multiple new listings in a single save

### 2026-04-01 — v1.1.2 (multilisting item modal fixes — #85)
- Item modal: listings section label now top-aligns with multi-row table (flex-start)
- Item modal: Order section split into its own labeled section with divider — no longer visually blends with listings
- Item modal: Order section site label now derived from the sold listing, not siteLabel() — fixes wrong site shown on multilisting items
- Items view: site filter now matches any listing (not just active) — Sold+eBay filter now works correctly
- Item modal: listing ID column right-aligned; badge columns shrink-wrapped with proper padding

### 2026-03-31 — v1.1.1 (listing edit improvements)
- Item modal edit: listing fields now rendered in bordered cards — clear visual grouping per listing
- Item modal edit: "+ ADD LISTING" button always shown; can add 2nd–Nth listings to existing items (was previously gated to items with no listings)

### 2026-03-31 — v1.1.0 (1.1 release)
- #84: Fixed site filter in Items view — listings nest site as `site: { id, name }` but filter was checking `l.site_id` (undefined); changed to `l.site?.id`; closes #84

### 2026-03-30 — v1.0.9 (multi-listing per item + env indicator)
- #83: Sidebar footer shows `SERVER_ENVIRONMENT` (.env, defaults to 'Development') + `os.hostname()` — green for Production, yellow for Development; exposed via existing `/api/config` endpoint

### 2026-03-30 — v1.0.9 (multi-listing per item — FB/CL support)
- #82: Add Item modal: site dropdown → checkboxes; creates one listing per checked site with shared price/shipping
- #82: `siteLabel()` returns 'Multiple' for items with >1 active listing; new `siteBadgeClass()` helper centralizes badge CSS
- #82: Items view site filter now uses contains logic — multi-listing items appear under each active site's filter pill
- #82: Item modal: listings mini-table (Site | Status | URL | Mark Sold) replaces single listing section in read view
- #82: Item modal edit mode: per-listing URL/ID fields; "Add Site" dropdown shown only for items with no listings yet
- #82: Mark Sold inline flow: expands row to capture sale price, auto-ends other active listings, creates order record
- #80: Closed as won't fix — GetSellerList (Trading API) too much overhead for watchCount alone; Analytics API views/impressions/CTR sufficient
- #81: Analytics site filter buttons (eBay/Reverb toggle) added to both Listed and Sold tabs

### 2026-03-30 — v1.0.8 (SerpAPI eBay comps + search query field)
- #79: Replaced eBay Browse API with SerpAPI (`show_only=Sold`) — returns real sold listings with `sold_date` field; 50 results per query
- #79: Removed `getAppToken` / eBay OAuth dependency from `server/comps.js`; `SERPAPI_API_KEY` added to `.env`
- Added optional `searchQuery` field to comps form — overrides `_nkw` for tighter eBay searches (e.g. "Technics SL-6" vs full item name)
- Closed #79

### 2026-03-29 — v1.0.7 (eBay scraper attempt + UI fixes)
- #78: Replaced all emdash (`—`) null-display placeholders with `n/a` across JS and HTML templates; dropdown option emdashes updated to n/a/none/descriptive text
- #79: Replaced eBay Browse API with puppeteer scraper targeting `LH_Sold=1&LH_Complete=1` URL — bot detection blocked all puppeteer approaches (headless, headless:new, headless:false all served security challenge page)
- #79: Attempted direct fetch with browser headers + cookie priming — eBay is full CSR (13KB JS shell, 0 items in HTML)
- #79: Attempted eBay Finding API (`findCompletedItems`) — returned error 10001 (rate limit or access not enabled for this App ID); needs investigation in eBay developer portal before next attempt
- eBay comps currently broken/disabled; Reverb comps unaffected and working
- Added `cheerio` dependency (installed but not currently used — safe to remove if Finding API path works)

### 2026-03-30 — v1.0.6 (eBay Browse API diagnosis)
- Diagnosed eBay Browse API problems in `server/comps.js`: missing recent sold listings, empty sold dates, overly broad model matching, possible active listings included
- Raw API test: 29 results for "Technics SL-6" returned only 2 true SL-6s; $189.99 and $200 items visible on eBay web were completely absent
- Filed #79: replace Browse API with puppeteer sold listings scraper (`LH_Sold=1&LH_Complete=1` URL) — same pattern as Reverb scraper

### 2026-03-30 — v1.0.6 (Reverb scraper fix)
- #76: Switched to `puppeteer-extra` + stealth plugin to bypass Cloudflare bot detection on Reverb
- #76: Fixed stale CSS selectors (`rc-listing-row-card__*` → `rc-listing-card__*`) — titles and conditions now populate correctly
- Added empty listings guard in comps view — shows red error card instead of calling Claude with 0 results (prevents hallucinated CSV)
- NUC: installed Chromium (`/usr/lib64/chromium-browser/chromium-browser`), set `CHROME_PATH` in `.env`

### 2026-03-30 — v1.0.5 (comp research — Reverb, download, form UI, Comp button)
- #76: Added Puppeteer-based Reverb sold listing scrape (`puppeteer-core` + system Chrome); fans out eBay + Reverb in parallel; `CHROME_PATH` env var
- #76: Added `sources=` per-item control (ebay/reverb/both); defaults to eBay only — Reverb opt-in to avoid scrape latency
- #77: Added Download (.txt) button per result + Download All — format: analysis + separator + CSV, named `{item}_comps.txt`
- Replaced free-text textarea with structured form: one row per item with Name, Source select, Min $, Notes fields; + Add Item / × remove
- Removed `alternates` hint — multiple rows serve the same purpose with separate result cards per query
- Added Comp button to Items view (Listed filter only) — auto-fills comp form: parses `Name - Description` format, maps listing site to source, sets min price to 60% of list price, notes from description part

### 2026-03-30 — v1.0.4 (comp research view)
- Added Comps view (issue #75) — sidebar nav pill, textarea input, Run Comps button
- Input format: `item name | min_price=X | alternates=[A, B] | notes=...`
- `server/comps.js`: `POST /api/comps/search` fans out to eBay Browse API (sold items filter, app token auth); `POST /api/comps/analyze` calls Claude API (`claude-sonnet-4-6`) with `docs/gear-comp-research.md` as system prompt
- Output: per-item analysis paragraph + comp table with Copy CSV / Copy All CSV buttons
- Added `@anthropic-ai/sdk` dependency

### 2026-03-29 — v1.0.3 (caching fix + inventory columns)
- Added `Cache-Control: no-store` to Express static middleware — prevents Cloudflare from caching stale JS/CSS after deploys
- Added Date Sold column to Inventory view — sortable, shows `date_sold` from order record, blank for unlisted items
- Added Shipped date column to in-transit dashboard table; sorted in-transit rows by ship date desc
- Manually patched item #19 via API (order + shipment records) to recover data lost in local→NUC migration

### 2026-03-28 — v1.0.2 (deploy script)
- Added `scripts/deploy-nuc.sh` — SSH to NUC, git pull, restart PM2 app + cloudflared tunnel in one command
- Set up passwordless sudo on NUC for `systemctl restart cloudflared`
- Set up SSH key auth from MacBook to NUC (`ssh-copy-id`)

### 2026-03-28 — v1.0.2 (remote access setup + housekeeping)
- Migrated `duckwerks.com` DNS from Hostgator nameservers to Cloudflare (free tier)
- Deployed app to Intel NUC (Fedora) — PM2 manages the Node process, survives reboots
- Set up Cloudflare Tunnel (`cloudflared` as systemd service) → `dash.duckwerks.com`
- Configured Cloudflare Access (Zero Trust) with email one-time code auth — only `geoff@duckwerks.com` allowed
- Updated README with remote access setup docs
- Added mobile media query to `main.css` — sidebar stacks above content on narrow screens, stat cards reflow naturally (ref #74)

### 2026-03-28 — v1.0.2 (housekeeping)
- Removed last Airtable string reference from `index.html` (comment on config script tag)

### 2026-03-27 — v1.0.1 (Analytics columns + lot cost reallocation — #68 #69 #70)
- **#68:** Added List Price column to Analytics Listed tab — Reverb uses `l.price.amount` from API; eBay uses `listing.list_price` from local record. Sortable, formatted as `$X.XX`.
- **#69:** Added Days Listed column to Analytics Listed tab — Reverb uses `published_at` from API; eBay uses `listed_at` from local listing record. Sortable, formatted as `Nd`.
- **#70:** Lot modal cost reallocation — "REALLOCATE COSTS" button in Items section header opens an inline edit panel. Editable cost input per item, list price shown for reference. Redistribute button fills costs from list price ratio (whole dollar rounding). Running total vs lot cost, color-coded green/yellow/red. Warning shown if total doesn't match; save only PATCHes changed items then fetchAll.
- **eBay watchCount:** eBay Developer Support asked if Geoff is an EPN partner — answered no, awaiting response.
- No release tag yet — will cut when release notes are finalized.

### 2026-03-27 — v1.0.0 (Analytics view validation + polish — #53 #64 #65 #66 #67)
- **#65 — CLOSED:** Analytics view rows (Listed + Sold) now clickable — opens item modal when local record can be matched. eBay items without a saved `platform_order_num` (pre-order-tracking) won't match; accepted as known limitation, can backfill manually later.
- **#66 — CLOSED:** Sold tab columns now fully sortable (name, site, soldDate, daysSince) via dedicated `soldSortBy`/`soldSortIndicator` methods.
- **#67 — CLOSED:** Tab buttons moved below the "Analytics" header title, styled as `btn-active`/`btn-muted` instead of `nav-pill`s floating inline with the header.
- **README updated** — Analytics view added to features; build timeline extended through v1.0.0; sortable tables note updated.
- **Tagged v1.0.0** — no GitHub release yet; will cut after first round of post-launch bugs.

### 2026-03-27 — v1.0.0 (Analytics view — #53 + #64)
- **#53 + #64 — Awaiting Validation:** New Analytics top-level nav view with two tabs.
  - **Listed tab:** Reverb (views, watches) + eBay (views, impressions, CTR) in one sortable table. eBay data from Sell Analytics v1 traffic_report (last 30d). All columns sortable.
  - **Sold tab:** Reverb orders with `needs_feedback_for_seller: true` + eBay FULFILLED orders within 60d feedback window. Sorted by days since sale desc. Order links for quick buyer nudging.
  - **eBay watcher count:** wired up via Browse API `/api/ebay/listings` — will populate once App Check ticket for watchCount access is approved. Submit at: https://developer.ebay.com/my/support/tickets?tab=app-check
  - **eBay per-order feedback API:** Not publicly accessible (404 on all paths). eBay Sold tab shows all fulfilled orders within 60d window instead of confirmed-no-feedback only.
  - **New eBay server routes:** `/api/ebay/traffic`, `/api/ebay/fulfilled-orders`. eBay OAuth scopes expanded to include `sell.analytics.readonly` + `sell.reputation` (re-auth done).

### 2026-03-27 — v0.9.9 (P2 bug batch + sync improvements)
- **#60 #61 #62 #63 — CLOSED:** (Previously fixed, forgot to close last session — closed at session start.)
- **#52 — Awaiting Validation:** Sync Listings now includes Prepping items (previously filtered to Listed only). Linking a Prepping item to a platform listing auto-promotes status to Listed.
- **#58 — CLOSED:** Search result highlight on selected sold items now uses a blue-tinted background (`#2a3a4a`) so it's visually distinct from the hover state of adjacent rows (opacity math was making them identical).
- **#55 — CLOSED:** Lots view Lot column header left-aligned to match left-aligned data. Numeric `<th>` elements globally set to `width:1%; white-space:nowrap` to shrink-wrap around content.
- **Checkpoint protocol:** Defined — patch bump + session log + commit + push. Saved to memory and CLAUDE.md.

### 2026-03-27 — v0.9.8 (P1 bug batch + security)
- **#60 — CLOSED:** Momentum panel header moved inside grey panel box (was floating above it).
- **#61 — CLOSED:** ESC-to-close added to label, reverb, ebay, and shipping modals.
- **#62 — CLOSED:** Tab trap added to add, item, and label modals via `store.trapTab()`. Fixed to skip `display:none` elements (x-show hidden inputs were silently swallowing focus).
- **#63 — CLOSED:** CSS audit of Geoff's 3am session — `modal-title` switched from Bebas Neue to Space Mono 16px. All hardcoded ALL CAPS in HTML normalized to title case (CSS `text-transform` handles display). KPI numbers (`stat-card-value`, `modal-big-profit`) kept as Bebas Neue per Geoff's preference. Panel-title bumped to 14px.
- **Security:** Removed `express.static(__dirname)` — was serving entire project root (including `.env`) as public files.

### 2026-03-27 — v0.9.7 (UI cleanup batch)
- **#54 — CLOSED:** Sidebar nav dots now reactive — active view shows `◉`, others show `○`.
- **#59 — CLOSED:** Removed Actions column (Edit + Ship buttons) from items view. Row click opens item modal; Ship is accessible from there.
- **#57 — CLOSED:** Modal footer normalization — Save/Cancel now inline in footer (was split across body/footer); removed all Close buttons; suppressed click-outside dismiss (ESC or ✕ only); softened Delete button (no more red alarm styling).
- **#56 — CLOSED:** Modal section headers more visually distinct (bottom border added). "Status & Classification" → "Item Details" in view mode; "Edit Item" → "Item Details" in edit mode. Add modal gains "Item Details" and "Financials" section headers. "Platform" → "Site" in Add modal.

### 2026-03-26 — v0.9.6
- **Lot modal + lots view — zero cost recovery pct:** Applied same items-sold/total fallback to `recoveryPct()` in lot-modal.js and lots.js so geoffcam-style lots show meaningful progress instead of 0%.

### 2026-03-26 — v0.9.5
- **Lot Recovery widget — header alignment:** Added `text-align: right` to `.num-col` so Cost/Recovered/%/Pipeline headers align with right-aligned data.
- **Lot Recovery widget — zero cost basis:** Lots with no cost (e.g. geoffcam) now show items-sold/total-items % instead of a misleading 0%. Fallback to `—` only if the lot has no items.

### 2026-03-26 — v0.9.4
- **Item modal edit — payout field not saving:** `form.sale` was populated in `startEdit()` but never written back on save. Added `updateOrder()` call + `fetchAll()` so the store reflects the updated sale price immediately.

### 2026-03-26 — v0.9.3
- **#46 — CLOSED:** Validated `paymentSummary.totalDueSeller` is available pre-fulfillment on first real eBay order (Nikon 50mm, $100.69 payout). Simplified eBay payout fallback chain to just `totalDueSeller` — removed `totalMarketplaceFee` and fee-formula fallbacks.
- **eBay label modal success state:** ✓ SHIPPED ON EBAY button now shows green (was red/`--ebay`), matching ✓ SAVED. ORDER DETAILS hidden after successful shipping to reduce button row clutter. Filed #51 to validate on next order.
- **Categories expanded:** Added A/V Gear, Camera, Comics/Books/Media, Home, Junk Drawer. Badge CSS + config.js updated. Bulk-reconciled all non-Reverb items into correct categories (Camera: Nikon lenses/body/flash, Insta360; A/V Gear: NAD, Technics, HDMI switches, Bose, Roku, Samsung TV/BRP, Sony CD-R; Home: AC unit).

### 2026-03-26 — v0.9.1.1 (Hotfix)
- **Chart top clipping:** Label text on the tallest bars was being clipped by the canvas edge. Added top padding to chart layout for label clearance.

### 2026-03-26 — v0.9.1 (Momentum chart)
- **#48 — CLOSED:** Wrote and reviewed implementation plan for momentum chart (`docs/superpowers/plans/2026-03-26-momentum-chart.md`). Code-reviewed and patched before implementation: listing selector fix (`l.order` not `l.status`), tooltip gross computation, x-show/flex conflict, eBay capitalization.
- **#49 — CLOSED:** Implemented momentum chart. Replaces 4-chart analytics grid with a single full-width chart. Windows: 3d/7d/14d/30d (dropped 60d/90d — skewed scale). Hero background bar (custom `beforeDatasetsDraw` plugin) shows total gross/net as a wide translucent wash behind per-site bars. Log y-axis for near-term readability. Gross · net text labels above each cluster. Per-bar site labels (Reverb/eBay in bar color) below each bar. Moved to hero position below KPIs.
- **#50 — CLOSED:** Validated in browser throughout session.

### 2026-03-26 — v0.9.0 (versioning + polish)
- **#40 — CLOSED:** Added semantic versioning. `APP_VERSION` constant in `config.js` displayed in sidebar footer as "Duckwerks Dashboard v0.9.0". `package.json` set to `0.9.0`. Versioning section added to CLAUDE.md: major=re-arch, minor=feature set, patch=session. Tags every patch, GH releases starting at first minor post-1.0.
- **#47 — CLOSED:** Fixed view flicker during batch sync. `updateItem`/`updateListing` now accept `{ skipRefresh: true }` — batch loops in both Reverb and eBay modal `syncDetails()`/`saveLinks()` skip per-update store mutations and let the existing end-of-loop `fetchAll()` do a single clean re-render.
- **eBay modal section order:** Reordered to match Reverb — Awaiting Shipment → Link Listings → Listing Details → New on eBay.

### 2026-03-26 (KPI + calculation fixes)
- **Upside/pipeline KPIs:** Were using `payout()` (EAF, no shipping subtracted) — switched to `estProfit()` so they match the per-row profit column sum. Also fixed filter to `Listed` only — Prepping items have no list price and were pulling numbers negative.
- **Lot modal EST. TOTAL PROFIT:** Was mixing revenue (`recovered`) with est. profit then double-subtracting cost. Fixed to `soldProfit + estUpside` — cost is already baked into `estProfit`.
- **Gross Pending KPI:** New stat card showing EAF payout sum for listed items (before cost basis). Upside Pending now clearly labeled "after cost+fees". Both use `Listed` filter only.

### 2026-03-26 (QoL fixes)
- **Dashboard reorder:** KPIs → In Transit → Recently Listed → Lot Recovery (full width) → Recently Sold (full width) → Analytics
- **Delete item:** `DELETE /api/items/:id` route cascades to listings → orders → shipments via FK cascade. Button in item modal footer (red, right-aligned, confirm dialog). Verified no orphans post-delete.
- **Item edit modal:** "Reverb Listing ID" label now dynamic — shows site name or "Platform" when no site selected.
- **Item modal parity:** Reverb packing slip link added (`/my/orders/{id}/packing_slip.pdf`). eBay gets Order Details + Packing Slip links. Both platforms show order link + packing slip in item modal when `platform_order_num` is present. Same buttons in label modal result step for eBay.

### 2026-03-26 (eBay ship flow validation + packing slip links)
- **Item modal parity:** Added eBay Order Details + Packing Slip links to item modal eBay row (`platform_order_num` required). Added Reverb Packing Slip link (`https://reverb.com/my/orders/{id}/packing_slip.pdf`). Both platforms now show order link + packing slip inline. Label modal result step also has ORDER DETAILS + PACKING SLIP buttons for eBay.

### 2026-03-26 (eBay ship flow validation)
- **#31 — CLOSED:** Validated full eBay ship flow on first real order (Yongnuo YN560 Flash Kit). Fixed four bugs: (1) address was pulling `buyerRegistrationAddress` (Paraguay) instead of `fulfillmentStartInstructions[0].shippingStep.shipTo` (Miami); (2) tracking not pushed to eBay — added `markShippedEbay()` that auto-fires after label purchase, POSTs to `/api/ebay/orders/:id/tracking`; (3) shipped items kept reappearing in Awaiting Shipment — `_process()` now skips records with a `tracking_number`; (4) added MARK SHIPPED ON EBAY button + ORDER DETAILS link in label modal result step. Also: `ebayOrderId` falls back to `r.order?.platform_order_num` so SHIP button works from item modal on already-processed orders. `platform_order_num` now saved for eBay orders.
- **#46 — Awaiting Validation:** eBay payout field availability unknown pre-fulfillment. Current fallback chain: `paymentSummary.totalDueSeller` → `total - totalMarketplaceFee` → fee formula estimate. Console logging in place — next order will reveal which fields eBay returns before shipping. `pricingSummary` vs `paymentSummary` — different objects, easy to confuse. Item 62 (Yongnuo) patched to correct payout of $57.23.

### 2026-03-26 (New on eBay import)
- **#45 — follow-up:** Added "NEW ON EBAY" import section to eBay sync modal. The HTML stub existed from the #45 session but JS was never wired up. `_process()` now computes `newListings` (Browse API listings with no matching local `platform_listing_id`), `importNew()` creates item + listing records (cost=0, URL constructed from `legacyItemId`). Mirrors the Reverb "New on Reverb" pattern exactly. Added `legacyItemId` dedupe in `_process()` — eBay's search index can briefly return the same listing twice, which caused one duplicate import before the fix.

### 2026-03-26 (eBay Browse API + listing details)
- **#45 — CLOSED:** eBay Browse API working. `category_ids=0` returns all active seller listings in one call. Added `getAppToken()` (client credentials, in-memory cache) to `ebay-auth.js`. New `GET /api/ebay/listings` route in `server/ebay.js` paginates via offset. eBay modal now fetches orders + listings in parallel on open. Link Listings dropdown populated from live listings instead of manual paste. Added LISTING DETAILS section (mirrors Reverb) — diffs title+price against live Browse API data, SYNC writes name to item and list_price to listing. Added `listingUrl(r)` to store — constructs `https://www.ebay.com/itm/{id}` or `https://reverb.com/item/{id}` from platform_listing_id; item modal listing link now always clickable for eBay/Reverb items (no longer depends on stored `url`).
- **`EBAY_SELLER_USERNAME=duckwerks`** added to `.env` — required for Browse API seller filter.

### 2026-03-26 (Reverb + eBay listing sync)
- **#44 — CLOSED:** Reverb sync modal now has a "NEW ON REVERB" section. Compares live Reverb listings against local `platform_listing_id`s; shows unmatched listings with checkboxes; IMPORT creates item + listing records (title, price, listing ID, site=Reverb). Defaults cost=0, category=null — fill in after import.
- **#38 — UPDATED:** eBay listing sync investigated. eBay Inventory API (`sell.inventory`) only returns listings created through it — legacy listings (created on eBay website) return empty. Listing Details + New on eBay sections were built then removed. What shipped: (1) Link Listings changed from order dropdown to text input — paste listing ID from eBay URL; (2) item modal "REVERB" label replaced with dynamic site name, links via stored listing URL instead of hardcoded Reverb URL; (3) `sell.inventory` scope added to OAuth + re-auth completed; (4) `Accept-Language` header added to all eBay requests. eBay listing read API deferred to #39 (Trading API path).
- **eBay listing ID flow:** `platform_listing_id` is required for the eBay ship flow — orders match against it. Without it, all eBay orders land in unmatched with no SHIP button. Current workflow: create item in dashboard → create listing on eBay website → Link Listings in Sync eBay to connect them.

### 2026-03-25 (Reverb sync → ship flow + date_sold fixes)
- **#42 — Awaiting Validation:** Reverb sync → ship flow had three compounding bugs: (1) `syncDetails()` calls `updateListing()` per diff, each triggering `fetchAll()` → `buildCharts()` — rapid destroy+recreate of Chart.js instances left destroyed charts with pending RAF callbacks firing on null ctx → infinite loop. Fix: debounce `buildCharts()` 50ms. (2) SHIP button condition required `platform_order_num` to match, but `saveMatches()` skips `updateOrder()` when no local order exists — button stayed hidden forever. Fix: show SHIP when `!item.rec.order` too. (3) Label modal fell back to `platform_listing_id` as order number → 404 on Reverb orders API. Fix: Reverb modal SHIP button sets `store.activeReverbOrderNum` (same pattern as `activeEbayOrderId`), label modal reads and clears it. Validated end-to-end on Behringer MicroAMP HA400 — order/shipment/tracking all landed correctly.
- **#43 — Awaiting Validation:** `saveShipping()` always used today as `date_sold`. Now extracts `order.created_at` (Reverb) and `order.creationDate` (eBay) into `platformSaleDate`; falls back to today only if unavailable. Also fixed item modal date display — was parsing date-only strings as UTC midnight, showing one day early in Pacific. Fix: append `T00:00:00` to force local parse. Added `scripts/fix-sold-dates.js` to backfill correct dates from last 20 Reverb orders — fixed 2 records (MXR M222 Talkbox: test artifact Mar 25→Mar 24; Blue Snowball: Mar 19→Mar 22).

### 2026-03-25 (Recently Sold bug fix)
- **#41 — CLOSED:** Recently Sold showed 12 old eBay items with a fake sold date of Mar 24. Three compounding bugs: (1) migration fallback used today's date when Airtable had no `dateSold`; (2) dashboard `recentlySold` getter fell back to `created_at` for items with no `date_sold`; (3) `soldDate()` parsed date-only strings as UTC midnight, shifting display back one day in Pacific time. Fix: filter `recentlySold` to items with a real `date_sold`, fix timezone parse, null out the 12 bad DB rows (confirmed no dates in Airtable either).

### 2026-03-25 (Label print + reprint session)
- **#35 — CLOSED:** Fixed label printing after a long debugging session. Root cause: `document.write` into a popup doesn't reliably apply CSS, and `@page` size/landscape hints are ignored by Chrome's print dialog. Solution: server-side PDF generation via `pdfkit`. New route `GET /api/label/print-pdf?url=<encodedUrl>` fetches EasyPost PNG, wraps it in an 11×8.5 landscape PDF. Chrome PDF viewer respects embedded page size → dialog defaults to landscape. Label positioned at 0.5in left, 1.25in top to center on 2-up 4×6 label sheet. `printLabel()` in store.js now just calls `window.open('/api/label/print-pdf?url=...')`.
- **Label print debugging notes:** CSS `@page { size: landscape }` is unreliable in Chrome for blob/popup windows. Blob URL approach works better than `document.write` but still can't force print dialog orientation. Only a natively landscape PDF (via pdfkit or similar) reliably sets the dialog. For UI bugs involving print/layout, a screen recording or side-by-side PDF preview comparison is far more useful than text descriptions.
- **#29 — CLOSED:** Reprint Label button was hidden behind `x-show="!trackingInfo"` — invisible whenever tracking data was loaded. Moved it alongside CLEAR TRACKING so it's always visible when `label_url` is present. Validated: `label_url` saves correctly, tracking clears correctly (nulls tracking fields, preserves label_url + shipping_cost).
- **Reverb order number fix:** `orderNum` in label modal now uses `r.order?.platform_order_num` first, falling back to `listing?.platform_listing_id`. Ensures correct Reverb order is fetched when order number differs from listing ID.
- **#31 — Awaiting Validation:** No changes. Still needs a real eBay order to validate end-to-end.

### 2026-03-25 (SQLite validation + cutover session)
- **#36 — CLOSED:** Full audit and fix of SQLite branch — hardcoded category list in addModal, stale function names in lotsView/lotModal, item modal `x-if` on div → `<template x-if>` (caused all record.* errors on page load), add modal missing `form.site`/`form.listPrice`/`form.shipping`/`form.status` from save logic, edit modal field name mismatches (`list_price`→`listPrice` etc.) and missing site handling, `site_id` not in listings PATCH allowed list.
- **#33 — CLOSED:** SQLite implementation was complete; closed on merge.
- **#34 — CLOSED:** Validation passed. Merged `feature/sqlite-migration` → `main`. Airtable base kept online read-only as backup.
- **Add/Edit flow:** Items, listings, and lots all create correctly. Site resolves to listing (not item field). Status respected even when listing auto-sets Listed. Devil duck favicon added.
- **Key debugging note:** `x-show` evaluates all bindings inside even when hidden — use `<template x-if>` to prevent null-record crashes in modals.

### 2026-03-24 (eBay integration session)
- **#31 — IN PROGRESS:** eBay Sell Fulfillment API integration. OAuth setup complete (tokens in `data/ebay-tokens.json`). Server routes: GET orders, GET single order, POST tracking. Frontend: Sync eBay sidebar button + `ebayModal` component — Awaiting Shipment (matched by `legacyItemId` ↔ `platform_listing_id`) + Link Listings sections. Label modal updated to fetch eBay buyer address via `activeEbayOrderId` store field and use `totalDueSeller` as payout. Awaiting first real eBay order to validate end-to-end.
- **eBay OAuth callback:** Deployed `duckwerks.com/ebay-oauth-callback.php` to receive auth code (eBay Production requires HTTPS; localhost not allowed). One-time flow: visit `/api/ebay/auth` → sign in → code displayed on duckwerks.com → run curl to `/api/ebay/auth/exchange`. Re-auth needed in ~18 months.
- **eBay listing sync:** Deferred — requires Sell Inventory API (managed inventory) or Trading API (legacy). Unclear which applies to this account. File follow-up after confirming.
- **duckwerks.com:** Added `ebay-callback.php` (account deletion webhook) and `ebay-oauth-callback.php`. Both deployed. SSH known_hosts issue fixed (`ssh-keygen -R gator3314.hostgator.com`). Fixed rsync wiping `ebay-deletion-log.txt` — added `--filter='protect ebay-deletion-log.txt'` to `deploy.sh`. Added `fetch-ebay-log.sh` helper.

### 2026-03-22 (UPS rates fix session)
- **UPS rates missing — FIXED:** `label_size: 'letter'` (set last session) is not a valid EasyPost enum for UPS — UPS silently drops from the rates response when it can't honor the label_size option. Switched to `'8.5X11'` which is cross-carrier and produces the same 8.5x11 PDF output.
- **Debugging tip:** EasyPost returns a `messages` array in the shipment response with per-carrier rate errors. Log `data.messages` to diagnose missing carriers — the UPS error was `"label_size: value is not a valid enumeration member; permitted: '4X6', '4X8', '4X4', '6X4', '8.5X11'"`. EasyPost auto-includes all linked carrier accounts; no need to specify them explicitly.

### 2026-03-22 (API + label printing session)
- **#30 enhancement (P2) — DONE:** Removed redundant `fetchAll()` calls in `label-modal.js` (`saveShipping()`) and `item-modal.js` (`clearTracking()`). `updateRecord()` already updates the local store in-place from the PATCH response — a full refetch was unnecessary. Reduces Airtable API usage on every label purchase and item save.
- **EasyPost label size:** Changed `label_size` from `'4X6'` to `'letter'` in `server/label.js` — later corrected to `'8.5X11'` (see next session) because `'letter'` is not a valid UPS enum value and silently blocked UPS rates.
- **#29 enhancement (P2) — awaiting validation:** Persist `labelUrl` to Airtable on label purchase (`F.labelUrl = fld6gsm3lU2L1cK4V`). Saved in `saveShipping()` alongside tracking fields. Item modal Shipment section shows "↗ Reprint Label" link when field is populated. Validate on next live label purchase.

### 2026-03-20 (Site-aware fees + add modal shipping session)
- **Site-aware fee lookup:** Added `SITE_FEES` table to `store.js` — fee functions keyed by site label. Reverb: 5% + 3.19% + $0.49 (item price only). eBay: 13.25% on total (item + shipping) + $0.40 flat (consumer electronics rate — verify after first AV sale). Facebook: no fees. Unknown sites fall back to no fees.
- **`estProfit()` updated:** Now uses `SITE_FEES[siteLabel(r)]` instead of always applying Reverb fees. `eaf()` left untouched — still used as a Reverb-specific display metric across views/modals.
- **Est. Shipping in Add modal:** Optional number field added to add-modal form, HTML, and save logic. Saved to `F.shipping` if filled in — `estProfit()` uses it immediately; blank fields still fall back to $10 placeholder.

### 2026-03-20 (First real order + upside/status cleanup session)
- **#28 bug (P1) — DONE:** MARK SHIPPED ON REVERB button was unresponsive — success set `saveMsg = '✓ buyer notified'` which was filtered out by the error-only span. Also, concurrent `saveShipping()` could overwrite any Reverb error. Fixed by introducing `reverbShipMsg` state separate from `saveMsg`. Button now shows NOTIFYING... → ✓ SHIPPED ON REVERB and disables after success. Errors display in their own span.
- **EasyPost label size:** Added `label_format: 'PDF', label_size: '4X6'` to shipment options in `server/label.js`. Must be set at shipment creation (rates step), not purchase.
- **#29 enhancement (P2) — FILED:** Persist `labelUrl` to Airtable so labels can be reprinted from item modal after the label modal closes.
- **Pending status removed:** "Pending" was never an Airtable status option (actual statuses: Listed, Sold, Prepping). Removed from all status dropdowns, filter pills, `store.pendingRecords` getter, and pipeline chart.
- **EST UPSIDE fixes:** Lot modal `estUpside()`, lots view `estUpside()`, and dashboard `pipeline` now include all non-Sold items (Prepping + Listed) instead of Listed-only.

### 2026-03-19 (Tracking polish + lot modal bug fixes session)
- **#21 enhancement (P2) — DONE:** CLEAR TRACKING button in item modal Shipment section. Clears `trackingId`, `trackingNumber`, `trackerUrl` from Airtable and refreshes store. Validated with test label.
- **#25 bug (P2) — DONE:** Carrier + service name maps in `server/label.js` (`CARRIER_NAMES`, `SERVICE_NAMES`) applied to rates response and `fetchTracker`. In Transit tables fixed: `items-table` (no CSS) → `data-table`, fixed column widths, centered data cells. Delivered items stay visible 3 days via EasyPost delivery event datetime; logic centralized in `store.isInTransit(r, trackingData)`. Note: EasyPost test mode uses historical fake delivery dates so delivered items disappear immediately in test — expected behavior, not a bug.
- **#26 bug (P2) — DONE:** `saveShipping()` now calls `fetchAll()` after the Airtable write so dashboard `_loadTracking()` fires via `$watch` on loading immediately after label purchase.
- **#27 bug (P2) — DONE:** Label modal result screen showed duplicate saved state — button already shows `✓ SAVED`, so `saveMsg` span now only renders on errors.

### 2026-03-19 (Lot modal bug fixes session)
- **#22 bug (P1) — DONE:** Lot modal profit column now shows actual `F.profit` for sold items instead of `estProfit()` (which used list price). Renamed column from "Est Profit" to "Profit". Color class updated to use same value.
- **#24 bug (P2) — DONE:** EAF column in lot modal now shows `—` for sold items — EAF is only meaningful for listed items.
- **#23 bug (P1) — DONE:** Added `previousModal` state to store. Opening an item from lot modal stashes the lot state; close/escape/click-outside on item modal restores lot modal. Guarded lot modal escape handler with `activeModal === 'lot'` check to prevent double-fire.

### 2026-03-18 (Shipment tracking session)
- **#19 enhancement (P1) — DONE (awaiting live label validation):** Full EasyPost tracking feature. New Airtable fields: `trackingId`, `trackingNumber`, `trackerUrl`. New `GET /api/label/tracker/:id` server proxy. `store.fetchTracker(id)` shared helper. `saveShipping()` now saves all 3 tracking fields at purchase. Shipping sidebar button restored (always visible); modal repurposed as "In Transit" panel showing all sold+tracked items with live status badges + Refresh All. Dashboard "In Transit" panel (appears only when items have tracking, hides when all delivered). Items view Sold filter gets a Tracking column. Item modal read view gets a Shipment section with status, carrier, est. delivery, timeline, public tracker link. All 4 surfaces use collect-then-assign pattern to avoid concurrent spread race. Cannot fully validate until next live label purchase populates `trackingId`.

### 2026-03-18 (EasyPost migration session)
- **#18 bug (P2) — DONE:** Implemented EasyPost alongside Shippo with `SHIPPING_PROVIDER` env switch. New `server/label.js` handles `/api/label/*` for both providers. EasyPost weight conversion (lbs→oz), `shipmentId|rateId` encoding in `object_id` (transparent to client). Shippo usage counter preserved, gated to Shippo-only. Shipping sidebar button hidden when on EasyPost (returns for tracking feature). Live EasyPost confirmed working end-to-end in test mode then switched to live.
- **#17 enhancement (P1) — DONE:** Resolved by EasyPost migration — 3000 labels/month, proper sandbox (test labels don't count against quota).
- **#12 bug (P1) — still awaiting real-order validation**

### 2026-03-17 (Shipping modal + Shippo investigation session)
- **#17 enhancement (P1) — DONE:** Added Shipping sidebar button and modal. `GET /api/label/usage` endpoint in `server/shippo.js` — always queries live token, filters `object_test=false` at API level, `status=SUCCESS` on response. Billing cycle uses epoch math from `BILLING_EPOCH = 2026-03-11` (confirmed by Shippo support) + 30-day rolling window. Color-coded usage display (green/yellow/red). Fixed UTC timezone display bug (March 11 was rendering as March 10 in Pacific).
- **#18 bug (P2) — FILED:** Shippo free tier limitations. Test labels count against 30-label quota but don't appear via live PAT (can't count them). Refunded labels eventually drop out. Support unable to offer workaround. Need to evaluate EasyPost or ShipEngine as replacements — requirement is UPS rates comparable to PirateShip.

### 2026-03-17 (CSS polish + Reverb sync per-item session)
- **#16 bug (P1) — DONE:** Centered all table headers and badge/value cells across all list views (Items, Lots, Dashboard tables, Lot modal). Name/item name tds kept left-aligned. Numeric `td.num`/`td.num-col` stay right-aligned. Added `white-space: nowrap` to sortable `th` to prevent sort arrow wrapping onto its own line.
- **No ticket:** Music badge changed from blue to orange (too close to Reverb badge). Gaming badge changed from orange to pink (`#d070b0` on `#2e1a2a`) to compensate.
- **#15 enhancement (P1) — DONE:** Per-item checkboxes on Reverb Sync listing detail diffs. Each row defaults checked; SYNC button shows selected count and disables when nothing is checked. `detailSelections` state initialized in `_process()`, reset in `run()`, filtered in `syncDetails()`.

### 2026-03-17 (Reverb Sync Details session)
- **#14 enhancement (P1) — DONE:** Reverb Sync modal now has a "LISTING DETAILS" section. Fetches all listing pages (paginated via `_links.next.href`). Computes name/price diffs in `_process()` from already-fetched listings (zero extra API calls). SYNC button writes changed fields to Airtable, then `fetchAll()` + `_process()` to clear resolved diffs. Defined `--white: #f0f0f0` in `main.css :root` (was previously used but undefined). Spec + plan in `docs/superpowers/`.
- **#15 enhancement (P1) — OPEN:** Per-item accept/decline for listing detail diffs. Currently bulk-only. Filed with full implementation notes (checkboxes per row, `detailSelections` state, filter in `syncDetails()`).
- **#12 bug (P1) — still awaiting real-order validation**

### 2026-03-17 (Dashboard Charts session)
- **#4 enhancement (P2):** Dashboard analytics charts — added 4-chart analytics section using Chart.js 4 CDN (no build step). New file `public/v2/js/charts.js` registers `Alpine.data('chartsSection')` with dual-path init pattern (`$watch` + immediate check). Charts: (1) Monthly Revenue + Profit (bar+line combo, YYYY-MM sort key), (2) Inventory Pipeline (horizontal stacked bar, Unlisted/Listed/Pending/Sold with EAF/cost annotations), (3) Lot ROI (horizontal bars, color-coded green/yellow/red, recomputed from store not dashView), (4) Near-term Upside by Category (vertical bars, category colors). HTML no-data overlays via `x-show` on each canvas. Charts section positioned above Lot Recovery. Spec + plan in `docs/superpowers/specs/` and `docs/superpowers/plans/`. `.superpowers/` added to `.gitignore`.
- **#12 bug (P1) — OPEN:** Item update/shipping flow still pushing Reverb listing price instead of actual earnings as sale price. To be fixed next session.

### 2026-03-17 (Decimal + cleanup session)
- **#13 enhancement (P1):** Bring back decimals — updated `fmt0()` in `store.js` to use `toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`. All price displays now show 2 decimal places (e.g. `$150.00`). One-line change, all views/modals updated automatically.
- **#12 bug (P1) — OPEN (fixed, awaiting validation):** Sale price fix already committed (`d2353d3`). Using `direct_checkout_payout.amount` (post-fee) instead of listing price. Left open until confirmed on a real incoming Reverb order.

### 2026-03-17 (P2 Enhancement session)
- **#2 enhancement (P2):** Readability pass — body font 13→15px, table rows 12→14px, table headers 10→11px, badges 11→12px, uppercase labels 10→11px, `--muted` #888→#999. Note: table has its own `font-size` that must be updated separately from body.
- **#5 enhancement (P2):** Sortable column headers on Items and Lots views. `sortBy`/`sortIndicator` pattern; default `createdTime DESC`. Added "Added" date column (first column, muted, `nowrap`) to Items table so `createdTime` sort is always accessible.
- **#7 enhancement (P2):** "Recently Listed" full-width panel on Dashboard, below the lot recovery / recently sold 2-col grid. Same structure as Recently Sold: 10 items, clickable rows open item modal. Also standardized "Sold" date column in Recently Sold to match Added format (`Mon Day`, first column).

### 2026-03-17 (Bug & Enhancement session)
- **#8 bug (P1):** Lot Detail Modal columns — renamed "List / EAF" header to "EAF"; added `white-space:nowrap` to non-name `<th>` elements so Name column gets full remaining width
- **#6 enhancement (P1):** Item modal drill-down — Status, Category, Site badges now clickable; navigate to Items view with that filter applied (others reset to All). Lot field opens Lot detail modal. Added `navToItems(status, category, site)` to store + `pendingFilters` pattern for reliable cross-component filter handoff. Pill clicks clear `categoryFilter` to prevent silent filter stacking. Normalized all "Platform" labels to "Site".

### 2026-03-16 (Bug & Enhancement session)
- **#1 bug (P1):** Search results scrollable dropdown — added `scrollIntoView` on active row during keyboard nav
- **#3 enhancement (P1):** Sidebar logo — replaced base64 JPEG with actual file (`public/v2/duckwerksheader.jpeg`); full-bleed banner with zoom/crop to foreground, DUCKWERKS title below

### 2026-03-16 (Phase 8)
- Added `cmd+k` shortcut to focus search (alongside `/`)
- Added localStorage persistence for `activeView` via `Alpine.effect()` in store init
- Added "needs attention" flag (⚑ orange) on Items view for Listed items ≥ 20 days (uses `createdTime`)
- Added keyboard navigation (↑/↓/Enter) to Quick Find search results
- Cutover: `GET /` now redirects to `/v2`; old dashboard accessible at `/duckwerks-dashboard.html`
- Switched to GitHub Issues for bug/enhancement tracking (`gh` CLI, HTTPS auth)
- Cleaned up CLAUDE.md: removed all porting/build-phase framing; deleted `duckwerks-v2-buildplan.md` and `duckwerks_dashboard_architecture.md`

### 2026-03-16 (Phase 7)
- Implemented Label modal (`label-modal.js`) — lbs+oz weight, 3-step flow (form→rates→result), auto-fills address from Reverb order, auto mark-shipped on Reverb after purchase
- SAVE SHIPPING COST closes out sale: sets status=Sold, dateSold, sale price (from Reverb order), shipping in one write
- Implemented Reverb Sync modal (`reverb-modal.js`) — awaiting shipment matching + link listings; SHIP button directly on matched orders
- Moved `SHIPPO_TEST_MODE` server-side to `.env`; server logs active mode on startup
- Fixed packing slip: `_links.packing_slip.web.href` is a plain reverb.com URL — open directly, no proxy
- **Post-phase bug fixes:** auto-save on purchase; switched sale amount to `direct_checkout_payout` (post-fee); SAVE button shows ✓ SAVED state

### 2026-03-16 (Phase 6)
- Implemented Dashboard view — 5 stat cards (Total Invested, Revenue, Profit, Upside Pending, Inventory) + Lot Recovery table + Recently Sold table
- Added `F.dateSold` field (`fldcIJOUtePuaxAVH`) to `config.js`
- Auto-populate dateSold when status set to Sold (items.js inline + item-modal.js save)
- Added `scripts/backfill-sold-dates.js` and `scripts/match-reverb-orders.js` — one-time data migration scripts

### 2026-03-16 (Phase 5)
- Implemented Lots view and Lot modal
- Fixed Add modal Lot dropdown always disabled — Alpine treats `''` as truthy for boolean attributes
- Added "+ ADD ANOTHER" button to Add modal

### 2026-03-15 (Phase 4)
- Implemented Item modal (read + edit views) and Add modal
- Added `createRecord()` to store; modal CSS to components.css; `[x-cloak]` rule

### 2026-03-15 (Phase 3)
- Implemented Items view — status/site/name filters, full table, inline status edit
- Added `updateRecord()` to store

### 2026-03-15 (Phase 2)
- Implemented Quick Find search in sidebar — items, lots, categories; keyboard shortcut `/`

### 2026-03-15 (Phase 1)
- Split `server.js` into modules; added `server/airtable.js` proxy
- Scaffolded full `public/v2/` file structure; Alpine store wired up
