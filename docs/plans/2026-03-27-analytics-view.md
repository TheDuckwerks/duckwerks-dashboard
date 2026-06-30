# Analytics View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level Analytics nav view with two tabs — Listed (platform listing stats) and Sold (orders missing buyer feedback) — pulling data from Reverb and eBay.

**Architecture:** Client-side fetch on first tab activation; joins with `$store.dw.records` by `platform_listing_id` / `platform_order_num`. Three new eBay server routes added to `server/ebay.js`; Reverb uses existing generic proxy. Analytics view is `analyticsView` Alpine component following existing view patterns.

**Tech Stack:** Alpine.js (no build step), Express/Node, Reverb API (generic proxy), eBay Sell Analytics v1, eBay Sell Feedback v1, eBay Sell Fulfillment v1.

---

## File Map

| Action | File | What changes |
|---|---|---|
| Modify | `server/ebay-auth.js` | Add `sell.analytics.readonly` + `sell.reputation` to SCOPES |
| Modify | `server/ebay.js` | Add 3 new routes: `/traffic`, `/feedback`, `/orders/fulfilled` |
| Modify | `public/v2/js/store.js` | Add `'analytics'` to valid views in `init()` |
| Modify | `public/v2/index.html` | Add nav pill, view container, script tag |
| Create | `public/v2/js/views/analytics.js` | Full analytics view component |

---

## ⚠️ Re-auth Required Before Testing eBay Routes

After Task 1, Geoff must re-do the eBay OAuth flow to grant the new scopes:
1. Visit `http://localhost:3000/api/ebay/auth`
2. Complete eBay sign-in
3. Land on `duckwerks.com/ebay-oauth-callback.php`, copy the code
4. Run the displayed curl command to exchange the code

The refreshed token inherits scopes from the original grant — so a re-auth is necessary whenever scopes change.

---

## Task 1: eBay OAuth scopes + three new server routes

**Files:**
- Modify: `server/ebay-auth.js:7`
- Modify: `server/ebay.js` (append before `module.exports`)

- [ ] **Step 1: Update SCOPES in ebay-auth.js**

Replace line 7:
```js
const SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory';
```
With:
```js
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.reputation',
].join(' ');
```

- [ ] **Step 2: Add GET /api/ebay/traffic route to ebay.js**

Add before `module.exports = router;`:
```js
// GET /api/ebay/traffic — eBay Sell Analytics traffic report, last 30 days, per listing
router.get('/traffic', async (req, res) => {
  try {
    const headers = await ebayHeaders();
    const end     = new Date();
    const start   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fmt     = d => d.toISOString().split('.')[0] + 'Z';
    // Build URL manually — URLSearchParams encodes [ ] which eBay rejects
    const url = `${EBAY_API}/sell/analytics/v1/traffic_report`
      + `?dimension=LISTING_ID`
      + `&filter=date_range:[${fmt(start)}..${fmt(end)}],traffic_source:ALL`
      + `&metric=PAGE_VIEW_COUNT,WATCHER_COUNT,LISTING_IMPRESSION_ORGANIC,LISTING_CLICK_THROUGH_RATE`;
    const response = await fetch(url, { headers });
    const data     = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'eBay traffic report failed', detail: e.message });
  }
});
```

- [ ] **Step 3: Add GET /api/ebay/feedback route to ebay.js**

Add before `module.exports = router;`:
```js
// GET /api/ebay/feedback — all feedback received as seller (paginated)
router.get('/feedback', async (req, res) => {
  try {
    const headers  = await ebayHeaders();
    const feedback = [];
    let url = `${EBAY_API}/sell/feedback/v1/feedback?feedback_type=RECEIVED_AS_SELLER&limit=200`;

    while (url) {
      const response = await fetch(url, { headers });
      const data     = await response.json();
      (data.feedbackList || []).forEach(f => feedback.push(f));
      url = data.next || null;
    }

    res.json({ feedback });
  } catch (e) {
    res.status(502).json({ error: 'eBay feedback request failed', detail: e.message });
  }
});
```

- [ ] **Step 4: Add GET /api/ebay/orders/fulfilled route to ebay.js**

