# GOTCHAS — Duckwerks Dashboard

> Dated operational war-stories, sectioned by subsystem. Grep this mid-task; don't read it cover-to-cover. The pattern: *what bit us, why the weird workaround exists.* When something bites, add an entry here — not inline in CLAUDE.md.

---

## Database (SQLite)

**`node -e` with better-sqlite3 hangs the process.** better-sqlite3 never closes the db handle on its own, so a `node -e "..."` inline script opens the database and then never exits — the process hangs and has to be killed. Use `scripts/db.sh "<sql>"` instead: it shells out to the `sqlite3` CLI (which exits cleanly) against the NUC database (the source of truth). `--local` hits the stale local copy. Writes still follow the confirm protocol in CLAUDE.md — the wrapper is the *how*, not a bypass.

**The local `data/duckwerks.db` is stale and useless.** The NUC copy at `/srv/duckwerks/dash/data/duckwerks.db` (symlinked as `data/` into each release) is the source of truth. `scripts/db.sh` targets it by default for exactly this reason; never reason from the local file.

**2026-05-15: WAL grows unbounded under PM2 without a periodic checkpoint.** The long-lived PM2-managed connection holds the database open, which blocks SQLite's automatic WAL auto-truncation. The WAL hit 5.8MB against a 596KB main db before anyone noticed; a manual `wal_checkpoint(TRUNCATE)` reclaimed it instantly. Fixed with an hourly `PRAGMA wal_checkpoint(PASSIVE)` via `setInterval` in `server/db.js`. If the WAL balloons again, checkpoint manually rather than suspecting the schema.

---

## eBay

**2026-07-09: Inventory API GET→PUT round-trips self-destruct on weight.** GET `inventory_item/{sku}` serializes a never-set package weight as `packageWeightAndSize.weight: { value: 0, unit: "POUND" }`, but PUT rejects `value: 0` (`25709 Invalid value for weight.value`) — so echoing eBay's own GET body back at it 400s. Bit the EQ title-revision pass: all 9 `update-item` calls failed identically. `putInventoryItem` in `server/ebay-client.js` strips a zero weight (and an emptied `packageWeightAndSize`) before every PUT, so all round-trip paths are safe by construction. Related trap: PUT replaces the whole inventory item, so a path that rebuilds the body instead of spreading `existing` silently erases fields it omits (`bulk-photos` does this deliberately for weight-less discs).

**Traffic API — use `TOTAL_IMPRESSION_TOTAL`, not `LISTING_IMPRESSION_TOTAL`.** `TOTAL_IMPRESSION_TOTAL` includes promoted-listing impressions; `LISTING_IMPRESSION_TOTAL` is organic only. The Seller Hub UI shows the total, so the organic-only metric will silently undercount and not match what Geoff sees. Used in `public/v2/js/views/analytics.js`.

**eBay rejects a `scope` parameter in the refresh-token request body.** `refreshAccessToken()` in `server/ebay-auth.js` sends only `grant_type` and `refresh_token`; the refreshed access token inherits whatever scopes the original grant had. There's no way to add a new scope via refresh; a scope change needs a full browser re-auth with the new scope list.

**Build eBay's `{ }` / `[ ]` filter syntax as raw strings, never through `URLSearchParams`.** `URLSearchParams` percent-encodes `[`, `]`, `{`, `}`, `|`, and eBay's filter parser rejects the encoded form outright. Bit two separate features: the fulfillment order filter (`orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`, `server/ebay.js`) and the traffic report filter (`marketplace_ids:{...},date_range:[...],listing_ids:{...}`, also `server/ebay.js`). Both build the query string by manual template-literal concatenation instead of `URLSearchParams`.

**2026-04-05: eBay's Media (EPS) image upload is two HTTP calls, not one.** POST to `apim.ebay.com/commerce/media/v1_beta/.../create_image_from_file` returns 201 with an empty body and the image reference in the `Location` header; a second GET against that URL returns the actual `imageUrl`. `uploadToEPS()` in `server/ebay-client.js` does both steps. A 201 with no visible payload is success, not a failure; check the `Location` header before assuming the upload broke.

**`publishOffer` retries once, 3s later, on eBay errorId 25604.** 25604 ("Product not found") is eBay's async-processing lag right after an offer is created, not a real failure; it usually clears within a few seconds. `publishOffer()` in `server/ebay-client.js` catches exactly that errorId, waits 3s, and retries once before surfacing the error. If it still fails after the retry, that's a genuine error; don't bolt on a second retry loop upstream.

