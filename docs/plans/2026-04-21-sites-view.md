# Sites View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two per-platform sync modals with a unified SITES view — a first-class nav view for order fulfillment, listing import, and detail sync across eBay and Reverb.

**Architecture:** New `sitesView` Alpine component in `public/v2/js/views/sites.js` handles all three sections (Orders, Listings, Details). Store gains a ticker `checkOrders()` method and `orderCount` state. Both sync modals are deleted. The `previousModal` system in `store.js` is extended to handle navigating back to a view (not just a modal) when SHIP is invoked from SITES.

**Tech Stack:** Alpine.js, vanilla JS, existing `/api/reverb/*` and `/api/ebay/*` Express proxy routes — no new server routes needed.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `public/v2/js/views/sites.js` | `sitesView` Alpine component — all three sections |
| Modify | `public/v2/js/store.js` | Add `orderCount`, `checkingOrders`, `checkOrders()`; extend `closeModal()` for `previousView` |
| Modify | `public/v2/index.html` | Add SITES nav pill; ticker ORDERS button; sites view container + template; remove modal HTML + script tags |
| Delete | `public/v2/js/modals/reverb-modal.js` | Retired |
| Delete | `public/v2/js/modals/ebay-modal.js` | Retired |

---

## Task 1: Extend store for ticker button and previousView back-nav

**Files:**
- Modify: `public/v2/js/store.js`

The ticker ORDERS button needs `orderCount` (null = unchecked, 0 = empty, N = results) and `checkingOrders` state. The `closeModal()` method needs to handle returning to a view (not just a modal) after the label modal closes from SITES — add a `previousView` field alongside `previousModal`.

- [ ] **Read `public/v2/js/store.js` lines 1–50** to confirm current state fields, then add the three new state fields after `previousModal: null`:

```js
    previousModal:    null,
    previousView:     null,   // add this line
    orderCount:       null,
    checkingOrders:   false,
```

- [ ] **Add `checkOrders()` method** to the store after the `closeModal()` method (around line 117). Insert:

```js
    async checkOrders() {
      if (this.checkingOrders) return;
      this.checkingOrders = true;
      try {
        const [ebayRes, reverbRes] = await Promise.all([
          fetch('/api/ebay/orders'),
          fetch('/api/reverb/my/orders/selling/awaiting_shipment'),
        ]);
        const ebayData   = ebayRes.ok   ? await ebayRes.json()   : { orders: [] };
        const reverbData = reverbRes.ok ? await reverbRes.json() : { orders: [] };
        const ebayCount   = (ebayData.orders   || []).filter(o => {
          const items = o.lineItems || [];
          return items.length > 0;
        }).length;
        const reverbCount = (reverbData.orders || []).length;
        this.orderCount = ebayCount + reverbCount;
        if (this.orderCount === 0) {
          setTimeout(() => { if (this.orderCount === 0) this.orderCount = null; }, 2000);
        }
      } catch(e) {
        this.orderCount = null;
      } finally {
        this.checkingOrders = false;
      }
    },
```

- [ ] **Extend `closeModal()`** to handle `previousView`. Replace the existing `closeModal()` method:

```js
    closeModal() {
      if (this.previousView) {
        const view = this.previousView;
        this.previousView   = null;
        this.activeModal    = null;
        this.activeRecordId = null;
        this.activeView     = view;
        return;
      }
      if (this.previousModal) {
        const prev = this.previousModal;
        this.previousModal  = null;
        this.activeModal    = prev.type;
        this.activeRecordId = prev.recordId;
        this.activeLotName  = prev.lotName;
        return;
      }
      this.activeModal    = null;
      this.activeRecordId = null;
      this.activeLotName  = null;
    },
```

- [ ] **Verify the app still loads** — open http://localhost:3000, check no console errors, existing modals still open/close correctly.

- [ ] **Commit:**

```bash
git add public/v2/js/store.js
git commit -m "feat: add orderCount + checkOrders + previousView to store ref #115"
```

---

## Task 2: Add SITES nav entry and ticker ORDERS button to index.html

**Files:**
- Modify: `public/v2/index.html`

- [ ] **Add SITES nav pill** in the rail nav after the last existing nav button (Catalog, around line 97). Add:

```html
    <button class="rail-link" :class="{ active: $store.dw.activeView === 'sites' }"
      @click="$store.dw.activeView = 'sites'; $store.dw.orderCount = null">
      <span class="gl">⟳</span>Sites
    </button>
```

- [ ] **Add the ORDERS ticker button** in the `.tape-sys` div (around line 64), before the closing `</div>`:

