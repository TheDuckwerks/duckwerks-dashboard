# GOTCHAS — Duckwerks Dashboard

> Dated operational war-stories, sectioned by subsystem. Grep this mid-task; don't read it cover-to-cover. The pattern: *what bit us, why the weird workaround exists.* When something bites, add an entry here — not inline in CLAUDE.md.

---

## Database (SQLite)

**`node -e` with better-sqlite3 hangs the process.** better-sqlite3 never closes the db handle on its own, so a `node -e "..."` inline script opens the database and then never exits — the process hangs and has to be killed. Use `scripts/db.sh "<sql>"` instead: it shells out to the `sqlite3` CLI (which exits cleanly) against the NUC database (the source of truth). `--local` hits the stale local copy. Writes still follow the confirm protocol in CLAUDE.md — the wrapper is the *how*, not a bypass.

**The local `data/duckwerks.db` is stale and useless.** The NUC copy at `/srv/duckwerks/dash/data/duckwerks.db` (symlinked as `data/` into each release) is the source of truth. `scripts/db.sh` targets it by default for exactly this reason; never reason from the local file.

---

## eBay

**Traffic API — use `TOTAL_IMPRESSION_TOTAL`, not `LISTING_IMPRESSION_TOTAL`.** `TOTAL_IMPRESSION_TOTAL` includes promoted-listing impressions; `LISTING_IMPRESSION_TOTAL` is organic only. The Seller Hub UI shows the total, so the organic-only metric will silently undercount and not match what Geoff sees. Used in `public/v2/js/views/analytics.js`.

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

**SerpAPI's eBay engine needs `ebay_domain: 'ebay.com'` or it returns the wrong market.** Without the explicit domain param, the eBay engine defaults to a global/international search — comp results come back as Chinese-language listings with inflated/unverifiable prices and future-dated results. Fixed by adding `ebay_domain: 'ebay.com'` to `searchItem()` params in `server/comps.js` (commit `0c1a733`).

*How to apply:* if comp results ever look weird again (Chinese characters, inflated prices, future dates), check that `ebay_domain` is still set in the SerpAPI params.