**2026-04-06, bit again 2026-05-16: category 184356 (Disc Golf Discs) silently requires `USED_EXCELLENT`, not `USED`.** `USED` is only a UI display label, not a valid Inventory API `ConditionEnum`; the category shows no condition sub-grades in Seller Hub, so nothing in the UI hints at this. `normalizeCondition()` in `server/ebay-builders.js` maps `USED` → `USED_EXCELLENT` before any payload is built. If a disc listing throws a condition-related error (e.g. 2004), confirm the payload actually went through `normalizeCondition()` rather than bypassing the builder.

**2026-05-01/02: eBay Motors (category 9886 and its subcategories) rejects Inventory API listings for missing fitment data.** Motors categories need an ASSEMBLY-based fitment table (e.g. `US_CARS_AND_TRUCKS`) that the Inventory API can't carry through item specifics alone. Workaround: list under a non-Motors category (e.g. Consumer Electronics 258), then manually recategorize in Seller Hub. Treat the recategorize step as risky, not routine: one HIKEit relist went unbuyable ("out of stock") after a manual category change and had to be withdrawn and relisted from scratch via Seller Hub.

**2026-05-16: `upsertOffer(offerBody, headers)` and `updateOffer(offerId, offerBody, headers)` have different argument orders.** `upsertOffer` (new listings, used by `bulk-list`) takes `(body, headers)`; `updateOffer` (existing listings, used by `bulk-update` and `update-item`) takes `(offerId, body, headers)`, note the extra leading `offerId`. Transposing them passes an offer ID where a body is expected with no obvious error at the call site. Flagged during the 2026-05-16 `ebay-client.js` extraction; check the signature before wiring up a new caller.

**2026-07-01: offer updates silently strip business policies; pin the return policy, never trust `returnPolicies[0]`.** `updateOffer` is a full PUT replace, and spreading `...offer.listingPolicies` re-writes the live offer's stripped state (no policy IDs), leaving listings on account defaults. Separately, the account carries FOUR return policies (two seller-pays, two buyer-pays; the API-created ones are invisible in Seller Hub's UI), so `returnPolicies[0]` was roulette: batches listed with a buyer-pays policy lost the Top Rated Plus 10% final-value-fee discount for months. The fix: `RETURN_POLICY_ID` is pinned in `server/ebay-client.js` (free 30 days money back, seller pays, a deliberate business choice), and every offer PUT sets all three policy IDs explicitly, which makes any bulk sweep self-healing.

**2026-07-01: eBay fee forensics: the fee base includes buyer sales tax, and the Finances API's basis excludes it.** The final value fee is (price + collected shipping + buyer state tax) x category rate, minus the per-listing TRS+ discount, plus $0.40 fixed per order, all netted into the fee at sale time (`totalDueSeller` already reflects the discount; there is no payout-time bump). But `pricingSummary.total` and Finances' `totalFeeBasisAmount` both EXCLUDE the tax, so an implied rate computed from either cannot distinguish a discounted order with tax from a full-rate order without: the bands overlap. A whole evening was spent misclassifying June orders this way. Per-order truth is the Seller Hub fee-details page, or Finances fees joined with the Fulfillment order's tax fields. Never assert discount presence or absence from implied rates alone.

**2026-07-01: `orders.sale_price` is the post-fee payout; a session "fixed" fees into realized profit and had to revert.** The ship flow stores what the seller is paid: eBay `paymentSummary.totalDueSeller` split per line item, Reverb `direct_checkout_payout`. Both are net of platform fees (verified against Seller Hub: `pricingSummary.total` 17.00, `totalDueSeller` 14.39, fees 2.61). Issue #136 assumed stored prices were gross, derived a ~$500 "missing fees" gap from the site formula (circular; never checked a payout report), and the resulting backfill would have double-counted ~$942 across 245 orders; the SELECT-first confirm step caught it. The rules: realized numbers (`order.profit`, the momentum chart) read `orders.fees` (normally 0), never `siteFee()`; the fee formula exists only for yellow estimates on listed items; and before believing any "the stored money value is wrong" claim, verify one real order against Seller Hub first.

---

## Disc catalog & titles