```html
    <button x-data
      @click="$store.dw.orderCount !== null ? ($store.dw.activeView = 'sites', $store.dw.orderCount = null) : $store.dw.checkOrders()"
      :disabled="$store.dw.checkingOrders"
      style="background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);font:700 9px/1 var(--mono);letter-spacing:.12em;padding:3px 7px;cursor:pointer;margin-left:8px"
      x-text="$store.dw.checkingOrders ? '...' : $store.dw.orderCount > 0 ? $store.dw.orderCount + ' ORDERS' : 'ORDERS'">
    </button>
```

- [ ] **Add the sites view container** in the main content area after the last existing view container (catalog view, around line 879). Add:

```html
      <!-- Sites -->
      <div x-show="$store.dw.activeView === 'sites'" x-data="sitesView">
        <div class="hero-band slim">
          <div class="breadcrumb">DW / <span>SITES</span></div>
          <div class="hero-title">Sites</div>
        </div>
        <div class="view-body">
          <!-- content rendered by sitesView template below -->
          <div x-ref="sitesContent"></div>
        </div>
      </div>
```

Note: The actual section HTML will be added in Task 3 once `sitesView` is defined. For now this is the shell.

- [ ] **Verify nav renders** — open http://localhost:3000, confirm SITES pill appears in the rail, clicking it switches the view (blank for now), ORDERS button appears in the ticker bar.

- [ ] **Commit:**

```bash
git add public/v2/index.html
git commit -m "feat: add SITES nav entry and ORDERS ticker button ref #115"
```

---

## Task 3: Build sitesView — Orders section

**Files:**
- Create: `public/v2/js/views/sites.js`

This task builds the orders section only. The file will be extended in Tasks 4 and 5.

- [ ] **Create `public/v2/js/views/sites.js`** with the full Alpine component skeleton and orders logic:

```js
// ── Sites View ────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('sitesView', () => ({

    // ── Orders ────────────────────────────────────────────────────────────────
    ordersLoading:   false,
    ebayOrders:      [],
    reverbOrders:    [],
    ebayOrdersErr:   '',
    reverbOrdersErr: '',

    // ── Listings ──────────────────────────────────────────────────────────────
    listingsLoading:   false,
    listingsErr:       '',
    unlinkedListings:  [],   // [{ platform, id, title, price, listingIdKey }]
    linkSelections:    {},   // id → local record id (for manual override)
    importCategory:    '',
    importLot:         '',
    importNewLot:      '',
    importMsg:         '',
    importingNew:      false,
    linksMsg:          '',
    savingLinks:       false,

    // ── Details ───────────────────────────────────────────────────────────────
    detailsLoading:  false,
    detailsErr:      '',
    detailDiffs:     [],   // [{ rec, listing, platform, newName, newPrice, oldName, oldPrice }]
    detailsMsg:      '',
    syncingDetails:  false,

    init() {
      this.$watch('$store.dw.activeView', val => {
        if (val === 'sites') this.fetchOrders();
      });
    },

    // ── Orders ────────────────────────────────────────────────────────────────

    async fetchOrders() {
      this.ordersLoading   = true;
      this.ebayOrders      = [];
      this.reverbOrders    = [];
      this.ebayOrdersErr   = '';
      this.reverbOrdersErr = '';
      const [ebay, reverb] = await Promise.allSettled([
        this._fetchEbayOrders(),
        this._fetchReverbOrders(),
      ]);
      if (ebay.status   === 'rejected') this.ebayOrdersErr   = ebay.reason?.message   || 'eBay fetch failed';
      if (reverb.status === 'rejected') this.reverbOrdersErr = reverb.reason?.message || 'Reverb fetch failed';
      this.ordersLoading = false;
    },

    async _fetchEbayOrders() {
      const res  = await fetch('/api/ebay/orders');
      if (!res.ok) throw new Error(`eBay orders HTTP ${res.status}`);
      const data = await res.json();
      const dw   = Alpine.store('dw');
      const all  = data.orders || [];
      // exclude fully-shipped orders
      this.ebayOrders = all
        .map(order => {
          const items = (order.lineItems || []).map(lineItem => {
            const legacyId = lineItem.legacyItemId ? String(lineItem.legacyItemId) : null;
            const rec = legacyId
              ? dw.records.find(r => (r.listings || []).some(l => l.site?.name === 'eBay' && l.platform_listing_id === legacyId))
              : null;
            return { lineItem, rec };
          });
          return { order, items };
        })
        .filter(({ items }) => {
          const matched   = items.filter(i => i.rec);
          const allShipped = matched.every(i => i.rec.shipment?.tracking_number);
          return matched.length > 0 && !allShipped;
        });
    },

    async _fetchReverbOrders() {
      const res  = await fetch('/api/reverb/my/orders/selling/awaiting_shipment');
      if (!res.ok) throw new Error(`Reverb orders HTTP ${res.status}`);
      const data = await res.json();
      const dw   = Alpine.store('dw');
      this.reverbOrders = (data.orders || []).map(order => {
        const listingId = String(order.product_id);
        const rec = dw.records.find(r =>
          (r.listings || []).some(l =>
            l.site?.name === 'Reverb' && l.status === 'active' && l.platform_listing_id === listingId
          )
        );
        return { order, rec };
      });
    },

    openEbayShip(orderEntry) {
      const dw = Alpine.store('dw');
      dw.activeEbayOrderId     = orderEntry.order.orderId;
      dw.activeEbayLineItemIds = orderEntry.items.map(i => i.lineItem.lineItemId);
      dw.activeEbayOrderRecs   = orderEntry.items.filter(i => i.rec).map(i => i.rec);
      dw.previousView          = 'sites';
      const primaryRec = dw.activeEbayOrderRecs[0];
      if (primaryRec) dw.openModal('label', primaryRec.id);
    },

    openReverbShip(orderEntry) {
      const dw = Alpine.store('dw');
      dw.activeReverbOrderNum = String(orderEntry.order.order_number);
      dw.previousView         = 'sites';
      if (orderEntry.rec) dw.openModal('label', orderEntry.rec.id);
    },

    ebayBuyerName(order) {
      return order.buyer?.buyerRegistrationAddress?.fullName || order.orderId;
    },

    ebayLineItemTitle(order) {
      return order.lineItems?.[0]?.title || 'n/a';
    },

  }));
});
```

