# Multi-Listing Per Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing 1:many items→listings schema in the UI — checkboxes in Add Item, a listings mini-table in the item modal with per-listing mark-sold, and contains-style site filtering in the items view.

**Architecture:** Pure frontend change. No schema migrations, no new API endpoints. All CRUD already exists. Five JS files and one HTML file touched; changes are surgical and follow existing Alpine patterns throughout.

**Tech Stack:** Alpine.js (no build step), Express/SQLite backend (no changes), vanilla CSS

---

## File Map

| File | What changes |
|---|---|
| `public/v2/css/components.css` | Add `badge-facebook`, `badge-craigslist`, `badge-multiple` classes |
| `public/v2/js/store.js` | `siteLabel()` returns 'Multiple' for >1 active listing; new `siteBadgeClass()` helper |
| `public/v2/js/views/items.js` | Site filter: contains logic instead of exact match on `siteLabel` |
| `public/v2/js/modals/add-modal.js` | `form.site` (string) → `form.sites` (array); save() loops to create N listings |
| `public/v2/js/modals/item-modal.js` | Add mark-sold state + methods; `startEdit()` populates per-listing form array; `save()` patches per-listing URL/ID |
| `public/v2/index.html` | Site badge ternaries → `siteBadgeClass()`; add modal site dropdown → checkboxes; item modal listing section → mini-table |

---

## Task 1: CSS — new site badge classes

**Files:**
- Modify: `public/v2/css/components.css`

- [ ] **Add three badge classes after the existing `badge-reverb` line (line 79)**

```css
.badge-facebook  { background: #1a2a1a; color: #4db86a; }
.badge-craigslist{ background: #1a1f2e; color: #7b9de0; }
.badge-multiple  { background: var(--border2); color: var(--muted); }
```

- [ ] **Verify visually** — open `http://localhost:3000/v2` and check any item with a Reverb or eBay listing still shows its badge correctly (no regressions from adding new classes).

- [ ] **Commit**

```bash
git add public/v2/css/components.css
git commit -m "ref #82: add badge-facebook, badge-craigslist, badge-multiple CSS classes"
```

---

## Task 2: Store helpers — `siteLabel()` + `siteBadgeClass()`

**Files:**
- Modify: `public/v2/js/store.js` (around line 147)

- [ ] **Update `siteLabel()` to return 'Multiple' when >1 active listing**

Find this in `store.js`:
```js
// Site label from best active listing
siteLabel(r) {
  return this.activeListing(r)?.site?.name || '';
},
```

Replace with:
```js
// Site label — 'Multiple' when item has more than one active listing
siteLabel(r) {
  const active = (r.listings || []).filter(l => l.status === 'active');
  if (active.length > 1) return 'Multiple';
  return active[0]?.site?.name || this.activeListing(r)?.site?.name || '';
},
```

- [ ] **Add `siteBadgeClass()` helper immediately after `siteLabel()`**

```js
// CSS badge class for a site name string
siteBadgeClass(name) {
  switch (name) {
    case 'eBay':        return 'badge-ebay';
    case 'Reverb':      return 'badge-reverb';
    case 'Facebook':    return 'badge-facebook';
    case 'Craigslist':  return 'badge-craigslist';
    case 'Multiple':    return 'badge-multiple';
    default:            return 'badge-other';
  }
},
```

- [ ] **Verify** — reload the app, check that items with a single Reverb or eBay listing still show the correct site label in the items view.

- [ ] **Commit**

```bash
git add public/v2/js/store.js
git commit -m "ref #82: siteLabel returns Multiple for >1 active listing; add siteBadgeClass helper"
```

---

## Task 3: Site badge rendering in index.html

Replace the four hardcoded ternary badge-class expressions that only know about eBay/Reverb. They are currently spread across the items view and item modal.

**Files:**
- Modify: `public/v2/index.html`

- [ ] **Replace items view site badge (two occurrences around lines 200 and 264)**

