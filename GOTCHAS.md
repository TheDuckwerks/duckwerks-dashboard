# GOTCHAS — Duckwerks Dashboard

> Dated operational war-stories, sectioned by subsystem. Grep this mid-task; don't read it cover-to-cover. The pattern: *what bit us, why the weird workaround exists.* When something bites, add an entry here — not inline in CLAUDE.md.

---

## Database (SQLite)

**`node -e` with better-sqlite3 hangs the process.** better-sqlite3 never closes the db handle on its own, so a `node -e "..."` inline script opens the database and then never exits — the process hangs and has to be killed. Use `scripts/db.sh "<sql>"` instead: it shells out to the `sqlite3` CLI (which exits cleanly) against the NUC database (the source of truth). `--local` hits the stale local copy. Writes still follow the confirm protocol in CLAUDE.md — the wrapper is the *how*, not a bypass.

**The local `data/duckwerks.db` is stale and useless.** The NUC copy at `/home/geoff/projects/duckwerksdash/data/duckwerks.db` is the source of truth. `scripts/db.sh` targets it by default for exactly this reason; never reason from the local file.

---

## eBay

**Traffic API — use `TOTAL_IMPRESSION_TOTAL`, not `LISTING_IMPRESSION_TOTAL`.** `TOTAL_IMPRESSION_TOTAL` includes promoted-listing impressions; `LISTING_IMPRESSION_TOTAL` is organic only. The Seller Hub UI shows the total, so the organic-only metric will silently undercount and not match what Geoff sees. Used in `public/v2/js/views/analytics.js`.

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

## Comp research (SerpAPI)

**SerpAPI's eBay engine needs `ebay_domain: 'ebay.com'` or it returns the wrong market.** Without the explicit domain param, the eBay engine defaults to a global/international search — comp results come back as Chinese-language listings with inflated/unverifiable prices and future-dated results. Fixed by adding `ebay_domain: 'ebay.com'` to `searchItem()` params in `server/comps.js` (commit `0c1a733`).

*How to apply:* if comp results ever look weird again (Chinese characters, inflated prices, future dates), check that `ebay_domain` is still set in the SerpAPI params.