- [ ] **Wire the script tag** in `index.html` — add before the closing `</body>` script block, after the existing views:

```html
<script src="js/views/sites.js"></script>
```

Find the block near line 2380 that loads view scripts and add it alongside them.

- [ ] **Add the orders section HTML** inside the sites view container added in Task 2. Replace the `<div x-ref="sitesContent"></div>` placeholder with:

```html
          <!-- ORDERS -->
          <div style="margin-bottom:40px">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
              <div class="modal-section-label" style="margin-bottom:0">Orders</div>
              <button @click="fetchOrders()" :disabled="ordersLoading"
                style="padding:4px 12px;background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);font:700 9px/1 var(--mono);letter-spacing:.12em;cursor:pointer"
                x-text="ordersLoading ? 'CHECKING...' : 'CHECK FOR NEW ORDERS'">
              </button>
            </div>

            <div x-show="ordersLoading" style="padding:20px 0;color:var(--muted);font-size:11px;letter-spacing:2px">FETCHING ORDERS...</div>

            <template x-if="!ordersLoading">
              <div>
                <!-- eBay block -->
                <div style="margin-bottom:24px">
                  <div style="font:700 10px/1 var(--mono);letter-spacing:.15em;color:var(--ebay);margin-bottom:10px">EBAY</div>
                  <div x-show="ebayOrdersErr" x-text="ebayOrdersErr" style="color:var(--red);font-size:11px;letter-spacing:1px;margin-bottom:8px"></div>
                  <div x-show="!ebayOrdersErr && ebayOrders.length === 0" style="color:var(--muted);font-size:11px;letter-spacing:1px">nothing to ship on eBay</div>
                  <template x-for="entry in ebayOrders" :key="entry.order.orderId">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)">
                      <div>
                        <div style="font-size:12px;font-weight:700;letter-spacing:.05em" x-text="ebayBuyerName(entry.order)"></div>
                        <template x-for="item in entry.items" :key="item.lineItem.lineItemId">
                          <div style="font-size:11px;color:var(--ink-2);margin-top:2px">
                            <span x-text="item.lineItem.title"></span>
                            <template x-if="item.rec?.sku">
                              <span style="color:var(--muted);margin-left:6px" x-text="'· ' + item.rec.sku"></span>
                            </template>
                          </div>
                        </template>
                        <div style="font-size:10px;color:var(--muted);margin-top:3px;letter-spacing:.05em" x-text="'Order ' + entry.order.orderId"></div>
                      </div>
                      <button @click="openEbayShip(entry)"
                        style="padding:5px 14px;background:var(--blue);color:#fff;border:none;font:700 10px/1 var(--mono);letter-spacing:.12em;cursor:pointer;flex-shrink:0;margin-left:16px">
                        SHIP
                      </button>
                    </div>
                  </template>
                </div>

                <!-- Reverb block -->
                <div>
                  <div style="font:700 10px/1 var(--mono);letter-spacing:.15em;color:var(--reverb);margin-bottom:10px">REVERB</div>
                  <div x-show="reverbOrdersErr" x-text="reverbOrdersErr" style="color:var(--red);font-size:11px;letter-spacing:1px;margin-bottom:8px"></div>
                  <div x-show="!reverbOrdersErr && reverbOrders.length === 0" style="color:var(--muted);font-size:11px;letter-spacing:1px">nothing to ship on Reverb</div>
                  <template x-for="entry in reverbOrders" :key="entry.order.order_number">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)">
                      <div>
                        <div style="font-size:12px;font-weight:700;letter-spacing:.05em" x-text="entry.order.buyer_name || entry.order.order_number"></div>
                        <div style="font-size:11px;color:var(--ink-2);margin-top:2px" x-text="entry.order.title || entry.order.description"></div>
                        <template x-if="entry.rec?.sku">
                          <div style="font-size:10px;color:var(--muted);margin-top:2px" x-text="entry.rec.sku"></div>
                        </template>
                        <div style="font-size:10px;color:var(--muted);margin-top:3px;letter-spacing:.05em" x-text="'Order #' + entry.order.order_number"></div>
                      </div>
                      <button @click="openReverbShip(entry)"
                        style="padding:5px 14px;background:var(--blue);color:#fff;border:none;font:700 10px/1 var(--mono);letter-spacing:.12em;cursor:pointer;flex-shrink:0;margin-left:16px">
                        SHIP
                      </button>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
```