Find (appears twice, exact same string):
```html
<span :class="$store.dw.siteLabel(r) === 'eBay' ? 'badge badge-ebay' : 'badge badge-reverb'" x-text="$store.dw.siteLabel(r)"></span>
```

Replace both with:
```html
<span class="badge" :class="$store.dw.siteBadgeClass($store.dw.siteLabel(r))" x-text="$store.dw.siteLabel(r)"></span>
```

- [ ] **Replace items view expanded row site badge (around line 333)**

Find:
```html
<span class="badge" :class="$store.dw.siteLabel(r) === 'eBay' ? 'badge-ebay' : 'badge-reverb'" x-text="$store.dw.siteLabel(r)"></span>
```

Replace with:
```html
<span class="badge" :class="$store.dw.siteBadgeClass($store.dw.siteLabel(r))" x-text="$store.dw.siteLabel(r)"></span>
```

- [ ] **Verify** — items with eBay and Reverb listings still show correct colored badges.

- [ ] **Commit**

```bash
git add public/v2/index.html
git commit -m "ref #82: use siteBadgeClass helper for site badges in items view"
```

---

## Task 4: Items view — contains-style site filter

**Files:**
- Modify: `public/v2/js/views/items.js` (line 40–42)

- [ ] **Update the site filter block in the `rows` getter**

Find:
```js
if (this.siteFilter !== 'All') {
  recs = recs.filter(r => dw.siteLabel(r) === this.siteFilter);
}
```

Replace with:
```js
if (this.siteFilter !== 'All') {
  const sites = dw.sites || [];
  recs = recs.filter(r => {
    const targetSite = sites.find(s => s.name === this.siteFilter);
    if (!targetSite) return false;
    return (r.listings || []).some(l => l.status === 'active' && l.site_id === targetSite.id);
  });
}
```

- [ ] **Verify** — in the items view, filtering by eBay or Reverb still shows items correctly. An item with two active listings (if you create one to test) appears under both site filters.

- [ ] **Commit**

```bash
git add public/v2/js/views/items.js
git commit -m "ref #82: site filter uses contains logic — multi-listing items appear under each active site"
```

---

## Task 5: Add modal — site checkboxes

**Files:**
- Modify: `public/v2/js/modals/add-modal.js`
- Modify: `public/v2/index.html`

- [ ] **Update `add-modal.js`: change `form.site` to `form.sites` array**

Find the `form` object in the data definition:
```js
form: {
  name:      '',
  status:    'Prepping',
  category:  '',
  site:      '',
  lot:       '',
  newLot:    '',
  cost:      '',
  listPrice: '',
  shipping:  '',
  notes:     '',
},
```

Replace with:
```js
form: {
  name:      '',
  status:    'Prepping',
  category:  '',
  sites:     [],
  lot:       '',
  newLot:    '',
  cost:      '',
  listPrice: '',
  shipping:  '',
  notes:     '',
},
```

- [ ] **Update `reset()` to match**

Find:
```js
this.form = { name: '', status: 'Prepping', category: '', site: '', lot: '', newLot: '', cost: '', listPrice: '', shipping: '', notes: '' };
```

Replace with:
```js
this.form = { name: '', status: 'Prepping', category: '', sites: [], lot: '', newLot: '', cost: '', listPrice: '', shipping: '', notes: '' };
```

- [ ] **Update `save()`: replace single siteId block with multi-site loop**

Find this block in `save()`:
```js
// Resolve site_id for listing creation after item save
let siteId = null;
if (this.form.site) {
  const sites = await fetch('/api/sites').then(r => r.json());
  const site  = sites.find(s => s.name === this.form.site);
  if (site) siteId = site.id;
}
```

Replace with:
```js
// Resolve site_ids for all selected sites
const siteIds = [];
if (this.form.sites.length) {
  const allSites = await fetch('/api/sites').then(r => r.json());
  for (const siteName of this.form.sites) {
    const site = allSites.find(s => s.name === siteName);
    if (site) siteIds.push(site.id);
  }
}
```

- [ ] **Update the listing creation block in `save()` to loop over siteIds**