Add before `module.exports = router;`:
```js
// GET /api/ebay/orders/fulfilled — fulfilled orders from last 90 days (paginated)
router.get('/orders/fulfilled', async (req, res) => {
  try {
    const headers = await ebayHeaders();
    const orders  = [];
    let offset    = 0;
    const limit   = 200;

    while (true) {
      // Build URL manually — eBay rejects encoded { } |
      const url = `${EBAY_API}/sell/fulfillment/v1/order`
        + `?filter=orderfulfillmentstatus:{FULFILLED}`
        + `&limit=${limit}&offset=${offset}`;
      const response = await fetch(url, { headers });
      const data     = await response.json();
      const batch    = data.orders || [];
      orders.push(...batch);
      if (batch.length < limit || orders.length >= (data.total || 0)) break;
      offset += limit;
    }

    res.json({ orders });
  } catch (e) {
    res.status(502).json({ error: 'eBay fulfilled orders request failed', detail: e.message });
  }
});
```

- [ ] **Step 5: Restart the server and verify the new routes exist**

```bash
npm start
```

In a new terminal:
```bash
curl -s http://localhost:3000/api/ebay/traffic | head -c 200
curl -s http://localhost:3000/api/ebay/feedback | head -c 200
curl -s http://localhost:3000/api/ebay/orders/fulfilled | head -c 200
```