- [ ] **Test orders section** — open http://localhost:3000, navigate to SITES, verify both platform blocks load, error states are independent (you can verify by temporarily breaking one fetch URL), SHIP button opens the label modal, closing the label modal returns to SITES view (not a dead modal).

- [ ] **Commit:**

```bash
git add public/v2/js/views/sites.js public/v2/index.html
git commit -m "feat: sites view orders section — eBay + Reverb with independent error handling ref #115"
```

---

## Task 4: Build sitesView — Listings section

**Files:**
- Modify: `public/v2/js/views/sites.js`
- Modify: `public/v2/index.html`

- [ ] **Add listings methods** to `sitesView` in `sites.js`, after the `openReverbShip` method and before the closing `}));`:

```js
    // ── Listings ────────────────────────────────────────────────────────────

    async fetchListings() {
      this.listingsLoading  = true;
      this.listingsErr      = '';
      this.unlinkedListings = [];
      this.linkSelections   = {};
      try {
        const dw = Alpine.store('dw');
        const linkedIds = new Set(
          dw.records.flatMap(r => r.listings || [])
            .map(l => l.platform_listing_id)
            .filter(Boolean)
        );

        const [ebayRes, reverbRes] = await Promise.all([
          fetch('/api/ebay/listings'),
          this._fetchAllReverbListings(),
        ]);

        const ebayData = ebayRes.ok ? await ebayRes.json() : { listings: [] };
        const ebayUnlinked = (ebayData.listings || [])
          .filter(l => !linkedIds.has(l.legacyItemId))
          .map(l => ({
            platform:     'eBay',
            id:           l.legacyItemId,
            title:        l.title || 'Untitled',
            price:        parseFloat(l.price) || 0,
            listingIdKey: l.legacyItemId,
            raw:          l,
          }));

        const reverbUnlinked = reverbRes
          .filter(l => !linkedIds.has(String(l.id)))
          .map(l => ({
            platform:     'Reverb',
            id:           String(l.id),
            title:        l.title || 'Untitled',
            price:        parseFloat(l.price?.amount) || 0,
            listingIdKey: String(l.id),
            raw:          l,
          }));

        this.unlinkedListings = [...ebayUnlinked, ...reverbUnlinked];
        const sel = {};
        for (const l of this.unlinkedListings) sel[l.id] = '';
        this.linkSelections = sel;
      } catch(e) {
        this.listingsErr = e.message;
      } finally {
        this.listingsLoading = false;
      }
    },

    async _fetchAllReverbListings() {
      let all = [], nextUrl = '/api/reverb/my/listings';
      while (nextUrl) {
        const res = await fetch(nextUrl);
        if (!res.ok) throw new Error(`Reverb listings HTTP ${res.status}`);
        const data = await res.json();
        all = all.concat(data.listings || []);
        const nextHref = data._links?.next?.href;
        nextUrl = nextHref
          ? '/api/reverb/' + nextHref.replace('https://api.reverb.com/api/', '')
          : null;
      }
      return all;
    },

    async importAll() {
      const toImport = this.unlinkedListings.filter(l => !this.linkSelections[l.id]);
      if (!toImport.length) { this.importMsg = 'nothing to import'; return; }
      this.importingNew = true;
      this.importMsg    = '';
      let saved = 0, errors = 0;
      const dw = Alpine.store('dw');

      let lotId = null;
      const lotName = this.importNewLot.trim() || this.importLot;
      if (lotName) {
        let lot = dw.lots.find(l => l.name === lotName);
        if (!lot) {
          const res = await fetch('/api/lots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: lotName }) });
          lot = await res.json();
        }
        lotId = lot.id;
      }
      const categoryId = this.importCategory ? parseInt(this.importCategory, 10) : null;

      for (const listing of toImport) {
        try {
          const site = dw.sites.find(s => s.name === listing.platform);
          if (!site) throw new Error(`site not found: ${listing.platform}`);
          const itemFields = { name: listing.title, cost: 0 };
          if (categoryId) itemFields.category_id = categoryId;
          if (lotId)      itemFields.lot_id       = lotId;
          const item = await dw.createItem(itemFields);
          const listingFields = {
            item_id:             item.id,
            site_id:             site.id,
            list_price:          listing.price,
            platform_listing_id: listing.listingIdKey,
          };
          if (listing.platform === 'eBay') {
            listingFields.url = `https://www.ebay.com/itm/${listing.listingIdKey}`;
          } else {
            listingFields.url              = listing.raw._links?.web?.href || '';
            listingFields.shipping_estimate = parseFloat(listing.raw.shipping?.local?.amount) || null;
          }
          await dw.createListing(listingFields);
          saved++;
        } catch(e) {
          console.error('importAll:', e);
          errors++;
        }
      }
      this.importMsg    = errors ? `${saved} imported, ${errors} failed` : `✓ ${saved} imported`;
      this.importingNew = false;
      setTimeout(async () => { await dw.fetchAll(); await this.fetchListings(); }, 800);
    },

    async saveLinks() {
      const toLink = this.unlinkedListings
        .filter(l => this.linkSelections[l.id])
        .map(l => ({ unlinked: l, localRecordId: this.linkSelections[l.id] }));
      if (!toLink.length) { this.linksMsg = 'nothing selected'; return; }
      this.savingLinks = true;
      this.linksMsg    = '';
      let saved = 0, errors = 0;
      const dw = Alpine.store('dw');
      for (const { unlinked, localRecordId } of toLink) {
        try {
          const rec     = dw.records.find(r => String(r.id) === String(localRecordId));
          const listing = rec && (rec.listings || []).find(
            l => l.site?.name === unlinked.platform && l.status === 'active' && !l.platform_listing_id
          );
          if (!listing) throw new Error('no unlinked listing found on local record');
          await dw.updateListing(listing.id, { platform_listing_id: unlinked.listingIdKey }, { skipRefresh: true });
          if (rec.status === 'Prepping') await dw.updateItem(rec.id, { status: 'Listed' }, { skipRefresh: true });
          saved++;
        } catch(e) {
          console.error('saveLinks:', e);
          errors++;
        }
      }
      this.linksMsg    = errors ? `${saved} linked, ${errors} failed` : `✓ ${saved} linked`;
      this.savingLinks = false;
      setTimeout(async () => { await dw.fetchAll(); await this.fetchListings(); }, 800);
    },