Find:
```js
const created = await dw.createItem(body);
if (siteId) {
  const listing = { item_id: created.id, site_id: siteId };
  if (this.form.listPrice !== '') listing.list_price        = parseFloat(this.form.listPrice);
  if (this.form.shipping  !== '') listing.shipping_estimate = parseFloat(this.form.shipping);
  await dw.createListing(listing);
  // createListing auto-sets status=Listed; restore user's choice if different
  if (this.form.status && this.form.status !== 'Listed') {
    await dw.updateItem(created.id, { status: this.form.status });
  }
} else if (this.form.status && this.form.status !== 'Prepping') {
  await dw.updateItem(created.id, { status: this.form.status });
}
```

Replace with:
```js
const created = await dw.createItem(body);
if (siteIds.length) {
  for (const siteId of siteIds) {
    const listing = { item_id: created.id, site_id: siteId };
    if (this.form.listPrice !== '') listing.list_price        = parseFloat(this.form.listPrice);
    if (this.form.shipping  !== '') listing.shipping_estimate = parseFloat(this.form.shipping);
    await dw.createListing(listing);
  }
  // createListing auto-sets status=Listed; restore user's choice if different
  if (this.form.status && this.form.status !== 'Listed') {
    await dw.updateItem(created.id, { status: this.form.status });
  }
} else if (this.form.status && this.form.status !== 'Prepping') {
  await dw.updateItem(created.id, { status: this.form.status });
}
```

- [ ] **Update the add modal HTML in `index.html`: replace site dropdown with checkboxes**

Find (around line 973):
```html
<div class="modal-row">
  <span class="modal-field">Site</span>
  <span class="modal-val">
    <select class="modal-select" x-model="form.site">
      <option value="">n/a</option>
      <template x-for="s in $store.dw.sites" :key="s.id">
        <option :value="s.name" x-text="s.name"></option>
      </template>
    </select>
  </span>
</div>
```

Replace with:
```html
<div class="modal-row">
  <span class="modal-field">Sites</span>
  <span class="modal-val" style="display:flex; flex-wrap:wrap; gap:10px">
    <template x-for="s in $store.dw.sites" :key="s.id">
      <label style="display:flex; align-items:center; gap:4px; cursor:pointer; font-size:12px">
        <input type="checkbox" :value="s.name" x-model="form.sites">
        <span x-text="s.name"></span>
      </label>
    </template>
  </span>
</div>
```

- [ ] **Verify** — open Add Item, check the Sites field shows four checkboxes (Reverb, eBay, Facebook, Craigslist). Select Facebook + Craigslist, add a test item, confirm two listings are created (visible in item modal).

- [ ] **Commit**

```bash
git add public/v2/js/modals/add-modal.js public/v2/index.html
git commit -m "ref #82: add modal — site checkboxes support multiple listings at creation"
```

---

## Task 6: Item modal JS — listings mini-table state and mark-sold

**Files:**
- Modify: `public/v2/js/modals/item-modal.js`

- [ ] **Add `markSoldId` and `markSoldPrice` to the data definition**

Find:
```js
editMode:        false,
saving:          false,
saveMsg:         '',
form:            {},
trackingInfo:    null,
trackingLoading: false,
```

Replace with:
```js
editMode:        false,
saving:          false,
saveMsg:         '',
form:            {},
trackingInfo:    null,
trackingLoading: false,
markSoldId:      null,
markSoldPrice:   '',
```

- [ ] **Reset mark-sold state when record changes in `init()`**

Find:
```js
this.$watch('$store.dw.activeRecordId', () => {
  this.editMode = false; this.saveMsg = ''; this.form = {};
  this.trackingInfo = null; this.trackingLoading = false;
  this._loadTracking();
});
```

Replace with:
```js
this.$watch('$store.dw.activeRecordId', () => {
  this.editMode = false; this.saveMsg = ''; this.form = {};
  this.trackingInfo = null; this.trackingLoading = false;
  this.markSoldId = null; this.markSoldPrice = '';
  this._loadTracking();
});
```

