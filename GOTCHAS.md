# GOTCHAS — Duckwerks Dashboard

> Dated operational war-stories, sectioned by subsystem. Grep this mid-task; don't read it cover-to-cover. The pattern: *what bit us, why the weird workaround exists.* When something bites, add an entry here — not inline in CLAUDE.md.
>
> **Migration in progress:** CLAUDE.md still has an inline "Gotchas" section (eBay traffic metric, the Alpine modal pattern). Those belong here and should move on the next deep pass from dash's own seat. This file is seeded; finish consolidating then.

---

## Comp research (SerpAPI)

**SerpAPI's eBay engine needs `ebay_domain: 'ebay.com'` or it returns the wrong market.** Without the explicit domain param, the eBay engine defaults to a global/international search — comp results come back as Chinese-language listings with inflated/unverifiable prices and future-dated results. Fixed by adding `ebay_domain: 'ebay.com'` to `searchItem()` params in `server/comps.js` (commit `0c1a733`).

*How to apply:* if comp results ever look weird again (Chinese characters, inflated prices, future dates), check that `ebay_domain` is still set in the SerpAPI params.