```

- [ ] **Add the listings section HTML** in `index.html`, inside the sites view container after the Orders section closing `</div>`:

```html
          <!-- LISTINGS -->
          <div style="margin-bottom:40px">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
              <div class="modal-section-label" style="margin-bottom:0">Listings</div>
              <button @click="fetchListings()" :disabled="listingsLoading"
                style="padding:4px 12px;background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);font:700 9px/1 var(--mono);letter-spacing:.12em;cursor:pointer"
                x-text="listingsLoading ? 'FETCHING...' : 'SYNC LISTINGS'">
              </button>
            </div>

            <div x-show="listingsLoading" style="color:var(--muted);font-size:11px;letter-spacing:2px">FETCHING LISTINGS...</div>
            <div x-show="listingsErr" x-text="listingsErr" style="color:var(--red);font-size:11px;letter-spacing:1px"></div>

            <template x-if="!listingsLoading && !listingsErr && unlinkedListings.length > 0">
              <div>
                <!-- Import controls -->
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">
                  <div>
                    <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">CATEGORY</div>
                    <select class="modal-input" x-model="importCategory" style="min-width:120px">
                      <option value="">None</option>
                      <template x-for="cat in $store.dw.categories" :key="cat.id">
                        <option :value="cat.id" x-text="cat.name"></option>
                      </template>
                    </select>
                  </div>
                  <div>
                    <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">LOT</div>
                    <select class="modal-input" x-model="importLot" style="min-width:120px">
                      <option value="">None</option>
                      <template x-for="lot in $store.dw.lots" :key="lot.id">
                        <option :value="lot.name" x-text="lot.name"></option>
                      </template>
                    </select>
                  </div>
                  <div>
                    <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">OR NEW LOT</div>
                    <input class="modal-input" type="text" x-model="importNewLot" placeholder="e.g. EBAY-APR26" style="min-width:140px">
                  </div>
                </div>

                <!-- Unlinked listing rows -->
                <template x-for="listing in unlinkedListings" :key="listing.id">
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
                    <div style="flex:1">
                      <span style="font-size:10px;letter-spacing:.1em;margin-right:8px"
                        :style="listing.platform === 'eBay' ? 'color:var(--ebay)' : 'color:var(--reverb)'"
                        x-text="listing.platform"></span>
                      <span style="font-size:11px" x-text="listing.title"></span>
                      <span style="font-size:10px;color:var(--muted);margin-left:8px" x-text="'$' + listing.price.toFixed(2)"></span>
                    </div>
                    <div style="flex-shrink:0;margin-left:16px">
                      <select class="modal-input" x-model="linkSelections[listing.id]" style="font-size:10px;padding:3px 6px">
                        <option value="">Import as new item</option>
                        <template x-for="rec in $store.dw.records.filter(r => r.status !== 'Sold')" :key="rec.id">
                          <option :value="rec.id" x-text="rec.name"></option>
                        </template>
                      </select>
                    </div>
                  </div>
                </template>

                <div style="display:flex;gap:12px;align-items:center;margin-top:16px;flex-wrap:wrap">
                  <button @click="importAll()" :disabled="importingNew"
                    style="padding:8px 20px;background:var(--accent);color:#000;border:none;font:700 10px/1 var(--mono);letter-spacing:.12em;cursor:pointer"
                    x-text="importingNew ? 'IMPORTING...' : 'IMPORT ALL'">
                  </button>
                  <button @click="saveLinks()" :disabled="savingLinks"
                    x-show="Object.values(linkSelections).some(v => v)"
                    style="padding:8px 20px;background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);font:700 10px/1 var(--mono);letter-spacing:.12em;cursor:pointer"
                    x-text="savingLinks ? 'SAVING...' : 'SAVE LINKS'">
                  </button>
                  <span x-show="importMsg || linksMsg"
                    x-text="importMsg || linksMsg"
                    :style="(importMsg || linksMsg).startsWith('✓') ? 'color:var(--green)' : 'color:var(--red)'"
                    style="font-size:11px;letter-spacing:1px"></span>
                </div>
              </div>
            </template>

            <div x-show="!listingsLoading && !listingsErr && unlinkedListings.length === 0 && (listingsLoading === false)"
              style="color:var(--muted);font-size:11px;letter-spacing:1px">
              <!-- only show after a sync has been run -->
              <template x-if="unlinkedListings.length === 0 && listingsErr === '' && !listingsLoading">
                <span x-show="importMsg === '' && linksMsg === ''">press SYNC LISTINGS to check</span>
              </template>
            </div>
          </div>