- [ ] **Update `startEdit()` to populate `form.listings` array and remove single-listing fields**

Replace the entire `startEdit()` method:
```js
startEdit() {
  const r = this.record;
  if (!r) return;
  const listing = Alpine.store('dw').activeListing(r);
  this.form = {
    name:      r.name,
    status:    r.status,
    category:  r.category?.name || '',
    lot:       r.lot?.name || '',
    listPrice: listing?.list_price ?? '',
    cost:      r.cost ?? '',
    sale:      r.order?.sale_price ?? '',
    shipping:  listing?.shipping_estimate ?? '',
    // per-listing editable fields
    listings: (r.listings || []).map(l => ({
      id:                  l.id,
      site:                l.site?.name || '',
      status:              l.status,
      url:                 l.url || '',
      platform_listing_id: l.platform_listing_id || '',
    })),
    // for items with no listings yet — create first listing
    newSite: '',
  };
  this.editMode = true; this.saveMsg = '';
},
```

- [ ] **Update `save()` to handle per-listing URL/ID patching**

Replace the entire listing section of `save()` — find from `// Resolve site_id if site set` through the `} else if (siteId) {` closing brace:

```js
// Resolve site_id if site set (only used when item has no listings yet)
let siteId = null;
if (f.newSite) {
  const sites = await fetch('/api/sites').then(r => r.json());
  const site  = sites.find(s => s.name === f.newSite);
  if (site) siteId = site.id;
}
```

Replace with:
```js
// Resolve site_id for new listing creation (only when item has no listings yet)
let siteId = null;
if (f.newSite) {
  const sites = await fetch('/api/sites').then(r => r.json());
  const site  = sites.find(s => s.name === f.newSite);
  if (site) siteId = site.id;
}
```

Then find the block that starts `if (f.listing_id) {` and ends with the closing `}` of `} else if (siteId) {`:

```js
if (f.listing_id) {
  // Update existing listing
  const listingFields = {};
  if (siteId)              listingFields.site_id              = siteId;
  if (f.url !== undefined) listingFields.url                  = f.url || null;
  if (f.reverbListingId !== undefined) listingFields.platform_listing_id = f.reverbListingId || null;
  if (f.listPrice !== '')  listingFields.list_price           = parseFloat(f.listPrice);
  if (f.shipping  !== '')  listingFields.shipping_estimate    = parseFloat(f.shipping);
  if (Object.keys(listingFields).length) await dw.updateListing(f.listing_id, listingFields);
} else if (siteId) {
  // No listing yet — create one
  const listing = { item_id: r.id, site_id: siteId };
  if (f.listPrice !== '') listing.list_price        = parseFloat(f.listPrice);
  if (f.shipping  !== '') listing.shipping_estimate = parseFloat(f.shipping);
  if (f.url)              listing.url               = f.url;
  if (f.reverbListingId)  listing.platform_listing_id = f.reverbListingId;
  await dw.createListing(listing);
  // createListing auto-sets Listed; restore status if user chose differently
  if (f.status && f.status !== 'Listed') await dw.updateItem(r.id, { status: f.status });
}
```

Replace with:
```js
// Update price/shipping on all active listings (shared fields)
const activeListings = (r.listings || []).filter(l => l.status === 'active');
for (const l of activeListings) {
  const listingFields = {};
  if (f.listPrice !== '') listingFields.list_price        = parseFloat(f.listPrice);
  if (f.shipping  !== '') listingFields.shipping_estimate = parseFloat(f.shipping);
  if (Object.keys(listingFields).length) {
    await dw.updateListing(l.id, listingFields, { skipRefresh: true });
  }
}

// Update per-listing URL/platform_listing_id
for (const lf of (f.listings || [])) {
  if (lf.id) {
    await dw.updateListing(lf.id, {
      url:                 lf.url || null,
      platform_listing_id: lf.platform_listing_id || null,
    }, { skipRefresh: true });
  }
}

// Create first listing if item had none
if (siteId && !r.listings?.length) {
  const listing = { item_id: r.id, site_id: siteId };
  if (f.listPrice !== '') listing.list_price        = parseFloat(f.listPrice);
  if (f.shipping  !== '') listing.shipping_estimate = parseFloat(f.shipping);
  await dw.createListing(listing);
  if (f.status && f.status !== 'Listed') await dw.updateItem(r.id, { status: f.status });
}

await dw.fetchAll();
```