**2026-07-01 — One fact, three stores: price & title drift (#134).** A disc lives in two stores linked by SKU: the `inventory` blob (`metadata` JSON) and the `items`/`listings` engine. After the #134 refactor there is exactly one canonical home per concept — **never trust the blob for these:**
- **Live price → `listings.list_price`** (per marketplace). The blob's `listPrice` is intake *staging* only, nulled once the disc is listed. `bulk-update`/`bulk-preview` resolve price from the listing row (`resolveListedFields`), not the blob.
- **Title → `items.name`** (materialized). The blob's `list_title` is the *spec* (a custom override string, or null = "generate me"). `resolveDiscTitle(blob)` resolves it; the hot path never regenerates — it reads `items.name`.
- **Lifecycle → `items.status`** (`Prepping`/`Listed`/`Sold`). `inventory.status` is a **retired tombstone** — nothing reads it (the catalog "hide sold" filter reads `item_status`).

The trap this fixed: a catalog-driven `bulk-update` used to read the blob and could revert a live eBay price/title to a stale blob value (DWG-009: blob `$89` vs live `$24`). Before any catalog-driven bulk push, verify blob vs listing/item. To re-align `items.name` after a `generateDiscTitle` template change, run `scripts/refresh-disc-titles.js` **on the NUC** (dry-run → `--confirm`). Never null a `list_title` override to force a regen — that destroys the curated title; `resolveDiscTitle` already leaves overrides untouched through template changes.

---

## Frontend (Alpine)

**Every modal overlay needs the full triad on its root div or it's permanently visible and breaks the whole UI.** The root div must carry `x-show`, `x-data`, `class="modal-overlay"`, and `x-cloak`:

```html
<div x-show="$store.dw.activeModal === 'modal-name'" x-data="modalComponent" class="modal-overlay" x-cloak>
```

And the component needs an `init()` that `$watch`es `activeModal` to `reset()` on open:

```js
init() {
  this.$watch('$store.dw.activeModal', val => { if (val === 'modal-name') this.reset(); });
},
```

Miss any of these and the modal renders on top of everything at load.

---

## NUC / PM2

**systemd kills PM2 on restart because of a stale `PIDFile=` directive.** If the server is randomly restarting or 502ing, check the PM2 systemd service first:

```bash
sudo journalctl -u pm2-geoff.service -n 20
sudo systemctl status pm2-geoff.service
```

Look for "Can't open PID file" or a climbing restart counter. Root cause: the `PIDFile=` directive in `/etc/systemd/system/pm2-geoff.service` makes systemd kill PM2 when it can't read the PID file. Fix: remove `PIDFile=`, set `Type=oneshot` + `RemainAfterExit=yes`.

---

## Comp research (SerpAPI)

**2026-03-29/30: eBay's own APIs are a dead end for comp research; SerpAPI is the only path that worked.** Puppeteer scraping (headless, `headless: 'new'`, and headed) all hit eBay's bot-detection challenge page; a direct fetch with browser headers just got eBay's CSR shell (0 items in the raw HTML); the Finding API's `findCompletedItems` returned error 10001 (access not enabled for the App ID). Switched to SerpAPI's eBay engine (`show_only=Sold`) in `server/comps.js`, which returns real sold listings with a `sold_date` field. Don't re-attempt a native eBay scrape, Browse API, or Finding API for comps; it's already been tried and blocked.

**2026-04-19: Puppeteer runs in a child process, never inline in Express.** A Chromium crash in the main process would take the whole server down with it. `searchReverb()` in `server/comps.js` spawns `scripts/reverb-scrape.js` via `child_process.spawn` instead of driving Puppeteer directly in-process. Keep any future scraper out-of-process for the same reason; Chromium on Fedora also needs `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`.

**SerpAPI's eBay engine needs `ebay_domain: 'ebay.com'` or it returns the wrong market.** Without the explicit domain param, the eBay engine defaults to a global/international search — comp results come back as Chinese-language listings with inflated/unverifiable prices and future-dated results. Fixed by adding `ebay_domain: 'ebay.com'` to `searchItem()` params in `server/comps.js` (commit `0c1a733`).

*How to apply:* if comp results ever look weird again (Chinese characters, inflated prices, future dates), check that `ebay_domain` is still set in the SerpAPI params.

**2026-07-13: comps returning empty / 429 usually means the SerpAPI quota is gone — check the account before debugging code.** The 2026-07-09 episode of the eBay engine returning empty for every query turned out to be a compromised API key burning the monthly search quota (exhaustion later surfaced explicitly as HTTP 429 "Your account has run out of searches"). Key was rotated 2026-07-13; git history scanned clean (the key never leaked via this repo — the repo is public, so re-run that check if a key ever changes hands again). Per-source errors now surface in the `/api/comps/search` response `errors` array, so a dead source is distinguishable from genuinely-zero comps.