Expected before re-auth: routes respond with JSON (may be auth errors — that's fine, routes exist).

**⚠️ Now re-do eBay OAuth** (visit `/api/ebay/auth`) before eBay routes will return real data.

- [ ] **Step 6: Commit**

```bash
git add server/ebay-auth.js server/ebay.js
git commit -m "ref #53 #64: add eBay analytics/feedback/fulfilled-orders routes; expand OAuth scopes"
```

---

## Task 2: Wire Analytics view into app shell

**Files:**
- Modify: `public/v2/js/store.js:29`
- Modify: `public/v2/index.html` (sidebar nav, view container, script tag)
- Create: `public/v2/js/views/analytics.js`

- [ ] **Step 1: Add 'analytics' to valid views in store.js**

In `store.js` at line 29, change:
```js
if (saved && ['dashboard', 'items', 'lots'].includes(saved)) {
```
To:
```js
if (saved && ['dashboard', 'items', 'lots', 'analytics'].includes(saved)) {
```

- [ ] **Step 2: Add Analytics nav pill in index.html**

Find the Lots nav pill (line ~60):
```html
      <button class="nav-pill" :class="{ active: $store.dw.activeView === 'lots' }"      @click="$store.dw.activeView = 'lots'; $store.dw.categoryFilter = null"><span x-text="$store.dw.activeView === 'lots' ? '◉' : '○'"></span> Lots</button>
```

Add immediately after it:
```html
      <button class="nav-pill" :class="{ active: $store.dw.activeView === 'analytics' }" @click="$store.dw.activeView = 'analytics'; $store.dw.categoryFilter = null"><span x-text="$store.dw.activeView === 'analytics' ? '◉' : '○'"></span> Analytics</button>
```

- [ ] **Step 3: Add Analytics view container in index.html**

Find the closing `</div>` after the Lots view (line ~399-401):
```html
      </div>

    </div>
```

Insert the Analytics view container before the outer `</div>`:
```html
      <!-- Analytics -->
      <div x-show="$store.dw.activeView === 'analytics'" x-data="analyticsView">
        <div class="view-header">
          <div class="view-title">Analytics</div>
        </div>
        <div x-text="'Loading…'" x-show="loading"></div>
      </div>
```

- [ ] **Step 4: Add script tag in index.html**

Find:
```html
<script src="js/views/lots.js"></script>
```

Add immediately after:
```html
<script src="js/views/analytics.js"></script>
```

- [ ] **Step 5: Create analytics.js skeleton**

Create `public/v2/js/views/analytics.js`:
```js
// ── Analytics View ────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('analyticsView', () => ({
    activeTab:     'listed',
    loading:       false,

    // Listed tab state
    listedRows:    [],
    listedLoading: false,
    listedLoaded:  false,
    listedError:   null,
    sortKey:       'views',
    sortDir:       'desc',

    // Sold tab state
    soldRows:    [],
    soldLoading: false,
    soldLoaded:  false,
    soldError:   null,

    async init() {
      this.$watch('activeTab', tab => {
        if (tab === 'listed' && !this.listedLoaded) this._loadListed();
        if (tab === 'sold'   && !this.soldLoaded)   this._loadSold();
      });
      this._loadListed();
    },

    sortBy(key) {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortKey = key;
        this.sortDir = 'asc';
      }
    },

    sortIndicator(key) {
      if (this.sortKey !== key) return '';
      return this.sortDir === 'asc' ? ' ↑' : ' ↓';
    },

    get sortedListedRows() {
      return [...this.listedRows].sort((a, b) => {
        const av = a[this.sortKey] ?? -1;
        const bv = b[this.sortKey] ?? -1;
        if (av < bv) return this.sortDir === 'asc' ? -1 : 1;
        if (av > bv) return this.sortDir === 'asc' ?  1 : -1;
        return 0;
      });
    },

    get sortedSoldRows() {
      return [...this.soldRows].sort((a, b) => b.daysSince - a.daysSince);
    },

    async _loadListed() { /* Task 3 */ },
    async _loadSold()   { /* Task 5 */ },
  }));
});
```

- [ ] **Step 6: Verify nav pill appears and view switches**

Open `http://localhost:3000` in the browser. Confirm:
- "Analytics" pill appears in the sidebar nav
- Clicking it switches to the Analytics view (shows "Loading…" placeholder)
- View persists on reload (localStorage)

- [ ] **Step 7: Commit**

```bash
git add public/v2/js/store.js public/v2/index.html public/v2/js/views/analytics.js
git commit -m "ref #53 #64: wire Analytics nav view into app shell"
```

---

## Task 3: Listed tab — Reverb data fetch + table

**Files:**
- Modify: `public/v2/js/views/analytics.js` (replace `_loadListed` stub + add HTML in index.html)
- Modify: `public/v2/index.html` (Analytics view container body)

- [ ] **Step 1: Implement _loadListed() with Reverb data**

In `analytics.js`, replace `async _loadListed() { /* Task 3 */ }` with:
```js
async _loadListed() {
  this.listedLoading = true;
  this.listedError   = null;
  try {
    // Fetch all Reverb listings with pagination
    const reverbListings = [];
    let nextPath = 'my/listings?per_page=100&state=published';
    while (nextPath) {
      const data = await fetch('/api/reverb/' + nextPath).then(r => r.json());
      (data.listings || []).forEach(l => reverbListings.push(l));
      const nextHref = data._links?.next?.href || '';
      nextPath = nextHref ? nextHref.replace('https://api.reverb.com/api/', '') : null;
    }

    const dw = Alpine.store('dw');
    const rows = [];

    for (const l of reverbListings) {
      const lid   = String(l.id);
      const local = dw.records.find(r =>
        r.listings?.some(li => String(li.platform_listing_id) === lid)
      );
      rows.push({
        name:        local?.name || l.title || '—',
        site:        'Reverb',
        listingId:   lid,
        views:       l.stats?.views    ?? null,
        watchers:    l.stats?.watches  ?? null,
        impressions: null,
        ctr:         null,
      });
    }

    this.listedRows   = rows;
    this.listedLoaded = true;
  } catch (e) {
    this.listedError = 'Failed to load listed analytics: ' + e.message;
  } finally {
    this.listedLoading = false;
  }
},
```

- [ ] **Step 2: Replace Analytics view container HTML with full Listed tab layout**

Find the Analytics view container added in Task 2:
```html
      <!-- Analytics -->
      <div x-show="$store.dw.activeView === 'analytics'" x-data="analyticsView">
        <div class="view-header">
          <div class="view-title">Analytics</div>
        </div>
        <div x-text="'Loading…'" x-show="loading"></div>
      </div>
```

Replace with:
```html
      <!-- Analytics -->
      <div x-show="$store.dw.activeView === 'analytics'" x-data="analyticsView">
        <div class="view-header">
          <div class="view-title">Analytics</div>
          <div style="display:flex; gap:8px">
            <button class="nav-pill" :class="{ active: activeTab === 'listed' }" @click="activeTab = 'listed'">Listed</button>
            <button class="nav-pill" :class="{ active: activeTab === 'sold' }"   @click="activeTab = 'sold'">Sold</button>
          </div>
        </div>

        <!-- Listed Tab -->
        <div x-show="activeTab === 'listed'">
          <div x-show="listedLoading" style="padding:40px; text-align:center; color:var(--muted)">Loading…</div>
          <div x-show="listedError" x-text="listedError" style="padding:20px; color:var(--red)"></div>
          <table class="data-table" x-show="!listedLoading && !listedError">
            <thead>
              <tr>
                <th style="text-align:left" class="sortable" :class="{'sort-active': sortKey==='name'}"        @click="sortBy('name')">Item<span x-text="sortIndicator('name')"></span></th>
                <th class="sortable"                          :class="{'sort-active': sortKey==='site'}"        @click="sortBy('site')">Site<span x-text="sortIndicator('site')"></span></th>
                <th class="num-col sortable"                  :class="{'sort-active': sortKey==='views'}"       @click="sortBy('views')">Views<span x-text="sortIndicator('views')"></span></th>
                <th class="num-col sortable"                  :class="{'sort-active': sortKey==='watchers'}"    @click="sortBy('watchers')">Watchers<span x-text="sortIndicator('watchers')"></span></th>
                <th class="num-col sortable"                  :class="{'sort-active': sortKey==='impressions'}" @click="sortBy('impressions')">Impressions<span x-text="sortIndicator('impressions')"></span></th>
                <th class="num-col sortable"                  :class="{'sort-active': sortKey==='ctr'}"         @click="sortBy('ctr')">CTR<span x-text="sortIndicator('ctr')"></span></th>
              </tr>
            </thead>
            <tbody>
              <template x-for="row in sortedListedRows" :key="row.site + row.listingId">
                <tr>
                  <td style="text-align:left" x-text="row.name"></td>
                  <td><span :class="row.site === 'Reverb' ? 'badge-reverb' : 'badge-ebay'" x-text="row.site"></span></td>
                  <td class="num-col" x-text="row.views    != null ? row.views    : '—'"></td>
                  <td class="num-col" x-text="row.watchers != null ? row.watchers : '—'"></td>
                  <td class="num-col" x-text="row.impressions != null ? row.impressions : '—'"></td>
                  <td class="num-col" x-text="row.ctr != null ? row.ctr + '%' : '—'"></td>
                </tr>
              </template>
              <tr x-show="sortedListedRows.length === 0 && !listedLoading">
                <td colspan="6" style="color:var(--muted); text-align:center">No listings found</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Sold Tab placeholder (Task 5) -->
        <div x-show="activeTab === 'sold'">
          <div style="padding:40px; text-align:center; color:var(--muted)">Coming soon</div>
        </div>
      </div>
```

- [ ] **Step 3: Check for badge classes in components.css**

```bash
grep -n "badge-reverb\|badge-ebay" /Users/geoff/projects/reverb-dashboard/public/v2/css/components.css | head -5
```

If `badge-reverb` and `badge-ebay` exist, no action needed. If they don't exist, add to `components.css`:
```css
.badge-reverb { background: var(--reverb); color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
.badge-ebay   { background: var(--ebay);   color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
```

- [ ] **Step 4: Verify Reverb data loads in browser**

Open `http://localhost:3000`, switch to Analytics → Listed. Confirm:
- Reverb listings appear with Views + Watchers populated
- Impressions and CTR columns show `—` for Reverb rows
- Sorting works on all columns

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/views/analytics.js public/v2/index.html public/v2/css/components.css
git commit -m "ref #53: analytics Listed tab — Reverb data and sortable table"
```

---

## Task 4: Listed tab — eBay traffic data

**Files:**
- Modify: `public/v2/js/views/analytics.js` (extend `_loadListed`)

**Note:** Requires eBay re-auth (Task 1 step 6) before real data appears. Test with the curl first to see the raw response shape, since eBay Analytics API field names need verification.

- [ ] **Step 1: Check raw eBay traffic response shape**

```bash
curl -s http://localhost:3000/api/ebay/traffic | python3 -m json.tool | head -60
```

Note the actual field names in `records[0].dimensionValues` and `records[0].metricValues`. Specifically confirm whether metric objects use `metricKey` or `name` as the key field.

- [ ] **Step 2: Extend _loadListed() and add _fetchReverbListings() helper**

In `analytics.js`, replace the full `_loadListed()` method AND add `_fetchReverbListings()` as a sibling method in the `analyticsView` object (alongside `_loadListed`, `_loadSold`, `sortBy`, etc.):
```js
async _loadListed() {
  this.listedLoading = true;
  this.listedError   = null;
  try {
    // Fetch Reverb listings + eBay traffic in parallel
    const [reverbListings, ebayTrafficData] = await Promise.all([
      this._fetchReverbListings(),
      fetch('/api/ebay/traffic').then(r => r.json()).catch(() => ({})),
    ]);

    // Build eBay traffic map: legacyItemId -> { views, watchers, impressions, ctr }
    // NOTE: verify 'metricKey' vs 'name' against actual response (Step 1 above)
    const ebayMap = {};
    for (const rec of (ebayTrafficData.records || [])) {
      const lid = rec.dimensionValues?.[0]?.value;
      if (!lid) continue;
      const get = key => {
        const m = (rec.metricValues || []).find(m => m.metricKey === key || m.name === key);
        return m?.value != null ? parseFloat(m.value) : null;
      };
      ebayMap[lid] = {
        views:       get('PAGE_VIEW_COUNT'),
        watchers:    get('WATCHER_COUNT'),
        impressions: get('LISTING_IMPRESSION_ORGANIC'),
        ctr:         get('LISTING_CLICK_THROUGH_RATE'),
      };
    }

    const dw   = Alpine.store('dw');
    const rows = [];

    // Reverb rows
    for (const l of reverbListings) {
      const lid   = String(l.id);
      const local = dw.records.find(r =>
        r.listings?.some(li => String(li.platform_listing_id) === lid)
      );
      rows.push({
        name:        local?.name || l.title || '—',
        site:        'Reverb',
        listingId:   lid,
        views:       l.stats?.views   ?? null,
        watchers:    l.stats?.watches ?? null,
        impressions: null,
        ctr:         null,
      });
    }

    // eBay rows — use store records with active eBay listings
    for (const r of dw.records) {
      if (r.status !== 'Listed' || dw.siteLabel(r) !== 'eBay') continue;
      const listing = dw.activeListing(r);
      const lid     = listing?.platform_listing_id ? String(listing.platform_listing_id) : null;
      const traffic = lid ? (ebayMap[lid] || {}) : {};
      const rawCtr  = traffic.ctr != null ? Math.round(traffic.ctr * 100) : null;
      rows.push({
        name:        r.name,
        site:        'eBay',
        listingId:   lid || '',
        views:       traffic.views       ?? null,
        watchers:    traffic.watchers    ?? null,
        impressions: traffic.impressions ?? null,
        ctr:         rawCtr,
      });
    }

    this.listedRows   = rows;
    this.listedLoaded = true;
  } catch (e) {
    this.listedError = 'Failed to load listed analytics: ' + e.message;
  } finally {
    this.listedLoading = false;
  }
},

// Extracted helper — keeps _loadListed readable
async _fetchReverbListings() {
  const listings = [];
  let nextPath   = 'my/listings?per_page=100&state=published';
  while (nextPath) {
    const data = await fetch('/api/reverb/' + nextPath).then(r => r.json());
    (data.listings || []).forEach(l => listings.push(l));
    const nextHref = data._links?.next?.href || '';
    nextPath = nextHref ? nextHref.replace('https://api.reverb.com/api/', '') : null;
  }
  return listings;
},
```

- [ ] **Step 3: Verify eBay rows appear in the Listed table**

Open Analytics → Listed. Confirm:
- eBay rows appear with Views, Watchers, Impressions, CTR populated (if re-auth done)
- Reverb rows still show `—` for Impressions and CTR
- CTR renders as e.g. `16%` not `0.16%`
- Sorting by any column works across both Reverb and eBay rows

If eBay traffic returns 0 rows but no error, log `ebayTrafficData` to console and check the raw shape from Step 1.

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/views/analytics.js
git commit -m "ref #53: analytics Listed tab — merge eBay traffic data (views, watchers, impressions, CTR)"
```

---

## Task 5: Sold tab — Reverb feedback

**Files:**
- Modify: `public/v2/js/views/analytics.js` (implement `_loadSold`, add `_fetchReverbPendingFeedback`)
- Modify: `public/v2/index.html` (replace Sold tab placeholder with real table)

- [ ] **Step 1: Implement _loadSold() with Reverb data**

In `analytics.js`, replace `async _loadSold() { /* Task 5 */ }` with:
```js
async _loadSold() {
  this.soldLoading = true;
  this.soldError   = null;
  try {
    const reverbOrders = await this._fetchReverbPendingFeedback();
    const dw           = Alpine.store('dw');
    const rows         = [];

    for (const order of reverbOrders) {
      const orderNum = String(order.order_number);
      const local    = dw.records.find(r => String(r.order?.platform_order_num) === orderNum);
      const soldDate = new Date(order.created_at);
      const daysSince = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24));
      rows.push({
        name:       local?.name || order.listing?.title || '—',
        site:       'Reverb',
        orderNum,
        soldDate,
        daysSince,
        orderUrl:   order._links?.web?.href || null,
      });
    }

    this.soldRows   = rows;
    this.soldLoaded = true;
  } catch (e) {
    this.soldError = 'Failed to load feedback data: ' + e.message;
  } finally {
    this.soldLoading = false;
  }
},

async _fetchReverbPendingFeedback() {
  // Fetch without state filter — orders can be in 'shipped' or 'received' state
  // and still have needs_feedback_for_seller: true. Let that flag do the filtering.
  const orders   = [];
  let nextPath   = 'my/orders/selling?per_page=50';
  let pages      = 0;
  while (nextPath && pages < 10) {   // cap at 500 orders to avoid infinite pagination
    const data = await fetch('/api/reverb/' + nextPath).then(r => r.json());
    (data.orders || [])
      .filter(o => o.needs_feedback_for_seller === true)
      .forEach(o => orders.push(o));
    const nextHref = data._links?.next?.href || '';
    nextPath = nextHref ? nextHref.replace('https://api.reverb.com/api/', '') : null;
    pages++;
  }
  return orders;
},
```

- [ ] **Step 2: Replace Sold tab placeholder in index.html with table**

Find:
```html
        <!-- Sold Tab placeholder (Task 5) -->
        <div x-show="activeTab === 'sold'">
          <div style="padding:40px; text-align:center; color:var(--muted)">Coming soon</div>
        </div>
```

Replace with:
```html
        <!-- Sold Tab -->
        <div x-show="activeTab === 'sold'">
          <div x-show="soldLoading" style="padding:40px; text-align:center; color:var(--muted)">Loading…</div>
          <div x-show="soldError" x-text="soldError" style="padding:20px; color:var(--red)"></div>
          <table class="data-table" x-show="!soldLoading && !soldError">
            <thead>
              <tr>
                <th style="text-align:left">Item</th>
                <th>Site</th>
                <th>Sold Date</th>
                <th class="num-col">Days Since Sale</th>
                <th>Order Link</th>
              </tr>
            </thead>
            <tbody>
              <template x-for="row in sortedSoldRows" :key="row.site + row.orderNum">
                <tr>
                  <td style="text-align:left" x-text="row.name"></td>
                  <td><span :class="row.site === 'Reverb' ? 'badge-reverb' : 'badge-ebay'" x-text="row.site"></span></td>
                  <td style="color:var(--muted); white-space:nowrap" x-text="row.soldDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"></td>
                  <td class="num-col" x-text="row.daysSince + 'd'"></td>
                  <td>
                    <a x-show="row.orderUrl" :href="row.orderUrl" target="_blank" style="color:var(--blue)">View Order</a>
                    <span x-show="!row.orderUrl" style="color:var(--muted)">—</span>
                  </td>
                </tr>
              </template>
              <tr x-show="sortedSoldRows.length === 0 && !soldLoading">
                <td colspan="5" style="color:var(--muted); text-align:center">No orders pending feedback</td>
              </tr>
            </tbody>
          </table>
        </div>
```

- [ ] **Step 3: Verify Reverb sold tab in browser**

Switch to Analytics → Sold. Confirm:
- Reverb orders missing buyer feedback appear
- Sold Date shows "Mar 3" format
- Days Since Sale shows e.g. `24d`
- Order Link opens the Reverb order page
- Empty state shows "No orders pending feedback" if none pending

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/views/analytics.js public/v2/index.html
git commit -m "ref #64: analytics Sold tab — Reverb orders pending buyer feedback"
```

---

## Task 6: Sold tab — eBay feedback cross-reference

**Files:**
- Modify: `public/v2/js/views/analytics.js` (extend `_loadSold`)

**Note:** Requires eBay re-auth (Task 1). Check raw responses from `/api/ebay/feedback` and `/api/ebay/orders/fulfilled` before writing the join logic — verify field names for `legacyOrderId`.

- [ ] **Step 1: Check raw eBay fulfilled orders + feedback response shapes**

```bash
curl -s http://localhost:3000/api/ebay/orders/fulfilled | python3 -m json.tool | head -80
curl -s http://localhost:3000/api/ebay/feedback | python3 -m json.tool | head -80
```

Note:
- The field name for the legacy order ID in fulfilled orders (likely `legacyOrderId`)
- The same field in feedback objects (likely `legacyOrderId`)
- The `creationDate` field name on orders
- The URL format for eBay order links if visible in the response

- [ ] **Step 2: Extend _loadSold() to fetch and cross-reference eBay data**

Replace the full `_loadSold()` with:
```js
async _loadSold() {
  this.soldLoading = true;
  this.soldError   = null;
  try {
    const [reverbOrders, ebayFulfilled, ebayFeedback] = await Promise.all([
      this._fetchReverbPendingFeedback(),
      fetch('/api/ebay/orders/fulfilled').then(r => r.json()).catch(() => ({ orders: [] })),
      fetch('/api/ebay/feedback').then(r => r.json()).catch(() => ({ feedback: [] })),
    ]);

    // Build set of eBay order IDs that already have feedback
    const feedbackOrderIds = new Set(
      (ebayFeedback.feedback || []).map(f => f.legacyOrderId).filter(Boolean)
    );

    // eBay orders missing feedback
    const ebayPending = (ebayFulfilled.orders || []).filter(
      o => !feedbackOrderIds.has(o.legacyOrderId)
    );

    const dw   = Alpine.store('dw');
    const rows = [];

    // Reverb rows
    for (const order of reverbOrders) {
      const orderNum  = String(order.order_number);
      const local     = dw.records.find(r => String(r.order?.platform_order_num) === orderNum);
      const soldDate  = new Date(order.created_at);
      const daysSince = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24));
      rows.push({
        name:       local?.name || order.listing?.title || '—',
        site:       'Reverb',
        orderNum,
        soldDate,
        daysSince,
        orderUrl:   order._links?.web?.href || null,
      });
    }

    // eBay rows
    for (const order of ebayPending) {
      // Try to match to a local record by platform_order_num (eBay stores orderId)
      const local = dw.records.find(r =>
        r.order?.platform_order_num &&
        (String(r.order.platform_order_num) === String(order.orderId) ||
         String(r.order.platform_order_num) === String(order.legacyOrderId))
      );
      const soldDate  = new Date(order.creationDate);
      const daysSince = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24));
      // eBay order page URL — verify format against actual orderId
      const orderUrl  = order.orderId
        ? `https://www.ebay.com/mesh/ord/details?orderId=${order.orderId}`
        : null;
      rows.push({
        name:       local?.name || order.lineItems?.[0]?.title || '—',
        site:       'eBay',
        orderNum:   order.orderId || order.legacyOrderId,
        soldDate,
        daysSince,
        orderUrl,
      });
    }

    this.soldRows   = rows;
    this.soldLoaded = true;
  } catch (e) {
    this.soldError = 'Failed to load feedback data: ' + e.message;
  } finally {
    this.soldLoading = false;
  }
},
```

- [ ] **Step 3: Verify eBay rows appear in browser**

Switch to Analytics → Sold. Confirm:
- eBay orders without feedback appear alongside Reverb rows
- All rows sorted by Days Since Sale desc (oldest first)
- eBay Order Link opens the eBay order page (verify URL works in browser — may need to adjust format if `mesh/ord/details` doesn't resolve)
- If eBay rows are unexpected (e.g. all orders appear), log `feedbackOrderIds` and `ebayPending` to console to debug the cross-reference

- [ ] **Step 4: Verify eBay order link URL format**

Click an eBay "View Order" link. If it 404s, try the alternative URL format:
```
https://www.ebay.com/sh/ord/details?orderid={legacyOrderId}
```

Update `orderUrl` construction in `_loadSold()` if needed.

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/views/analytics.js
git commit -m "ref #64: analytics Sold tab — eBay fulfilled orders cross-referenced against feedback received"
```

---

## Task 7: Version bump + session close

**Files:**
- Modify: `public/v2/js/config.js` (bump APP_VERSION patch)
- Modify: `package.json` (bump version patch)
- Modify: `docs/session-log.md`

- [ ] **Step 1: Bump patch version**

In `public/v2/js/config.js`, increment `APP_VERSION` by one patch (e.g. `0.9.9` → `1.0.0` — confirm with Geoff whether this release warrants 1.0.0).

In `package.json`, update `version` to match.

- [ ] **Step 2: Update session log**

Add an entry to `docs/session-log.md` summarizing what was built.

- [ ] **Step 3: Final commit + push**

```bash
git add public/v2/js/config.js package.json docs/session-log.md
git commit -m "ref #53 #64: v1.0.0 — Analytics view (listed stats + pending feedback)"
git push
```