```

- [ ] **Test listings section** — click SYNC LISTINGS, verify both platforms fetch, unlinked items appear, Import as new item is the default dropdown, IMPORT ALL creates items, SAVE LINKS only shows when a manual link is selected.

- [ ] **Commit:**

```bash
git add public/v2/js/views/sites.js public/v2/index.html
git commit -m "feat: sites view listings section — unified import + manual link override ref #115"
```

---

## Task 5: Build sitesView — Details section

**Files:**
- Modify: `public/v2/js/views/sites.js`
- Modify: `public/v2/index.html`

- [ ] **Add details methods** to `sitesView` in `sites.js`, after `saveLinks` and before the closing `}));`:

```js
    // ── Details ─────────────────────────────────────────────────────────────

    async fetchDetails() {
      this.detailsLoading = true;
      this.detailsErr     = '';
      this.detailDiffs    = [];
      this.detailsMsg     = '';
      try {
        const dw = Alpine.store('dw');
        const [ebayRes, reverbListings] = await Promise.all([
          fetch('/api/ebay/listings').then(r => r.ok ? r.json() : { listings: [] }),
          this._fetchAllReverbListings(),
        ]);
        const ebayListings = ebayRes.listings || [];

        const diffs = [];
        for (const r of dw.records) {
          for (const localListing of (r.listings || [])) {
            const siteName = localListing.site?.name;
            if (!localListing.platform_listing_id) continue;
            if (siteName === 'eBay') {
              const live = ebayListings.find(l => l.legacyItemId === localListing.platform_listing_id);
              if (!live) continue;
              const newName  = live.title || '';
              const newPrice = parseFloat(live.price) || 0;
              if (newName !== (r.name || '') || newPrice !== (localListing.list_price || 0)) {
                diffs.push({ rec: r, listing: localListing, platform: 'eBay', newName, newPrice, oldName: r.name || '', oldPrice: localListing.list_price || 0 });
              }
            } else if (siteName === 'Reverb') {
              const live = reverbListings.find(l => String(l.id) === localListing.platform_listing_id);
              if (!live) continue;
              const newName  = live.title || '';
              const newPrice = parseFloat(live.price?.amount) || 0;
              if (newName !== (r.name || '') || newPrice !== (localListing.list_price || 0)) {
                diffs.push({ rec: r, listing: localListing, platform: 'Reverb', newName, newPrice, oldName: r.name || '', oldPrice: localListing.list_price || 0 });
              }
            }
          }
        }
        this.detailDiffs = diffs;
      } catch(e) {
        this.detailsErr = e.message;
      } finally {
        this.detailsLoading = false;
      }
    },

    async syncAllDetails() {
      if (!this.detailDiffs.length) return;
      this.syncingDetails = true;
      this.detailsMsg     = '';
      let saved = 0, errors = 0;
      const dw = Alpine.store('dw');
      for (const { rec, listing, newName, newPrice } of this.detailDiffs) {
        try {
          await dw.updateListing(listing.id, { list_price: newPrice }, { skipRefresh: true });
          await dw.updateItem(rec.id, { name: newName }, { skipRefresh: true });
          saved++;
        } catch(e) {
          console.error('syncAllDetails:', e);
          errors++;
        }
      }
      this.detailsMsg     = errors ? `${saved} synced, ${errors} failed` : `✓ ${saved} synced`;
      this.syncingDetails = false;
      setTimeout(async () => { await dw.fetchAll(); await this.fetchDetails(); }, 800);
    },
