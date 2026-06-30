# Reverb Sync Details Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Listing Details" section to the Reverb Sync modal that shows name/price diffs between Reverb and Airtable, and lets the user apply them with one button click.

**Architecture:** Fix pagination in the existing listings fetch so all listings are retrieved on modal open. Extend `_process()` to compute `detailDiffs` from the already-fetched `listings` array. Add a `syncDetails()` method mirroring `saveMatches()`. Add the UI section to the modal template in `index.html`.

**Tech Stack:** Alpine.js (no build step), Express proxy at `/api/reverb/*`, Airtable via `$store.dw.updateRecord()`

---

## File Map

| File | Change |
|---|---|
| `public/v2/js/modals/reverb-modal.js` | Add state vars; fix pagination in `run()`; extend `_process()` for diffs; add `syncDetails()` |
| `public/v2/index.html` | Add "Listing Details" section to reverb modal template (lines ~1066–1106) |

---

## Task 1: Add new state vars and fix pagination in `run()`

**Files:**
- Modify: `public/v2/js/modals/reverb-modal.js`

The current listings fetch retrieves one page only. The Reverb API returns `_links.next.href` (a full `https://api.reverb.com/api/...` URL) when more pages exist. The proxy at `/api/reverb/*` maps to `https://api.reverb.com/api/*`, so we strip the base URL and prepend `/api/reverb/` to follow the link.

- [ ] **Step 1: Add new state properties to the object literal**

In `reverb-modal.js`, add these three properties to the state object at the top (alongside `loading`, `errMsg`, etc.):

```js
detailDiffs:   [],
detailsMsg:    '',
syncingDetails: false,
```

- [ ] **Step 2: Reset new state vars in `run()`**

In the `run()` method, alongside the existing resets (`this.orders = []`, `this.matched = []`, etc.), add:

```js
this.detailDiffs    = [];
this.detailsMsg     = '';
this.syncingDetails = false;
```

- [ ] **Step 3: Replace the listings fetch with a paginated loop**

Replace this block inside `run()`:

```js
const [ordersRes, listingsRes] = await Promise.all([
  fetch('/api/reverb/my/orders/selling/awaiting_shipment'),
  fetch('/api/reverb/my/listings'),
]);
if (!ordersRes.ok)   throw new Error(`Orders HTTP ${ordersRes.status}`);
if (!listingsRes.ok) throw new Error(`Listings HTTP ${listingsRes.status}`);
const [ordersData, listingsData] = await Promise.all([
  ordersRes.json(),
  listingsRes.json(),
]);
this.orders   = ordersData.orders   || [];
this.listings = listingsData.listings || [];
```

With this (orders fetch stays as-is; listings becomes a loop):

```js
const ordersRes = await fetch('/api/reverb/my/orders/selling/awaiting_shipment');
if (!ordersRes.ok) throw new Error(`Orders HTTP ${ordersRes.status}`);
const ordersData = await ordersRes.json();
this.orders = ordersData.orders || [];

// Paginated listings fetch
let allListings = [];
let nextUrl = '/api/reverb/my/listings';
while (nextUrl) {
  const res = await fetch(nextUrl);
  if (!res.ok) throw new Error(`Listings HTTP ${res.status}`);
  const data = await res.json();
  allListings = allListings.concat(data.listings || []);
  const nextHref = data._links?.next?.href;
  nextUrl = nextHref
    ? '/api/reverb/' + nextHref.replace('https://api.reverb.com/api/', '')
    : null;
}
this.listings = allListings;
```

- [ ] **Step 4: Verify the modal still opens and loads without errors**

Start the server (`npm start`), open the dashboard, click "Sync Reverb". Confirm:
- Modal opens and spinner shows
- Orders and listings load without console errors
- Existing "Awaiting Shipment" and "Link Listings" sections render correctly

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/modals/reverb-modal.js
git commit -m "feat: fix reverb listings pagination in sync modal ref #14"
```

---

## Task 2: Add diff computation to `_process()`

**Files:**
- Modify: `public/v2/js/modals/reverb-modal.js`

- [ ] **Step 1: Add detailDiffs computation at the end of `_process()`**

After the existing block that sets `this.unlinkedRecs` and `this.linkSelections`, add:

```js
// Compute listing detail diffs (name + price) for linked records
// dw is already declared at the top of _process() — do not add another const dw line
this.detailDiffs = dw.records
  .filter(r => dw.str(r, F.reverbListingId))
  .reduce((acc, r) => {
    const listing = this.listings.find(
      l => String(l.id) === dw.str(r, F.reverbListingId)
    );
    if (!listing) return acc;
    const newName  = listing.title || '';
    const newPrice = parseFloat(listing.price.amount);
    const oldName  = dw.str(r, F.name);
    const oldPrice = parseFloat(r.fields[F.listPrice]) || 0;
    if (newName !== oldName || newPrice !== oldPrice) {
      acc.push({ rec: r, listing, newName, newPrice, oldName, oldPrice });
    }
    return acc;
  }, []);
```

**Important:** `dw` is declared as `const` at the top of `_process()` (line 67 of `reverb-modal.js`). The code block above intentionally omits a `const dw` line — do not add one. Re-declaring it with `const` will throw `Identifier 'dw' has already been declared` and crash the modal.

- [ ] **Step 2: Verify diffs compute correctly**

With the server running, open Sync Reverb. Open the browser console and run:

```js
Alpine.store('dw') // confirm store is present
document.querySelector('[x-data="reverbModal"]').__x.$data.detailDiffs
```

Should return an array. If you have any Reverb-linked records whose Airtable name or price differs from their Reverb listing, they appear here.

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/modals/reverb-modal.js
git commit -m "feat: compute reverb listing detail diffs in sync modal ref #14"
```

