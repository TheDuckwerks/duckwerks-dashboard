# Shipment Tracking (#19) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface live EasyPost shipment tracking on the dashboard, items view, item modal, and a redesigned shipping modal — all fetched on-demand with no webhooks.

**Architecture:** Purchase response already contains a `tracker` object; extend it to return `trackingId` + `trackerUrl`. A new `GET /api/label/tracker/:id` proxies EasyPost. A `store.fetchTracker(id)` helper is the single place that calls this endpoint. Each UI surface calls it on load/open and stores results locally. New Airtable fields hold the tracker ID, tracking number, and public tracker URL.

**Tech Stack:** Alpine.js (no build), Express/Node, EasyPost REST API, Airtable via existing proxy

---

## File Map

| File | Change |
|---|---|
| `server/label.js` | `easypostPurchase` returns `trackingId`; new `GET /tracker/:id` route |
| `public/v2/js/config.js` | Add `trackingId`, `trackingNumber`, `trackerUrl` to `F` |
| `public/v2/js/store.js` | Add `store.fetchTracker(id)` helper method |
| `public/v2/js/modals/label-modal.js` | `saveShipping()` saves 3 new tracking fields |
| `public/v2/js/modals/shipping-modal.js` | Repurpose from Shippo usage → in-transit tracking panel |
| `public/v2/js/views/dashboard.js` | Add `init()`, `trackingData`, `inTransitRecords`, `_loadTracking()` |
| `public/v2/js/views/items.js` | Watch `statusFilter`; load trackers + add `trackingData` for Sold view |
| `public/v2/js/modals/item-modal.js` | Load tracker on open; add `trackingData`, `trackingLoading` |
| `public/v2/index.html` | 4 targeted edits: sidebar button, dashboard panel, items column, item modal section |

---

## Task 1: Airtable Fields (manual + config.js)

**This is a manual prerequisite** — must be done before Task 3 and 4 can use real field IDs.

**Files:**
- Modify: `public/v2/js/config.js`

- [ ] **Step 1: Create 3 fields in Airtable**

  In the Duckwerks base, open the Inventory table and add:
  - `trackingId` — Single line text (stores `trk_xxx` EasyPost tracker ID)
  - `trackingNumber` — Single line text (stores carrier tracking number, e.g. `1Z...`)
  - `trackerUrl` — URL (stores `https://track.easypost.com/...` public tracker URL)

  Copy the 3 field IDs from Airtable (open field settings → "Field ID" or use the API explorer).

- [ ] **Step 2: Add to config.js `F` object**

  In `public/v2/js/config.js`, add 3 entries to the `F` object after `dateSold`:

  ```js
  dateSold:        'fldcIJOUtePuaxAVH',
  trackingId:      'REPLACE_WITH_AIRTABLE_FIELD_ID',
  trackingNumber:  'REPLACE_WITH_AIRTABLE_FIELD_ID',
  trackerUrl:      'REPLACE_WITH_AIRTABLE_FIELD_ID',
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add public/v2/js/config.js
  git commit -m "feat: add trackingId/trackingNumber/trackerUrl fields to config ref #19"
  ```

---

## Task 2: Server — Tracker Proxy + Purchase Returns trackingId

**Files:**
- Modify: `server/label.js`

- [ ] **Step 1: Return `trackingId` and `trackerUrl` from `easypostPurchase`**

  In `easypostPurchase()`, change the return statement from:
  ```js
  return {
    trackingNumber: data.tracking_code,
    labelUrl:       data.postage_label?.label_url,
    trackingUrl:    data.tracker?.public_url,
  };
  ```
  To:
  ```js
  return {
    trackingNumber: data.tracking_code,
    labelUrl:       data.postage_label?.label_url,
    trackingUrl:    data.tracker?.public_url,
    trackingId:     data.tracker?.id   || null,
    trackerUrl:     data.tracker?.public_url || null,
  };
  ```

  Note: `trackingUrl` and `trackerUrl` are the same value (both `data.tracker?.public_url`). `trackingUrl` was the existing key already returned; `trackerUrl` is the new Airtable-field-mapped version. Both are kept in the response so no client code breaks.