```

- [ ] **Add the details section HTML** in `index.html`, inside the sites view container after the Listings section closing `</div>`:

```html
          <!-- DETAILS -->
          <div style="margin-bottom:40px">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
              <div class="modal-section-label" style="margin-bottom:0">Listing Details</div>
              <button @click="fetchDetails()" :disabled="detailsLoading"
                style="padding:4px 12px;background:transparent;border:1px solid var(--ink-3);color:var(--ink-2);font:700 9px/1 var(--mono);letter-spacing:.12em;cursor:pointer"
                x-text="detailsLoading ? 'CHECKING...' : 'CHECK DETAILS'">
              </button>
            </div>

            <div x-show="detailsLoading" style="color:var(--muted);font-size:11px;letter-spacing:2px">FETCHING LISTING DATA...</div>
            <div x-show="detailsErr" x-text="detailsErr" style="color:var(--red);font-size:11px;letter-spacing:1px"></div>

            <template x-if="!detailsLoading && !detailsErr && detailDiffs.length > 0">
              <div>
                <div style="font-size:11px;color:var(--muted);letter-spacing:1px;margin-bottom:12px"
                  x-text="detailDiffs.length + ' item' + (detailDiffs.length > 1 ? 's' : '') + ' out of sync'">
                </div>
                <template x-for="diff in detailDiffs" :key="diff.rec.id + '-' + diff.listing.id">
                  <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:11px">
                    <span style="letter-spacing:.1em;margin-right:8px"
                      :style="diff.platform === 'eBay' ? 'color:var(--ebay)' : 'color:var(--reverb)'"
                      x-text="diff.platform"></span>
                    <span x-text="diff.rec.name"></span>
                    <template x-if="diff.oldName !== diff.newName">
                      <div style="margin-top:4px;color:var(--muted)">
                        title: <span style="color:var(--red)" x-text="diff.oldName"></span>
                        → <span style="color:var(--green)" x-text="diff.newName"></span>
                      </div>
                    </template>
                    <template x-if="diff.oldPrice !== diff.newPrice">
                      <div style="margin-top:2px;color:var(--muted)">
                        price: <span style="color:var(--red)" x-text="'$' + diff.oldPrice.toFixed(2)"></span>
                        → <span style="color:var(--green)" x-text="'$' + diff.newPrice.toFixed(2)"></span>
                      </div>
                    </template>
                  </div>
                </template>
                <div style="display:flex;gap:12px;align-items:center;margin-top:16px">
                  <button @click="syncAllDetails()" :disabled="syncingDetails"
                    style="padding:8px 20px;background:var(--accent);color:#000;border:none;font:700 10px/1 var(--mono);letter-spacing:.12em;cursor:pointer"
                    x-text="syncingDetails ? 'SYNCING...' : 'SYNC ALL'">
                  </button>
                  <span x-show="detailsMsg"
                    x-text="detailsMsg"
                    :style="detailsMsg.startsWith('✓') ? 'color:var(--green)' : 'color:var(--red)'"
                    style="font-size:11px;letter-spacing:1px"></span>
                </div>
              </div>
            </template>

            <div x-show="!detailsLoading && !detailsErr && detailDiffs.length === 0 && detailsMsg === ''"
              style="color:var(--muted);font-size:11px;letter-spacing:1px">
              press CHECK DETAILS to compare
            </div>
            <div x-show="detailsMsg.startsWith('✓')"
              style="color:var(--green);font-size:11px;letter-spacing:1px" x-text="detailsMsg">
            </div>
          </div>
