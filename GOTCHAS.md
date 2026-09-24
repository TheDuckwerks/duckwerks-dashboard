# GOTCHAS — Duckwerks Dashboard

> Non-obvious traps likely to recur, stated as the trap, by subsystem. The story of hitting one is in `docs/session-log.md`. The date is when the trap was last seen true; re-probe an old one before building on it.

## Database (SQLite)

- **`node -e` with better-sqlite3 hangs the process.** better-sqlite3 never closes the db handle on its own, so an inline `node -e "..."` script opens the database and never exits. Use `scripts/db.sh "<sql>"` instead — it shells out to the `sqlite3` CLI, which exits cleanly, against the NUC database (the source of truth; `--local` hits a stale local copy). Writes still follow the confirm protocol in AGENTS.md; the wrapper is the *how*, not a bypass.

- **The local `data/duckwerks.db` is stale and useless — never reason from it.** The source of truth is `/srv/duckwerks/dash/data/duckwerks.db` (symlinked as `data/` into each release). `scripts/db.sh` targets it by default for exactly this reason.

## eBay

- **A GET→PUT round-trip can self-destruct on weight.** GET `inventory_item/{sku}` serializes a never-set package weight as `value: 0`, but PUT rejects `value: 0` (`25709 Invalid value for weight.value`) — echoing eBay's own GET body back at it 400s. `putInventoryItem` (`server/ebay-client.js`) strips a zero weight before every PUT. General trap this fits inside: PUT replaces the *whole* inventory item, so any path that rebuilds the body instead of spreading `existing` silently erases fields it omits.

- **Traffic API: use `TOTAL_IMPRESSION_TOTAL`, not `LISTING_IMPRESSION_TOTAL`.** The latter is organic-only and will silently undercount against what Seller Hub (and Geoff) shows. Used in `public/v2/js/views/analytics.js`.

- **eBay rejects a `scope` parameter in the refresh-token request body.** `refreshAccessToken()` (`server/ebay-auth.js`) sends only `grant_type` and `refresh_token`; a refreshed token inherits the original grant's scopes. Adding a scope requires a full browser re-auth, not a refresh.

- **Build eBay's `{ }` / `[ ]` filter syntax as raw strings, never through `URLSearchParams`.** It percent-encodes `[`, `]`, `{`, `}`, `|`, and eBay's filter parser rejects the encoded form. Both the fulfillment-order filter and the traffic-report filter (`server/ebay.js`) build the query string by manual template-literal concatenation for this reason.

- **`publishOffer` retries once, 3s later, on eBay errorId 25604.** 25604 ("Product not found") is eBay's async-processing lag right after an offer is created, not a real failure — it usually clears within seconds. `publishOffer()` (`server/ebay-client.js`) catches exactly that errorId and retries once before surfacing the error; if it still fails after the retry, that's genuine and doesn't need a second retry loop bolted on upstream.

- **eBay's Media (EPS) image upload is two HTTP calls, not one.** POST to `create_image_from_file` returns 201 with an empty body and the image reference in the `Location` header; a second GET against that URL returns the actual `imageUrl`. A 201 with no visible payload is success, not failure. `uploadToEPS()` (`server/ebay-client.js`) does both steps.

- **Category 184356 (Disc Golf Discs) silently requires `USED_EXCELLENT`, not `USED`.** `USED` is a UI-only display label, not a valid `ConditionEnum`, and the category shows no condition sub-grades in Seller Hub — nothing hints at this. Bit twice (2026-04-06, 2026-05-16). `normalizeCondition()` (`server/ebay-builders.js`) maps it; if a disc listing throws a condition error, confirm the payload went through the builder rather than around it.

- **eBay Motors (category 9886 and subcategories) rejects Inventory API listings for missing fitment data**, which the API can't carry through item specifics alone. Workaround: list under a non-Motors category (e.g. Consumer Electronics 258), then manually recategorize in Seller Hub — treat that recategorize step as risky, not routine (one relist went unbuyable and had to be withdrawn and relisted from scratch).

- **`upsertOffer(body, headers)` and `updateOffer(offerId, body, headers)` have different argument orders.** Transposing them passes an offer ID where a body is expected, with no obvious error at the call site. Check the signature before wiring up a new caller.

- **Offer updates silently strip business policies — pin the return policy, never trust `returnPolicies[0]`.** `updateOffer` is a full PUT replace, so spreading `...offer.listingPolicies` re-writes the live offer's stripped state. The account carries four return policies (API-created ones invisible in Seller Hub's UI); `returnPolicies[0]` is roulette — batches listed with the wrong one lost the Top Rated Plus fee discount for months. `RETURN_POLICY_ID` is pinned in `server/ebay-client.js`, and every offer PUT sets all three policy IDs explicitly.

- **eBay's fee base includes buyer sales tax; the Finances API's basis excludes it — you can't back out the discount from an implied rate.** `pricingSummary.total` and `totalFeeBasisAmount` both exclude tax, so a discounted order with tax and a full-rate order without tax land in overlapping implied-rate bands. Per-order truth is the Seller Hub fee-details page, or Finances fees joined with the Fulfillment order's tax fields.