- [ ] **Add mark-sold helper methods — add these before `badgeClass()`**

```js
listingStatusBadge(status) {
  if (status === 'active') return 'badge-listed';
  if (status === 'sold')   return 'badge-sold';
  return 'badge-other';
},

listingUrl(l) {
  if (l.platform_listing_id) {
    const site = l.site?.name;
    if (site === 'eBay')   return `https://www.ebay.com/itm/${l.platform_listing_id}`;
    if (site === 'Reverb') return `https://reverb.com/item/${l.platform_listing_id}`;
  }
  return l.url || null;
},

markSold(listingId) {
  this.markSoldId    = listingId;
  this.markSoldPrice = '';
},

cancelMarkSold() {
  this.markSoldId    = null;
  this.markSoldPrice = '';
},

async confirmMarkSold(listingId) {
  const dw = Alpine.store('dw');
  const r  = this.record;
  // End all OTHER active listings
  const others = (r.listings || []).filter(l => l.status === 'active' && l.id !== listingId);
  await Promise.all(others.map(l =>
    dw.updateListing(l.id, { status: 'ended', ended_at: new Date().toISOString() }, { skipRefresh: true })
  ));
  // Create order — auto-sets sold listing to 'sold' and item to 'Sold'
  await dw.createOrder({
    listing_id: listingId,
    sale_price: this.markSoldPrice ? parseFloat(this.markSoldPrice) : null,
    date_sold:  new Date().toISOString().split('T')[0],
  });
  this.markSoldId    = null;
  this.markSoldPrice = '';
},
```

- [ ] **Commit**

```bash
git add public/v2/js/modals/item-modal.js
git commit -m "ref #82: item modal — per-listing form array, mark-sold flow, listing helpers"
```

---

## Task 7: Item modal HTML — listings mini-table

**Files:**
- Modify: `public/v2/index.html`

This task replaces the "Site" row + listing ID row in read mode, and the "Site" select + "Listing URL" + "Platform Listing ID" rows in edit mode.

- [ ] **Replace the read-mode Site section (lines ~665–703)**

Find this block:
```html
          <div class="modal-row" x-show="$store.dw.siteLabel(record)">
            <span class="modal-field">Site</span>
            <span class="modal-val">
              <span class="badge" :class="$store.dw.siteLabel(record) === 'eBay' ? 'badge-ebay' : 'badge-reverb'" x-text="$store.dw.siteLabel(record)"
                    style="cursor:pointer" title="View all on this site"
                    @click="$store.dw.navToItems(null, null, $store.dw.siteLabel(record))"></span>
            </span>
          </div>
```

Replace with:
```html
          <div class="modal-row" x-show="record.listings?.length">
            <span class="modal-field">Listings</span>
            <div style="flex:1; margin-left:16px">
              <table style="width:100%; border-collapse:collapse">
                <template x-for="l in record.listings" :key="l.id">
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:4px 6px 4px 0">
                      <span class="badge" :class="$store.dw.siteBadgeClass(l.site?.name)" x-text="l.site?.name"></span>
                    </td>
                    <td style="padding:4px 6px">
                      <span class="badge" :class="listingStatusBadge(l.status)" x-text="l.status"></span>
                    </td>
                    <td style="padding:4px 6px; font-size:11px; color:var(--muted)">
                      <a x-show="listingUrl(l)" :href="listingUrl(l)" target="_blank" style="color:var(--muted)"
                         x-text="l.platform_listing_id ? '↗ #' + l.platform_listing_id : '↗ link'"></a>
                      <span x-show="!listingUrl(l) && !l.platform_listing_id">—</span>
                    </td>
                    <td style="padding:4px 0 4px 6px; text-align:right" x-show="l.status === 'active' && !isSold">
                      <template x-if="markSoldId !== l.id">
                        <button class="btn btn-muted" style="font-size:11px; padding:2px 8px"
                                @click="markSold(l.id)">Mark Sold</button>
                      </template>
                      <template x-if="markSoldId === l.id">
                        <div style="display:flex; gap:4px; align-items:center; justify-content:flex-end">
                          <input class="modal-input" type="number" step="0.01" x-model="markSoldPrice"
                                 style="width:80px; padding:2px 6px; font-size:11px" placeholder="Sale $">
                          <button class="btn btn-green" style="font-size:11px; padding:2px 8px"
                                  @click="confirmMarkSold(l.id)">Confirm</button>
                          <button class="btn btn-muted" style="font-size:11px; padding:2px 8px"
                                  @click="cancelMarkSold()">Cancel</button>
                        </div>
                      </template>
                    </td>
                  </tr>
                </template>
              </table>
            </div>
          </div>