- [ ] **Step 2: Add `GET /tracker/:id` route**

  Add after the `/purchase` route (before the `/usage` route):

  ```js
  router.get('/tracker/:id', async (req, res) => {
    if (PROVIDER !== 'EASYPOST') return res.json({ skipped: true });
    const token = easypostToken();
    try {
      const r    = await fetch(`${EASYPOST_API}/trackers/${req.params.id}`, {
        headers: easypostHeaders(token),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'EasyPost request failed', detail: e.message });
    }
  });
  ```

- [ ] **Step 3: Manual verification**

  Start the server: `npm start`

  In a terminal, test with a real tracker ID from a past purchase (check Airtable or EasyPost dashboard). Expected: JSON response with `status`, `carrier`, `tracking_details` fields.

  ```bash
  curl http://localhost:3000/api/label/tracker/trk_YOUR_ID_HERE
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add server/label.js
  git commit -m "feat: add tracker proxy endpoint and return trackingId from purchase ref #19"
  ```

---

## Task 3: label-modal — Save Tracking Fields

**Files:**
- Modify: `public/v2/js/modals/label-modal.js`

- [ ] **Step 1: Update `saveShipping()` to save tracking fields**

  In `saveShipping()`, the `fields` object is built starting with `[F.shipping]: this.ratePrice`. Add the 3 tracking fields from `purchaseResult`:

  ```js
  async saveShipping() {
    if (!this.record) return;
    this.savingShip = true;
    this.saveMsg    = '';
    const dw     = Alpine.store('dw');
    const fields = { [F.shipping]: this.ratePrice };
    // Mark sold + stamp date if not already set
    if (dw.str(this.record, F.status) !== 'Sold')  fields[F.status]   = 'Sold';
    if (!dw.str(this.record, F.dateSold))           fields[F.dateSold] = new Date().toISOString().split('T')[0];
    // Pull in Reverb sale amount if we have it and it's not already set
    if (this.reverbSaleAmount && !dw.num(this.record, F.sale)) fields[F.sale] = this.reverbSaleAmount;
    // Save tracking fields from purchase result
    if (this.purchaseResult?.trackingNumber) fields[F.trackingNumber] = this.purchaseResult.trackingNumber;
    if (this.purchaseResult?.trackingId)     fields[F.trackingId]     = this.purchaseResult.trackingId;
    if (this.purchaseResult?.trackerUrl)     fields[F.trackerUrl]     = this.purchaseResult.trackerUrl;
    try {
      await dw.updateRecord(this.record.id, fields);
      this.saveMsg = '✓ saved';
    } catch(e) {
      this.saveMsg = 'ERROR: ' + e.message;
    } finally {
      this.savingShip = false;
    }
  },
  ```

- [ ] **Step 2: Verify manually**

  Ask Geoff to purchase a test label (switch `EASYPOST_TEST_MODE=true` in `.env`, restart server). After purchase completes, check the Airtable record — `trackingId`, `trackingNumber`, and `trackerUrl` fields should be populated.

- [ ] **Step 3: Commit**

  ```bash
  git add public/v2/js/modals/label-modal.js
  git commit -m "feat: save trackingId/trackingNumber/trackerUrl at label purchase ref #19"
  ```

---

## Task 4: Store — `fetchTracker()` Helper

**Files:**
- Modify: `public/v2/js/store.js`

- [ ] **Step 1: Add `fetchTracker` to the store**

  Find the end of the store's method definitions (near `navToItems`, `eaf`, etc.) and add:

  ```js
  async fetchTracker(trackingId) {
    if (!trackingId) return null;
    try {
      const res  = await fetch(`/api/label/tracker/${trackingId}`);
      const data = await res.json();
      if (!res.ok || data.skipped) return null;
      return {
        status:      data.status,
        carrier:     data.carrier,
        estDelivery: data.est_delivery_date || null,
        events:      data.tracking_details || [],
        publicUrl:   data.public_url || null,
      };
    } catch (e) {
      console.warn('fetchTracker failed:', e);
      return null;
    }
  },
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add public/v2/js/store.js
  git commit -m "feat: add fetchTracker helper to store ref #19"
  ```

---

## Task 5: Shipping Modal — Repurpose for In-Transit Tracking