```

- [ ] **Test details section** — click CHECK DETAILS, verify diffs show correctly with old/new values, SYNC ALL updates items and clears the list.

- [ ] **Commit:**

```bash
git add public/v2/js/views/sites.js public/v2/index.html
git commit -m "feat: sites view details section — sync all price/title diffs ref #115"
```

---

## Task 6: Remove old modal HTML, scripts, and modal buttons from dashboard

**Files:**
- Modify: `public/v2/index.html`
- Delete: `public/v2/js/modals/reverb-modal.js`
- Delete: `public/v2/js/modals/ebay-modal.js`

This task is the final cleanup. Do it last — only after the SITES view is fully working.

- [ ] **Remove the Reverb sync modal HTML block** from `index.html`. Find the block starting with `<!-- ── REVERB SYNC MODAL` and delete the entire modal div (from `<div x-show="$store.dw.activeModal === 'reverb'"` through its closing `</div>`).

- [ ] **Remove the eBay sync modal HTML block** from `index.html`. Find the block starting with `<!-- ── EBAY SYNC MODAL` (or similar) and delete it entirely.

- [ ] **Remove the two sync buttons from the dashboard hero** (the `⟲ Reverb` and `⟲ eBay` tool buttons around line 164). The `+ Add` button stays.

- [ ] **Remove the script tags** for both modal files in the script loading block near the bottom of `index.html`:

```html
<script src="js/modals/reverb-modal.js"></script>
<script src="js/modals/ebay-modal.js"></script>
```

- [ ] **Delete the modal files:**

```bash
rm public/v2/js/modals/reverb-modal.js
rm public/v2/js/modals/ebay-modal.js
```

- [ ] **Verify no dead references** — grep for `reverbModal` and `ebayModal` in `index.html` to confirm no lingering `x-data` references:

```bash
grep -n "reverbModal\|ebayModal" public/v2/index.html
```

Expected: no output.

- [ ] **Full smoke test** — open http://localhost:3000, verify:
  - Dashboard loads, no console errors
  - No Reverb/eBay sync buttons on dashboard hero
  - SITES nav entry works, all three sections function
  - ORDERS ticker button checks and shows count
  - Clicking count navigates to SITES and clears ticker
  - SHIP from SITES opens label modal, closing returns to SITES
  - Label modal back-nav from item detail view still works (previousModal path unchanged)

- [ ] **Commit:**

```bash
git add public/v2/index.html
git rm public/v2/js/modals/reverb-modal.js public/v2/js/modals/ebay-modal.js
git commit -m "feat: remove legacy sync modals, complete sites view migration ref #115"
```

---

## Task 7: Version bump and session wrap

**Files:**
- Modify: `public/v2/js/config.js`
- Modify: `package.json`

- [ ] **Bump patch version** in `public/v2/js/config.js` — find `APP_VERSION` and increment the patch number (e.g. `1.4.2` → `1.4.3`).

- [ ] **Bump patch version** in `package.json` — find `"version"` and increment to match.

- [ ] **Commit and push:**

```bash
git add public/v2/js/config.js package.json
git commit -m "chore: bump version ref #115"
git push
```