---

## Task 3: Add `syncDetails()` method

**Files:**
- Modify: `public/v2/js/modals/reverb-modal.js`

- [ ] **Step 1: Add `syncDetails()` after `saveLinks()`**

At the end of the Alpine data object, after `saveLinks()` and before the closing `}));`, add:

```js
async syncDetails() {
  if (!this.detailDiffs.length) return;
  this.syncingDetails = true;
  this.detailsMsg     = '';
  let saved = 0, errors = 0;
  const dw = Alpine.store('dw');
  for (const { rec, newName, newPrice } of this.detailDiffs) {
    try {
      await dw.updateRecord(rec.id, {
        [F.name]:      newName,
        [F.listPrice]: newPrice,
      });
      saved++;
    } catch(e) {
      console.error('syncDetails:', e);
      errors++;
    }
  }
  this.detailsMsg     = errors ? `${saved} synced, ${errors} failed` : `✓ ${saved} synced`;
  this.syncingDetails = false;
  setTimeout(async () => { await dw.fetchAll(); this._process(); }, 800);
},
```

- [ ] **Step 2: Verify no JS errors on page load**

Reload the dashboard. Open the console. No errors should appear on load.

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/modals/reverb-modal.js
git commit -m "feat: add syncDetails method to reverb sync modal ref #14"
```

---

## Task 4: Add "Listing Details" UI section to `index.html`

**Files:**
- Modify: `public/v2/index.html` (lines ~1095–1106 — after the Link Listings button row, before the closing `</div>` of the results block)

The new section follows the same visual pattern as the existing sections. It shows a diff table when changes exist, and a "✓ All listing details match" message when there are none.

- [ ] **Step 1: Insert the new section**

In `index.html`, the results block (`x-show="!loading && !errMsg"`) closes at line ~1106. The new section must be inserted **as the last child inside that div** — i.e., after the Link Listings `</div>` at line ~1104 but before the results block's own closing `</div>` at line ~1106. Use this exact anchor for the edit — replace the two-line gap between the Link Listings close and the results block close:

```html
          </div>

        </div>
```

With the new section followed by the results close:

```html
          </div>

          <!-- SECTION: Listing Details -->
          ...new section HTML...

        </div>
```

Full replacement — insert the new section just before the `</div>` that closes `x-show="!loading && !errMsg"`:

```html
          <!-- SECTION: Listing Details -->
          <div class="modal-section-label" style="margin-top:20px">LISTING DETAILS</div>

          <div x-show="!detailDiffs.length" style="padding:10px 0;font-size:12px;color:var(--muted)">
            ✓ All listing details match.
          </div>

          <div x-show="detailDiffs.length > 0">
            <div style="font-size:11px;color:#666;padding:4px 0 10px;letter-spacing:1px">
              Reverb changes pending. Review and sync to Airtable.
            </div>
            <template x-for="diff in detailDiffs" :key="diff.rec.id">
              <div style="padding:10px 0;border-bottom:1px solid var(--border2)">
                <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:4px;flex-wrap:wrap">
                  <span style="font-size:11px;color:var(--muted)" x-text="diff.oldName"></span>
                  <span x-show="diff.newName !== diff.oldName"
                    style="font-size:11px;color:#555">→</span>
                  <span x-show="diff.newName !== diff.oldName"
                    style="font-size:12px;color:var(--white)" x-text="diff.newName"></span>
                </div>
                <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
                  <span x-show="diff.newPrice !== diff.oldPrice"
                    style="font-size:11px;color:var(--muted)"
                    x-text="'$' + (diff.oldPrice || 0).toFixed(2)"></span>
                  <span x-show="diff.newPrice !== diff.oldPrice"
                    style="font-size:11px;color:#555">→</span>
                  <span x-show="diff.newPrice !== diff.oldPrice"
                    style="font-size:12px;color:var(--green)"
                    x-text="'$' + (diff.newPrice || 0).toFixed(2)"></span>
                </div>
              </div>
            </template>
            <div style="padding:14px 0 4px;display:flex;gap:12px;align-items:center">
              <button @click="syncDetails()" :disabled="syncingDetails"
                style="padding:10px 28px;background:var(--reverb);color:#fff;border:none;font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:3px;cursor:pointer"
                x-text="syncingDetails ? 'SYNCING...' : 'SYNC ' + detailDiffs.length + ' DETAIL' + (detailDiffs.length > 1 ? 'S' : '')">
              </button>
              <span x-show="detailsMsg" x-text="detailsMsg"
                :style="detailsMsg.startsWith('✓') ? 'color:var(--green)' : 'color:var(--red)'"
                style="font-size:11px;letter-spacing:1px"></span>
            </div>
          </div>
```

- [ ] **Step 2: Verify the section renders correctly**

Open Sync Reverb modal. Confirm:
- "LISTING DETAILS" section header appears below "LINK LISTINGS"
- If no diffs: "✓ All listing details match." shows in muted text
- If diffs exist: table shows old → new name and/or old → new price per item
- "SYNC N DETAIL(S)" button appears and is clickable
- Clicking the button saves changes to Airtable, shows "✓ N synced", and the diff list clears after ~800ms

- [ ] **Step 3: Commit**

```bash
git add public/v2/index.html
git commit -m "feat: add listing details section to reverb sync modal ref #14"
```