**Files:**
- Modify: `public/v2/js/modals/shipping-modal.js`
- Modify: `public/v2/index.html` (targeted edit — sidebar button + modal HTML)

- [ ] **Step 1: Rewrite `shipping-modal.js`**

  Replace the entire file with:

  ```js
  // ── Shipping Modal — Tracking Panel ──────────────────────────────────────────
  document.addEventListener('alpine:init', () => {
    Alpine.data('shippingModal', () => ({
      loading:     false,
      refreshing:  false,
      trackingData: {},  // { [recordId]: { status, carrier, estDelivery, publicUrl } | null }
      errMsg:      '',

      init() {
        this.$watch('$store.dw.activeModal', val => {
          if (val === 'shipping') this._open();
        });
      },

      async _open() {
        this.loading     = true;
        this.errMsg      = '';
        this.trackingData = {};
        await this._loadAll();
        this.loading = false;
      },

      get inTransitRecords() {
        const dw = Alpine.store('dw');
        return dw.records.filter(r =>
          dw.str(r, F.status) === 'Sold' && dw.str(r, F.trackingId)
        );
      },

      async _loadAll() {
        const dw = Alpine.store('dw');
        // Guard: if store hasn't loaded yet, nothing to fetch
        if (dw.loading || !dw.records.length) { this.loading = false; return; }
        // Collect all results locally first — concurrent spread writes would race
        const results = await Promise.all(this.inTransitRecords.map(async r => {
          const tid  = dw.str(r, F.trackingId);
          const data = await dw.fetchTracker(tid);
          return { id: r.id, data };
        }));
        const merged = {};
        results.forEach(({ id, data }) => { merged[id] = data; });
        this.trackingData = merged;
      },

      async refreshAll() {
        this.refreshing = true;
        this.trackingData = {};
        await this._loadAll();
        this.refreshing = false;
      },

      openItem(r) {
        Alpine.store('dw').openModal('item', r.id);
      },

      trackStatus(r) {
        return this.trackingData[r.id]?.status || null;
      },

      trackCarrier(r) {
        const dw = Alpine.store('dw');
        return this.trackingData[r.id]?.carrier || dw.str(r, F.trackingNumber) || '—';
      },

      trackEstDelivery(r) {
        const raw = this.trackingData[r.id]?.estDelivery;
        if (!raw) return null;
        return new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      },

      trackPublicUrl(r) {
        const dw = Alpine.store('dw');
        return this.trackingData[r.id]?.publicUrl || dw.str(r, F.trackerUrl) || null;
      },

      statusBadgeClass(status) {
        switch (status) {
          case 'delivered':          return 'badge-sold';       // green
          case 'out_for_delivery':   return 'badge-pending';    // yellow
          case 'in_transit':         return 'badge-listed';     // blue
          case 'return_to_sender':
          case 'failure':            return 'badge-prepping';   // red
          default:                   return 'badge-other';      // muted
        }
      },

      statusLabel(status) {
        if (!status) return 'Unknown';
        return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      },
    }));
  });
  ```

- [ ] **Step 2: Update sidebar button in index.html**

  Find (line ~66):
  ```html
  <a class="sidebar-action" x-show="$store.dw.shippingProvider === 'SHIPPO'" @click="$store.dw.openModal('shipping')">Shipping</a>
  ```
  Replace with:
  ```html
  <a class="sidebar-action" @click="$store.dw.openModal('shipping')">Shipping</a>
  ```