```

- [ ] **Remove the old listing ID / order link row that immediately follows** (lines ~679–703):

Find and delete this entire block:
```html
          <div class="modal-row" x-show="$store.dw.activeListing(record)?.platform_listing_id || record.order?.platform_order_num">
            <span class="modal-field" x-text="$store.dw.siteLabel(record)"></span>
            <span class="modal-val" style="display:flex; gap:12px; flex-wrap:wrap; justify-content:flex-end">
              <a x-show="$store.dw.activeListing(record)?.platform_listing_id && $store.dw.listingUrl(record)" target="_blank"
                 :href="$store.dw.listingUrl(record)"
                 style="font-size:11px; color:var(--muted)"
                 x-text="'↗ Listing #' + $store.dw.activeListing(record)?.platform_listing_id"></a>
              <span x-show="$store.dw.activeListing(record)?.platform_listing_id && !$store.dw.listingUrl(record)"
                 style="font-size:11px; color:var(--muted)"
                 x-text="'Listing #' + $store.dw.activeListing(record)?.platform_listing_id"></span>
              <a x-show="record.order?.platform_order_num && $store.dw.siteLabel(record) === 'Reverb'" target="_blank"
                 :href="'https://reverb.com/my/selling/orders/' + record.order?.platform_order_num"
                 style="font-size:11px; color:var(--reverb)"
                 x-text="'↗ Order #' + record.order?.platform_order_num"></a>
              <a x-show="record.order?.platform_order_num && $store.dw.siteLabel(record) === 'Reverb'" target="_blank"
                 :href="'https://reverb.com/my/orders/' + record.order?.platform_order_num + '/packing_slip.pdf'"
                 style="font-size:11px; color:var(--muted)">↗ Packing Slip</a>
              <a x-show="record.order?.platform_order_num && $store.dw.siteLabel(record) === 'eBay'" target="_blank"
                 :href="'https://www.ebay.com/sh/ord/details?orderid=' + record.order?.platform_order_num"
                 style="font-size:11px; color:var(--ebay)">↗ Order Details</a>
              <a x-show="record.order?.platform_order_num && $store.dw.siteLabel(record) === 'eBay'" target="_blank"
                 :href="'https://www.ebay.com/sh/ord/prt?module=PACKING_SLIP_MODULE&orderId=' + record.order?.platform_order_num"
                 style="font-size:11px; color:var(--muted)">↗ Packing Slip</a>
            </span>
          </div>