- **`orders.sale_price` is the post-fee payout, already net of platform fees — don't re-derive "missing fees" from the site fee formula.** Realized numbers (`order.profit`, the momentum chart) read `orders.fees` (normally 0), never `siteFee()`; the fee formula exists only for yellow estimates on listed items. Before believing any "the stored money value is wrong" claim, verify one real order against Seller Hub first (a prior attempt derived a ~$500 phantom gap this way and would have double-counted ~$942 across 245 orders had the SELECT-first confirm step not caught it).

## Disc catalog & titles

- **One fact, three stores — never trust the `inventory` blob for live price, title, or lifecycle.** (2026-07-01, `#134`) A disc lives in the `inventory` blob (`metadata` JSON, intake staging only) and the `items`/`listings` engine (canonical). Live price is `listings.list_price`; title is `items.name` (`resolveDiscTitle(blob)` resolves the spec, the hot path never regenerates); lifecycle is `items.status` (`inventory.status` is a retired tombstone nothing reads). A catalog-driven bulk push that reads the blob instead can revert a live eBay price/title to a stale value. To re-align `items.name` after a title-template change, run `scripts/refresh-disc-titles.js` **on the NUC** (dry-run → `--confirm`) — never null a `list_title` override to force a regen, it destroys the curated title.

## Frontend (Alpine)

- **A modal overlay missing any part of the triad renders on top of everything at load, permanently visible.** The root div needs `x-show`, `x-data`, `class="modal-overlay"`, and `x-cloak`:

  ```html
  <div x-show="$store.dw.activeModal === 'modal-name'" x-data="modalComponent" class="modal-overlay" x-cloak>
  ```

  and the component needs an `init()` that `$watch`es `activeModal` to `reset()` on open.

## NUC / PM2

- **The NUC's operating principal is `duckops`, not `geoff` — a `Permission denied` from a deploy or db write means you're on the wrong account.** `geoff@` still ssh-es (rescue account; group-readable only) but can't mkdir under `releases/` or write the db (WAL needs dir write). `db.sh` and deploys ride `duckops@`. If a new script grows an ssh target, it's duckops.

- **A stale `PIDFile=` in the PM2 systemd unit makes systemd kill PM2 on restart.** If the server is randomly restarting or 502ing, check `sudo journalctl -u pm2-duckops.service -n 20` and `sudo systemctl status pm2-duckops.service` for "Can't open PID file" or a climbing restart counter before suspecting the app. Fix: remove `PIDFile=`, set `Type=oneshot` + `RemainAfterExit=yes` — this has recurred once already (`pm2-geoff.service`, 2026-05) after a `pm2 startup` regeneration, so it can come back if the unit is regenerated.

## Comp research (SerpAPI)

- **Every automated sold-comp path is closed; sold comps are a manual, logged-in-browser job.** Native eBay scrape is bot-detection-blocked, the Finding API isn't enabled for this App ID, Browse API is active-listings only, Marketplace Insights was applied for and refused (don't re-propose it), and SerpAPI's sold filter (2026-07-27) hits eBay's login wall — it reports `"status": "Success"`, `"organic_results_state": "Fully empty"` after a 50-90s hang, which is the tell (a healthy search answers in seconds; slowness is the failure mode here, not load). The working path: `.claude/skills/list-item/pull-sold-comps.js`, a DOM extractor run against a logged-in eBay sold-results tab (`s-card` selectors), emits the `listings[]` shape `/api/comps/analyze` already expects. Active listings via SerpAPI still work fine and fast.

- **SerpAPI's eBay engine needs `ebay_domain: 'ebay.com'` explicitly, or it returns the wrong market.** Without it, results come back as Chinese-language listings with inflated/future-dated prices. Set in `searchItem()` params (`server/comps.js`). If comp results ever look weird again, check this first.

- **A thin Sold results page gets padded with unrelated "related" sold items, and the extractor can't filter them.** eBay hydrates a short Sold page with related listings from adjacent categories; they carry a real "Sold" caption so they pass the extractor's gate. Tell: a pull far larger than the real pool with obviously off-part titles. Triage by title before pricing. Also: pasting two extractor pulls into one file makes two JSON arrays (`[...][...]`) — merge with `jq -s 'add'`.

- **Comps returning empty or 429 usually means the SerpAPI quota is gone — check the account before debugging code.** A 2026-07 episode of the eBay engine returning empty for every query was a compromised key burning the monthly quota. Per-source errors surface in the `/api/comps/search` response `errors` array, so a dead source is distinguishable from genuinely-zero comps.

- **Puppeteer runs in a child process, never inline in Express.** A Chromium crash in the main process would take the server down with it. `searchReverb()` (`server/comps.js`) spawns `scripts/reverb-scrape.js` via `child_process.spawn`. Chromium on Fedora also needs `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`.