- [ ] **Step 3: Replace shipping modal HTML in index.html**

  Find the `<!-- ── Shipping Modal ──` comment block (lines ~1157–1193) and replace the entire `<div x-show="...shippingModal...">` block with:

  ```html
  <!-- ── Shipping Modal ──────────────────────────────────────────────────── -->
  <div x-show="$store.dw.activeModal === 'shipping'" x-data="shippingModal" class="modal-overlay" @click.self="$store.dw.closeModal()" x-cloak>
    <div class="modal-box" style="max-width:540px">
      <div class="modal-header">
        <div class="modal-title">IN TRANSIT</div>
        <div style="display:flex;gap:12px;align-items:center">
          <button class="btn-sm" @click="refreshAll()" :disabled="refreshing" style="font-size:11px;letter-spacing:1px">
            <span x-text="refreshing ? 'REFRESHING...' : '↺ REFRESH ALL'"></span>
          </button>
          <button class="modal-close" @click="$store.dw.closeModal()">✕</button>
        </div>
      </div>
      <div class="modal-body">
        <div x-show="loading" style="color:var(--muted);font-size:12px;padding:16px 0">Loading...</div>
        <div x-show="errMsg" style="color:var(--red);font-size:12px" x-text="errMsg"></div>
        <div x-show="!loading && inTransitRecords.length === 0" style="color:var(--muted);font-size:12px;padding:16px 0">
          No shipments with tracking data.
        </div>
        <template x-if="!loading && inTransitRecords.length > 0">
          <table class="items-table" style="width:100%">
            <thead>
              <tr>
                <th style="text-align:left">Item</th>
                <th>Status</th>
                <th>Carrier</th>
                <th>Est. Delivery</th>
              </tr>
            </thead>
            <tbody>
              <template x-for="r in inTransitRecords" :key="r.id">
                <tr style="cursor:pointer" @click="openItem(r)">
                  <td style="text-align:left" x-text="$store.dw.str(r, F.name).replace(/\n/g,'')"></td>
                  <td class="num">
                    <span x-show="trackStatus(r)" :class="'badge ' + statusBadgeClass(trackStatus(r))" x-text="statusLabel(trackStatus(r))"></span>
                    <span x-show="!trackStatus(r)" style="color:var(--muted);font-size:11px">—</span>
                  </td>
                  <td class="num" style="color:var(--muted);font-size:12px" x-text="trackCarrier(r)"></td>
                  <td class="num" style="color:var(--muted);font-size:12px" x-text="trackEstDelivery(r) || '—'"></td>
                </tr>
              </template>
            </tbody>
          </table>
        </template>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 4: Verify manually**

  Open the app. Click "Shipping" in the sidebar. The modal should open, load tracking data for sold items that have a `trackingId`, and display the table. If there are no items with tracking yet, the "No shipments with tracking data" message should show.

- [ ] **Step 5: Commit**

  ```bash
  git add public/v2/js/modals/shipping-modal.js public/v2/index.html
  git commit -m "feat: repurpose shipping modal as in-transit tracking panel ref #19"
  ```

---

## Task 6: Dashboard — "In Transit" Panel

**Files:**
- Modify: `public/v2/js/views/dashboard.js`
- Modify: `public/v2/index.html` (targeted edit — insert panel after KPI cards)

- [ ] **Step 1: Add tracking state and methods to `dashboard.js`**

  `dashboard.js` has **no existing `init()`** — add these at the top of the returned object, immediately before the `get totalInvested()` getter (line 7 in the current file):

  ```js
  trackingData: {},
  trackingLoading: false,

  init() {
    // Dual-path: watch for records load, handle already-loaded case
    this.$watch('$store.dw.loading', val => {
      if (!val) this._loadTracking();
    });
    const dw = Alpine.store('dw');
    if (!dw.loading && dw.records.length > 0) this._loadTracking();
  },

  get inTransitRows() {
    const dw = Alpine.store('dw');
    return dw.records.filter(r =>
      dw.str(r, F.status) === 'Sold' && dw.str(r, F.trackingId)
    ).filter(r => {
      const td = this.trackingData[r.id];
      return !td || td.status !== 'delivered';
    });
  },

  async _loadTracking() {
    const dw = Alpine.store('dw');
    const toFetch = dw.records.filter(r =>
      dw.str(r, F.status) === 'Sold' && dw.str(r, F.trackingId)
    );
    if (!toFetch.length) return;
    this.trackingLoading = true;
    // Collect locally then assign once — avoids concurrent spread race
    const results = await Promise.all(toFetch.map(async r => {
      const tid  = dw.str(r, F.trackingId);
      const data = await dw.fetchTracker(tid);
      return { id: r.id, data };
    }));
    const merged = {};
    results.forEach(({ id, data }) => { merged[id] = data; });
    this.trackingData    = merged;
    this.trackingLoading = false;
  },

  trackStatus(r) {
    return this.trackingData[r.id]?.status || null;
  },

  trackEstDelivery(r) {
    const raw = this.trackingData[r.id]?.estDelivery;
    if (!raw) return '—';
    return new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  trackCarrier(r) {
    return this.trackingData[r.id]?.carrier || '—';
  },

  trackStatusBadge(status) {
    switch (status) {
      case 'delivered':        return 'badge-sold';
      case 'out_for_delivery': return 'badge-pending';
      case 'in_transit':       return 'badge-listed';
      case 'return_to_sender':
      case 'failure':          return 'badge-prepping';
      default:                 return 'badge-other';
    }
  },

  trackStatusLabel(status) {
    if (!status) return '—';
    return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },
  ```

- [ ] **Step 2: Add "In Transit" panel HTML to index.html**

  Find the end of the KPI stat-grid div in the dashboard section. It ends with:
  ```html
        </div>
        </div>

        <!-- Analytics Charts -->
  ```
  (Around line 119–121.) Insert between KPI cards and Analytics:

  ```html
        <!-- In Transit -->
        <template x-if="inTransitRows.length > 0 || trackingLoading">
          <div class="panel" style="margin-bottom:24px">
            <div class="panel-title" style="margin-bottom:12px">IN TRANSIT</div>
            <div x-show="trackingLoading" style="color:var(--muted);font-size:12px">Loading tracking data...</div>
            <template x-if="!trackingLoading && inTransitRows.length > 0">
              <table class="items-table" style="width:100%">
                <thead>
                  <tr>
                    <th style="text-align:left">Item</th>
                    <th>Status</th>
                    <th>Carrier</th>
                    <th>Est. Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  <template x-for="r in inTransitRows" :key="r.id">
                    <tr style="cursor:pointer" @click="$store.dw.openModal('item', r.id)">
                      <td style="text-align:left" x-text="$store.dw.str(r, F.name).replace(/\n/g,'')"></td>
                      <td class="num">
                        <span x-show="trackStatus(r)" :class="'badge ' + trackStatusBadge(trackStatus(r))" x-text="trackStatusLabel(trackStatus(r))"></span>
                        <span x-show="!trackStatus(r)" style="color:var(--muted);font-size:11px">—</span>
                      </td>
                      <td class="num" style="color:var(--muted);font-size:12px" x-text="trackCarrier(r)"></td>
                      <td class="num" style="color:var(--muted);font-size:12px" x-text="trackEstDelivery(r)"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </template>
          </div>
        </template>
  ```

- [ ] **Step 3: Verify manually**

  Navigate to Dashboard. If there are sold items with `trackingId` set, the panel should appear and show live tracking status. If no items have tracking yet, panel is hidden.

- [ ] **Step 4: Commit**

  ```bash
  git add public/v2/js/views/dashboard.js public/v2/index.html
  git commit -m "feat: add in-transit tracking panel to dashboard ref #19"
  ```

---

## Task 7: Items View — Sold Tracking Column

**Files:**
- Modify: `public/v2/js/views/items.js`
- Modify: `public/v2/index.html` (targeted edit — Sold filter table)

- [ ] **Step 1: Add tracking state to `items.js`**

  Add these properties and methods to the `Alpine.data('itemsView', ...)` return object:

  ```js
  trackingData: {},
  trackingLoading: false,
  ```

  In `init()`, add a watcher after the existing `pendingFilters` watcher:

  ```js
  this.$watch('statusFilter', val => {
    if (val === 'Sold') this._loadTracking();
  });
  // Load immediately if starting on Sold
  if (this.statusFilter === 'Sold') this._loadTracking();
  ```

  Add these methods:

  ```js
  async _loadTracking() {
    const dw = Alpine.store('dw');
    // Guard: don't run before records are loaded
    if (dw.loading || !dw.records.length) return;
    const toFetch = dw.records.filter(r =>
      dw.str(r, F.status) === 'Sold' && dw.str(r, F.trackingId)
    );
    if (!toFetch.length) return;
    this.trackingLoading = true;
    // Collect locally then assign once — avoids concurrent spread race
    const results = await Promise.all(toFetch.map(async r => {
      const tid  = dw.str(r, F.trackingId);
      const data = await dw.fetchTracker(tid);
      return { id: r.id, data };
    }));
    const merged = {};
    results.forEach(({ id, data }) => { merged[id] = data; });
    this.trackingData    = merged;
    this.trackingLoading = false;
  },

  trackStatusBadge(status) {
    switch (status) {
      case 'delivered':        return 'badge-sold';
      case 'out_for_delivery': return 'badge-pending';
      case 'in_transit':       return 'badge-listed';
      case 'return_to_sender':
      case 'failure':          return 'badge-prepping';
      default:                 return 'badge-other';
    }
  },

  trackStatusLabel(status) {
    if (!status) return '—';
    return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },
  ```

- [ ] **Step 2: Add tracking column to Sold filter table in index.html**

  First, grep to find the items table header row:

  ```
  Grep: "Shipping.*sortIndicator" in index.html to find line number
  ```

  The items view `<thead>` has columns including Shipping. Add a Tracking column header after Shipping — but **only show it when `statusFilter === 'Sold'`**:

  In the `<th>` for Shipping, add after it:
  ```html
  <th x-show="statusFilter === 'Sold'" style="white-space:nowrap">Tracking</th>
  ```

  In the `<tbody>` rows, find the `<td>` for shipping cost and add after it:
  ```html
  <td x-show="statusFilter === 'Sold'" class="num">
    <span x-show="$store.dw.str(r, F.trackingId)">
      <span x-show="trackingData[r.id]" :class="'badge ' + trackStatusBadge(trackingData[r.id]?.status)" x-text="trackStatusLabel(trackingData[r.id]?.status)"></span>
      <span x-show="!trackingData[r.id] && !trackingLoading" style="color:var(--muted);font-size:11px">—</span>
    </span>
    <span x-show="!$store.dw.str(r, F.trackingId)" style="color:var(--muted);font-size:11px">—</span>
  </td>
  ```

  **Important:** Use targeted Read with offset/limit to find the exact lines before editing. Never read the full HTML file.

- [ ] **Step 3: Verify manually**

  Switch to Items view, filter to "Sold". Tracking column should appear and populate with status badges for any sold items that have a `trackingId`.

- [ ] **Step 4: Commit**

  ```bash
  git add public/v2/js/views/items.js public/v2/index.html
  git commit -m "feat: add tracking status column to Sold items view ref #19"
  ```

---

## Task 8: Item Modal — Tracking Section

**Files:**
- Modify: `public/v2/js/modals/item-modal.js`
- Modify: `public/v2/index.html` (targeted edit — add tracking section to read view)

- [ ] **Step 1: Add tracking state and fetch to `item-modal.js`**

  Add to the data properties:
  ```js
  trackingInfo:    null,   // { status, carrier, estDelivery, events, publicUrl }
  trackingLoading: false,
  ```

  **`item-modal.js` already has one `$watch('$store.dw.activeRecordId', ...)` in `init()` (lines 11–15). Do NOT add a second watcher — extend the existing one** to also reset tracking state and call `_loadTracking()`:

  Replace the existing watcher:
  ```js
  // EXISTING (replace this):
  init() {
    this.$watch('$store.dw.activeRecordId', () => {
      this.editMode = false;
      this.saveMsg  = '';
      this.form     = {};
    });
  },
  ```
  With:
  ```js
  // UPDATED:
  init() {
    this.$watch('$store.dw.activeRecordId', () => {
      this.editMode        = false;
      this.saveMsg         = '';
      this.form            = {};
      this.trackingInfo    = null;
      this.trackingLoading = false;
      this._loadTracking();
    });
    // Dual-path: handle case where modal opens with record already set
    if (Alpine.store('dw').activeRecordId) this._loadTracking();
  },
  ```

  Add the method:
  ```js
  async _loadTracking() {
    const r = this.record;
    if (!r) return;
    const tid = Alpine.store('dw').str(r, F.trackingId);
    if (!tid) return;
    this.trackingLoading = true;
    this.trackingInfo    = await Alpine.store('dw').fetchTracker(tid);
    this.trackingLoading = false;
  },

  get trackStatusBadgeClass() {
    const s = this.trackingInfo?.status;
    switch (s) {
      case 'delivered':        return 'badge-sold';
      case 'out_for_delivery': return 'badge-pending';
      case 'in_transit':       return 'badge-listed';
      case 'return_to_sender':
      case 'failure':          return 'badge-prepping';
      default:                 return 'badge-other';
    }
  },

  get trackStatusLabel() {
    const s = this.trackingInfo?.status;
    if (!s) return '—';
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },

  get trackEstDelivery() {
    const raw = this.trackingInfo?.estDelivery;
    if (!raw) return null;
    return new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },
  ```

- [ ] **Step 2: Add tracking section HTML to item modal read view**

  Grep for `Date Sold` in index.html to find its line number. The tracking section goes after the "Date Sold" row and before the `<div style="font-size:10px...">` ID row.

  Insert:
  ```html
          <template x-if="record && $store.dw.str(record, F.trackingId)">
            <div>
              <hr class="modal-divider">
              <div class="modal-section-label">Shipment</div>
              <div class="modal-row" x-show="trackingLoading">
                <span style="color:var(--muted);font-size:12px">Loading tracking...</span>
              </div>
              <template x-if="trackingInfo && !trackingLoading">
                <div>
                  <div class="modal-row">
                    <span class="modal-field">Status</span>
                    <span class="modal-val">
                      <span :class="'badge ' + trackStatusBadgeClass" x-text="trackStatusLabel"></span>
                    </span>
                  </div>
                  <div class="modal-row" x-show="trackingInfo.carrier">
                    <span class="modal-field">Carrier</span>
                    <span class="modal-val" style="color:var(--muted)" x-text="trackingInfo.carrier"></span>
                  </div>
                  <div class="modal-row" x-show="trackEstDelivery">
                    <span class="modal-field">Est. Delivery</span>
                    <span class="modal-val" style="color:var(--muted)" x-text="trackEstDelivery"></span>
                  </div>
                  <div class="modal-row" x-show="trackingInfo.publicUrl">
                    <span class="modal-field">Track</span>
                    <span class="modal-val">
                      <a :href="trackingInfo.publicUrl" target="_blank" style="font-size:11px">↗ View Tracker</a>
                    </span>
                  </div>
                  <template x-if="trackingInfo.events && trackingInfo.events.length > 0">
                    <div style="margin-top:8px">
                      <div class="modal-field" style="margin-bottom:6px;font-size:10px">TIMELINE</div>
                      <template x-for="(evt, i) in trackingInfo.events.slice().reverse()" :key="i">
                        <div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-top:1px solid var(--border)">
                          <div style="font-size:10px;color:var(--muted);white-space:nowrap;min-width:60px" x-text="evt.datetime ? new Date(evt.datetime).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''"></div>
                          <div style="font-size:11px;color:var(--muted)" x-text="evt.message"></div>
                        </div>
                      </template>
                    </div>
                  </template>
                </div>
              </template>
              <div class="modal-row" x-show="!trackingInfo && !trackingLoading">
                <a x-show="$store.dw.str(record, F.trackerUrl)" :href="$store.dw.str(record, F.trackerUrl)" target="_blank" style="font-size:11px">↗ View Tracker</a>
                <span x-show="!$store.dw.str(record, F.trackerUrl)" style="color:var(--muted);font-size:11px">Tracking unavailable</span>
              </div>
            </div>
          </template>
  ```

- [ ] **Step 3: Verify manually**

  Open an item modal for a sold item that has `trackingId` set. The Shipment section should appear, show status badge, carrier, estimated delivery, a link to the public tracker, and a timeline of events.

- [ ] **Step 4: Commit**

  ```bash
  git add public/v2/js/modals/item-modal.js public/v2/index.html
  git commit -m "feat: add tracking section to item modal read view ref #19"
  ```

---

## Final Verification Checklist

Ask Geoff to check each surface manually:

- [ ] Shipping modal opens from sidebar, shows in-transit items with live status badges
- [ ] REFRESH ALL button re-fetches and updates statuses
- [ ] Dashboard "In Transit" panel appears (when items have tracking), hides when all delivered
- [ ] Items view Sold filter shows Tracking column with status badges
- [ ] Item modal shows Shipment section with status, carrier, est. delivery, timeline, public URL link
- [ ] Purchasing a new label (test mode) saves `trackingId`, `trackingNumber`, `trackerUrl` to Airtable