```

**Note:** Order links (Reverb order, eBay order, packing slips) now move into the listings mini-table. For a sold listing row, add order link logic below. If you still want order/packing slip links, add them as a separate row below the listings table conditioned on `record.order?.platform_order_num`. For now, keep it simple: the order link can be found via the sold listing's URL. You can add order links back as a follow-up if needed.

- [ ] **Replace the edit-mode Site/URL/ListingID rows**

In the edit section, find and remove these three rows (around lines 859–892):
```html
          <div class="modal-row">
            <span class="modal-field">Site</span>
            <span class="modal-val">
              <select class="modal-select" x-model="form.site">
                <option value="">n/a</option>
                <template x-for="s in $store.dw.sites" :key="s.id">
                  <option :value="s.name" x-text="s.name"></option>
                </template>
              </select>
            </span>
          </div>
          <div class="modal-row">
            <span class="modal-field">Listing URL</span>
            <span class="modal-val" style="flex:1; margin-left:16px">
              <input class="modal-input" type="text" x-model="form.url">
            </span>
          </div>
          <div class="modal-row">
            <span class="modal-field" x-text="(form.site || 'Platform') + ' Listing ID'"></span>
            <span class="modal-val" style="flex:1; margin-left:16px">
              <input class="modal-input" type="text" x-model="form.reverbListingId">
            </span>
          </div>
```

Replace with:
```html
          <hr class="modal-divider">
          <div class="modal-section-label">Listings</div>
          <!-- Per-listing URL/ID editing -->
          <template x-for="(lf, idx) in form.listings" :key="lf.id || idx">
            <div style="padding:6px 0; border-bottom:1px solid var(--border)">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px">
                <span class="badge" :class="$store.dw.siteBadgeClass(lf.site)" x-text="lf.site"></span>
                <span class="badge badge-other" x-text="lf.status"></span>
              </div>
              <div class="modal-row">
                <span class="modal-field">URL</span>
                <span class="modal-val" style="flex:1; margin-left:16px">
                  <input class="modal-input" type="text" x-model="lf.url">
                </span>
              </div>
              <div class="modal-row">
                <span class="modal-field">Listing ID</span>
                <span class="modal-val" style="flex:1; margin-left:16px">
                  <input class="modal-input" type="text" x-model="lf.platform_listing_id">
                </span>
              </div>
            </div>
          </template>
          <!-- Add first listing (only shown when item has no listings) -->
          <div class="modal-row" x-show="form.listings?.length === 0">
            <span class="modal-field">Add Site</span>
            <span class="modal-val">
              <select class="modal-select" x-model="form.newSite">
                <option value="">— select —</option>
                <template x-for="s in $store.dw.sites" :key="s.id">
                  <option :value="s.name" x-text="s.name"></option>
                </template>
              </select>
            </span>
          </div>
```

- [ ] **Verify end-to-end**
  1. Open an existing eBay or Reverb item — listings mini-table shows one row with correct site badge, status, and URL/listing link
  2. Open edit mode — per-listing URL/ID fields are editable; shared price/shipping unchanged
  3. Create a new item with FB + CL checked — item modal shows two active listing rows
  4. Mark one listing as Sold on the two-listing item — other listing becomes 'ended', item status → Sold
  5. Items view "MULTIPLE" badge appears for the two-listing item before it sells

- [ ] **Commit**

```bash
git add public/v2/index.html
git commit -m "ref #82: item modal listings mini-table with per-listing mark-sold flow"
```

---

## Task 8: Version bump + GitHub issue + final commit

- [ ] **Bump version in `public/v2/js/config.js`** — increment patch (e.g. `1.0.8` → `1.0.9`)

- [ ] **Bump version in `package.json`** to match

- [ ] **Create GitHub issue** for this feature so we have a ticket number to reference:

```bash
gh issue create \
  --repo ringleader3/duckwerksdash \
  --title "Multi-listing per item — FB/CL support" \
  --label "enhancement,P1" \
  --body "Support multiple active listings per item (e.g. Facebook + Craigslist). Checkboxes in Add Item modal, listings mini-table in item modal with per-row Mark Sold, contains-style site filter in items view. Schema already supports 1:many. Spec: docs/superpowers/specs/2026-03-30-multi-listing-design.md"
```

- [ ] **Update session log** in `docs/session-log.md`

- [ ] **Final commit**

```bash
git add public/v2/js/config.js package.json docs/session-log.md
git commit -m "ref #82: v1.0.9 — multi-listing per item (FB/CL support)"
```

- [ ] **Push**

```bash
git push origin main
```
