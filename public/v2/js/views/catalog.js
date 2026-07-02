// ── Catalog Intake View ────────────────────────────────────────────────────────
function _traffic(row) {
  const lid = row.ebay_listing_id;
  return lid ? (Alpine.store('dw').trafficMap[lid] || null) : null;
}

document.addEventListener('alpine:init', () => {
  Alpine.data('catalogView', () => ({
    // form state
    nextDiscNum:       null,
    box:               localStorage.getItem('catalog_box') || '',
    manufacturer:      '',
    manufacturerQuery: '',
    manufacturerOpen:  false,
    manufacturerIndex: -1,
    mold:              '',
    moldNew:          '',
    type:             '',
    plastic:          '',
    plasticNew:       '',
    run:           '',
    notes:         '',
    condition:     'NEW',
    weight:        '',
    color:         '',
    listPrice:     '',

    // flight number display (read-only, from DB lookup)
    flightData:    null,

    // ui state
    manufacturers: [],
    molds:         [],
    plastics:      [],
    toast:         null,   // { msg, ok }
    submitting:    false,

    // inventory list
    inventory:        [],
    inventoryLoading: false,
    inventoryErr:     '',
    inventoryShowSold: false,
    invStatusFilter:  'all',   // all | Prepping | Listed — catalog list status scope
    editingSku:       null,
    editLocation:     '',
    editPairs:        [],  // [{ key, value }] — flattened metadata blob
    editSaving:       false,
    ebayPreview:      {},  // sku -> { title, price, autoDecline, description } | { error } | 'loading'
    ebayUpdating:     {},  // sku -> true while PUT in flight
    priceEditSku:     null,
    priceEditVal:     '',
    ebayQueue:        [],  // skus edited and waiting for batch update
    ebayBatchRunning: false,
    ebayBatchResults: {},  // sku -> { ok, url, error }
    ebayBatchProgress: { done: 0, total: 0 },
    // bulk list to eBay (web listing, #139)
    blkRange:     '',
    blkPerDisc:   2,
    blkFiles:     [],
    blkDiscs:     [],      // resolved Prepping discs [{id, sku, title, price, metadata}]
    blkCounts:    {},      // { id: photoCount } from disk (photo-status) — the preview truth
    blkNonce:     0,       // cache-bust for thumbnails after a re-upload
    blkUploading: false,
    blkListing:   false,
    blkResults:   {},      // id -> { ok, url, error }
    blkProgress:  { done: 0, total: 0 },
    invSortKey: 'sku',
    invSortDir: 'asc',

    TYPES:  ['Distance Driver', 'Fairway Driver', 'Midrange Disc', 'Putting Disc'],
    COLORS: [
      'Beige','Black','Blue','Bronze','Brown','Gold','Gray','Green',
      'Multi-Color','Orange','Pink','Purple','Red','Silver','White','Yellow',
    ],

    get mfgFiltered() {
      if (!this.manufacturerQuery) return this.manufacturers;
      const q = this.manufacturerQuery.toLowerCase();
      return this.manufacturers.filter(m => m.toLowerCase().includes(q));
    },

    get sortedInventory() {
      const dir = this.invSortDir === 'asc' ? 1 : -1;
      const rows = this.invStatusFilter === 'all'
        ? this.inventory
        : this.inventory.filter(r => r.item_status === this.invStatusFilter);
      return [...rows].sort((a, b) => {
        let av, bv;
        const k = this.invSortKey;
        if (k === 'sku') {
          const an = parseInt((a.sku || '').replace(/^DWG-0*/i, ''), 10);
          const bn = parseInt((b.sku || '').replace(/^DWG-0*/i, ''), 10);
          return dir * (an - bn);
        }
        if (k === 'location')     { av = a.location || ''; bv = b.location || ''; }
        if (k === 'manufacturer') { av = a.metadata?.manufacturer || ''; bv = b.metadata?.manufacturer || ''; }
        if (k === 'mold')         { av = a.metadata?.mold || '';         bv = b.metadata?.mold || ''; }
        if (k === 'title')        { av = this.inventoryDisplayTitle(a);  bv = this.inventoryDisplayTitle(b); }
        if (k === 'price')        { return dir * ((this.displayPrice(a) || 0) - (this.displayPrice(b) || 0)); }
        if (k === 'views')        { return dir * ((_traffic(a)?.views ?? -1) - (_traffic(b)?.views ?? -1)); }
        if (k === 'impressions')  { return dir * ((_traffic(a)?.impressions ?? -1) - (_traffic(b)?.impressions ?? -1)); }
        if (k === 'ctr')          { return dir * ((_traffic(a)?.ctr ?? -1) - (_traffic(b)?.ctr ?? -1)); }
        if (av === undefined) return 0;
        return dir * av.localeCompare(bv);
      });
    },

    selectManufacturer(m) {
      this.manufacturer      = m;
      this.manufacturerQuery = m;
      this.manufacturerOpen  = false;
      this.manufacturerIndex = -1;
      this._fetchMolds();
      this._fetchPlastics();
      this._fetchFlightNumbers();
    },

    mfgKeydown(e) {
      if (!this.manufacturerOpen) return;
      const list = this.mfgFiltered;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.manufacturerIndex = Math.min(this.manufacturerIndex + 1, list.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.manufacturerIndex = Math.max(this.manufacturerIndex - 1, -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.manufacturerIndex >= 0 && list[this.manufacturerIndex]) {
          this.selectManufacturer(list[this.manufacturerIndex]);
        } else if (list.length === 1) {
          this.selectManufacturer(list[0]);
        }
      }
    },

    async init() {
      const savedSort = dwSortable.load('catalog', 'sku', 'asc');
      this.invSortKey = savedSort.col;
      this.invSortDir = savedSort.dir;
      await Promise.all([this._fetchNextDiscNum(), this._fetchManufacturers(), this._fetchMolds(), this._fetchPlastics()]);
      this.$watch('mold',    () => { this.type = ''; this._fetchFlightNumbers(); });
      this.$watch('moldNew', () => { this.type = ''; this._fetchFlightNumbers(); });
      this.$watch('$store.dw.activeView', val => { if (val === 'catalog') this.loadInventory(); });
      if (this.$store.dw.activeView === 'catalog') this.loadInventory();
    },

    async _fetchNextDiscNum() {
      const res  = await fetch('/api/catalog-intake/next-disc-num');
      const data = await res.json();
      this.nextDiscNum = data.nextDiscNum;
    },

    async _fetchManufacturers() {
      const res  = await fetch('/api/catalog-intake/manufacturers');
      const data = await res.json();
      this.manufacturers = data.manufacturers || [];
    },

    async _fetchMolds() {
      const mfg = this.manufacturer || this.manufacturerQuery;
      const url = mfg ? `/api/catalog-intake/molds?manufacturer=${encodeURIComponent(mfg)}` : '/api/catalog-intake/molds';
      const res  = await fetch(url);
      const data = await res.json();
      this.molds = data.molds || [];
      this.mold  = '';
    },

    async _fetchPlastics() {
      const mfg = this.manufacturer || this.manufacturerQuery;
      const url = mfg ? `/api/catalog-intake/plastics?manufacturer=${encodeURIComponent(mfg)}` : '/api/catalog-intake/plastics';
      const res  = await fetch(url);
      const data = await res.json();
      this.plastics = data.plastics || [];
      this.plastic  = '';
    },

    async submit() {
      if (this.submitting) return;
      const missing = [];
      if (!this.box)                                    missing.push('Box');
      if (!this.manufacturerQuery)                       missing.push('Manufacturer');
      if (!this.moldNew && !this.mold)                  missing.push('Mold');
      if (!this.type)                                   missing.push('Type');
      if (!this.plasticNew && !this.plastic)            missing.push('Plastic');
      if (!this.weight)       missing.push('Weight');
      if (!this.color)        missing.push('Color');
      if (!this.listPrice)    missing.push('List Price');
      if (missing.length) {
        this._showToast(`Missing: ${missing.join(', ')}`, false);
        return;
      }
      this.submitting = true;
      try {
        const res  = await fetch('/api/catalog-intake/disc', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            discNum:      this.nextDiscNum,
            box:          this.box,
            manufacturer: this.manufacturer || this.manufacturerQuery,
            mold:         this.moldNew || this.mold,
            type:         this.type,
            plastic:      this.plasticNew || this.plastic,
            run:          this.run,
            notes:        this.notes,
            condition:    this.condition,
            weight:       this.weight,
            color:        this.color,
            listPrice:    this.listPrice,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        this._showToast(`Disc #${data.discNum} saved`, true);
        localStorage.setItem('catalog_box', this.box);
        this._reset(data.discNum + 1);
        this.loadInventory();   // surface the just-saved disc in the list below
      } catch (err) {
        this._showToast(err.message, false);
      } finally {
        this.submitting = false;
      }
    },

    async _fetchFlightNumbers() {
      const mfg  = this.manufacturer || this.manufacturerQuery;
      const mold = this.moldNew || this.mold;
      if (!mfg || !mold) { this.flightData = null; return; }
      try {
        const res  = await fetch(`/api/flight-numbers?manufacturer=${encodeURIComponent(mfg)}&mold=${encodeURIComponent(mold)}`);
        const data = await res.json();
        this.flightData = data.found ? data : null;
        if (data.found && !this.type) {
          const s = data.speed;
          if (s >= 10)     this.type = 'Distance Driver';
          else if (s >= 6) this.type = 'Fairway Driver';
          else if (s >= 4) this.type = 'Midrange Disc';
          else             this.type = 'Putting Disc';
        }
      } catch { this.flightData = null; }
    },

    _reset(nextNum) {
      this.nextDiscNum       = nextNum;
      this.manufacturer      = '';
      this.manufacturerQuery = '';
      this.manufacturerOpen  = false;
      this.manufacturerIndex = -1;
      this.mold             = '';
      this.moldNew          = '';
      this.type             = '';
      this.plastic          = '';
      this.plasticNew       = '';
      this.run          = '';
      this.notes        = '';
      this.condition    = 'NEW';
      this.weight       = '';
      this.color        = '';
      this.listPrice    = '';
      this.flightData   = null;
      // box kept as-is
      this.$nextTick(() => this.$el.querySelector('[data-focus]')?.focus());
    },

    // Price to show/sort/seed: the listing row owns it once a disc is listed
    // (#134); the blob's listPrice is intake staging, shown only pre-list.
    displayPrice(row) {
      return row.listing_price ?? row.metadata?.listPrice ?? null;
    },

    inventoryDisplayTitle(row) {
      // items.name is the canonical materialized title (#134). Fall back to the
      // blob-composed string only for a row with no item yet (shouldn't happen).
      if (row.item_name) return row.item_name;
      const m = row.metadata || {};
      if (m.list_title) return m.list_title;
      if (row.category === 'disc') {
        const parts = [m.manufacturer, m.mold, m.plastic, m.weight ? m.weight + 'g' : '', m.color].filter(Boolean);
        return parts.length ? parts.join(' ') : '—';
      }
      return '—';
    },

    async loadInventory() {
      this.inventoryLoading = true;
      this.inventoryErr     = '';
      try {
        const url  = this.inventoryShowSold ? '/api/inventory' : '/api/inventory?excludeStatus=sold';
        const res  = await fetch(url);
        const data = await res.json();
        this.inventory = data.inventory || [];
        this.loadTraffic();
        this.blkLoadPhotoStatus();   // populate the bulk-list ready set on load
      } catch (e) {
        this.inventoryErr = e.message;
      }
      this.inventoryLoading = false;
    },

    async loadTraffic() {
      const dw = Alpine.store('dw');
      if (Object.keys(dw.trafficMap).length > 0) return;
      const ids = this.inventory.map(r => r.ebay_listing_id).filter(Boolean);
      if (!ids.length) return;
      dw.trafficLoading = true;
      try {
        const data = await fetch('/api/ebay/traffic', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ listingIds: ids }),
        }).then(r => r.json());
        Object.assign(dw.trafficMap, data.listings || {});
      } catch (e) {
        console.warn('[catalog] traffic fetch failed:', e.message);
      }
      dw.trafficLoading = false;
    },

    startEdit(row) {
      this.editingSku   = row.sku;
      this.editLocation = row.location || '';
      this.editPairs    = Object.entries(row.metadata || {}).map(([key, value]) => ({ key, value: value ?? '' }));
    },

    cancelEdit() {
      this.editingSku   = null;
      this.editLocation = '';
      this.editPairs    = [];
    },

    invSortBy(key) {
      if (this.invSortKey === key) {
        this.invSortDir = this.invSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.invSortKey = key;
        this.invSortDir = key === 'sku' ? 'asc' : 'desc';
      }
      dwSortable.save('catalog', this.invSortKey, this.invSortDir);
    },

    invSortGlyph(key) {
      if (this.invSortKey !== key) return '';
      return this.invSortDir === 'asc' ? ' ↑' : ' ↓';
    },

    async saveEdit() {
      this.editSaving = true;
      try {
        const metadata = {};
        this.editPairs.forEach(({ key, value }) => { if (key) metadata[key] = value; });
        const res = await fetch(`/api/inventory/${encodeURIComponent(this.editingSku)}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ location: this.editLocation, metadata }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const sku = this.editingSku;
        this.cancelEdit();
        if (!this.ebayQueue.includes(sku)) this.ebayQueue = [...this.ebayQueue, sku];
        delete this.ebayBatchResults[sku];
        this.loadInventory();   // refresh join fields (item_name may have re-materialized)
      } catch (e) {
        this.inventoryErr = e.message;
      }
      this.editSaving = false;
    },

    async ebayPreviewDisc(row) {
      const sku  = row.sku;
      const disc = { id: parseInt(sku.replace(/^DWG-0*/i, ''), 10), ...row.metadata };
      this.ebayPreview = { ...this.ebayPreview, [sku]: 'loading' };
      try {
        const res  = await fetch('/api/ebay/bulk-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disc }),
        });
        const data = await res.json();
        this.ebayPreview = { ...this.ebayPreview, [sku]: data };
      } catch (e) {
        this.ebayPreview = { ...this.ebayPreview, [sku]: { error: e.message } };
      }
    },

    ebayCancelPreview(sku) {
      const p = { ...this.ebayPreview };
      delete p[sku];
      this.ebayPreview = p;
    },

    async ebayConfirmUpdate(row) {
      const sku  = row.sku;
      const disc = { id: parseInt(sku.replace(/^DWG-0*/i, ''), 10), ...row.metadata };
      this.ebayUpdating = { ...this.ebayUpdating, [sku]: true };
      try {
        const res  = await fetch('/api/ebay/bulk-update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disc }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        this.ebayPreview = { ...this.ebayPreview, [sku]: { ...this.ebayPreview[sku], result: 'updated', url: data.url } };
      } catch (e) {
        this.ebayPreview = { ...this.ebayPreview, [sku]: { ...this.ebayPreview[sku], result: e.message } };
      }
      const u = { ...this.ebayUpdating };
      delete u[sku];
      this.ebayUpdating = u;
    },

    async ebayBatchUpdate() {
      this.ebayBatchRunning = true;
      const skus = [...this.ebayQueue];
      this.ebayBatchProgress = { done: 0, total: skus.length };
      for (const sku of skus) {
        const row = this.inventory.find(r => r.sku === sku);
        if (!row) continue;
        const disc = { id: parseInt(sku.replace(/^DWG-0*/i, ''), 10), ...row.metadata };
        try {
          const res  = await fetch('/api/ebay/bulk-update', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disc }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          this.ebayBatchResults = { ...this.ebayBatchResults, [sku]: { ok: true, url: data.url } };
        } catch (e) {
          this.ebayBatchResults = { ...this.ebayBatchResults, [sku]: { ok: false, error: e.message } };
        }
        this.ebayQueue = this.ebayQueue.filter(s => s !== sku);
        this.ebayBatchProgress = { ...this.ebayBatchProgress, done: this.ebayBatchProgress.done + 1 };
      }
      this.ebayBatchRunning = false;
    },

    // ── Bulk list to eBay (web listing, #139) ──────────────────────────────
    // Resolve the Prepping discs named by the DWG range, ascending.
    blkResolveDiscs() {
      const ids = new Set();
      for (const seg of (this.blkRange || '').split(',')) {
        const parts = seg.trim().split('-').map(s => parseInt(s, 10));
        if (parts.length === 1 && !isNaN(parts[0])) ids.add(parts[0]);
        else if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          for (let i = parts[0]; i <= parts[1]; i++) ids.add(i);
        }
      }
      this.blkDiscs = this.inventory
        .filter(r => r.item_status === 'Prepping' && r.category === 'disc')
        .map(r => this._blkDisc(r))
        .filter(d => ids.has(d.id))
        .sort((a, b) => a.id - b.id);
      this.blkLoadPhotoStatus();   // preview reflects what's already on disk (accumulating)
    },

    _blkDisc(r) {
      return {
        id:       parseInt(r.sku.replace(/^DWG-0*/i, ''), 10),
        sku:      r.sku,
        title:    this.inventoryDisplayTitle(r),
        price:    this.displayPrice(r),
        metadata: r.metadata,
      };
    },

    // Every Prepping disc that has photos on disk — the accumulated "ready to list"
    // set, independent of the current range. This is what BULK LIST acts on.
    get blkReadyDiscs() {
      return this.inventory
        .filter(r => r.item_status === 'Prepping' && r.category === 'disc')
        .map(r => this._blkDisc(r))
        .filter(d => (this.blkCounts[d.id] || 0) > 0)
        .sort((a, b) => a.id - b.id);
    },

    // What the preview shows: the current range (to see upload targets awaiting
    // photos) UNION everything already ready — so narrowing the range to re-shoot
    // a few SKUs never drops the rest of the batch.
    get blkPreview() {
      const byId = new Map();
      for (const d of this.blkReadyDiscs) byId.set(d.id, d);
      for (const d of this.blkDiscs)      byId.set(d.id, d);
      return [...byId.values()].sort((a, b) => a.id - b.id);
    },

    // The preview is disk-backed: photo-status gives per-disc counts, and the
    // URLs are deterministic (DWG-{id}-{n}.jpeg), so any range re-reads the truth
    // on disk — earlier uploads survive a range change; a re-upload just overwrites.
    async blkLoadPhotoStatus() {
      try {
        const data = await fetch('/api/ebay/photo-status').then(r => r.json());
        this.blkCounts = data.counts || {};
        this.blkNonce  = Date.now();   // bust cached thumbnails after a re-upload
      } catch (e) { /* non-fatal — preview just shows no photos */ }
    },

    blkPhotoUrls(d) {
      const n = this.blkCounts[d.id] || 0;
      return Array.from({ length: n }, (_, i) => `/dg-photos/DWG-${d.id}-${i + 1}.jpeg?v=${this.blkNonce}`);
    },

    // Upload the photo pile; server chunks by N and maps to the discs ascending,
    // then we re-read disk so the preview shows the new truth.
    async blkUploadPhotos() {
      if (!this.blkDiscs.length || !this.blkFiles.length) return;
      this.blkUploading = true;
      try {
        const fd = new FormData();
        fd.append('perDisc', this.blkPerDisc);
        fd.append('discIds', JSON.stringify(this.blkDiscs.map(d => d.id)));
        this.blkFiles.forEach(f => fd.append('photos', f));
        const res  = await fetch('/api/ebay/bulk-list-photos', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        this.blkFiles = [];                 // consumed
        await this.blkLoadPhotoStatus();     // refresh preview from disk
      } catch (e) {
        this.inventoryErr = e.message;
      }
      this.blkUploading = false;
    },

    // List every ready disc (Prepping + has photos), regardless of the range.
    async blkList() {
      const toList = this.blkReadyDiscs;
      if (!toList.length) return;
      this.blkListing  = true;
      this.blkProgress = { done: 0, total: toList.length };
      for (const d of toList) {
        try {
          const fd = new FormData();
          fd.append('disc', JSON.stringify({ id: d.id, ...(d.metadata || {}) }));
          const res  = await fetch('/api/ebay/bulk-list', { method: 'POST', body: fd });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          this.blkResults = { ...this.blkResults, [d.id]: { ok: true, url: data.url } };
        } catch (e) {
          this.blkResults = { ...this.blkResults, [d.id]: { ok: false, error: e.message } };
        }
        this.blkProgress = { ...this.blkProgress, done: this.blkProgress.done + 1 };
      }
      this.blkListing = false;
      await this.blkLoadPhotoStatus();
      this.loadInventory();   // Prepping -> Listed, refresh the list
    },

    startPriceEdit(row, seed = null) {
      this.priceEditSku = row.sku;
      this.priceEditVal = seed !== null ? Number(seed) : (this.displayPrice(row) ?? '');
      this.$nextTick(() => document.getElementById('price-input-' + row.sku)?.focus());
    },

    cancelPriceEdit() {
      this.priceEditSku = null;
      this.priceEditVal = '';
    },

    focusPriceQueue(sku) {
      document.getElementById('price-queue-' + sku)?.focus();
    },

    async savePriceEdit(row) {
      const sku      = row.sku;
      const newPrice = this.priceEditVal;
      try {
        const idx = this.inventory.findIndex(r => r.sku === sku);
        if (row.listing_id) {
          // Listed: the listing row owns the live price (#134). Write it there and
          // queue the eBay push; the blob's listPrice is staging, ignored post-mint.
          const res = await fetch(`/api/listings/${row.listing_id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ list_price: newPrice }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (idx !== -1) this.inventory[idx] = { ...this.inventory[idx], listing_price: newPrice };
        } else {
          // Not yet listed: stage the price on the blob.
          const metadata = { ...(row.metadata || {}), listPrice: newPrice };
          const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const updated = await res.json();
          if (idx !== -1) this.inventory[idx] = { ...this.inventory[idx], metadata: updated.metadata };
        }
        if (!this.ebayQueue.includes(sku)) this.ebayQueue = [...this.ebayQueue, sku];
        delete this.ebayBatchResults[sku];
      } catch (e) {
        this.inventoryErr = e.message;
      }
      this.cancelPriceEdit();
    },

    async savePriceEditAndAdvance(row) {
      const sku = row.sku;
      await this.savePriceEdit(row);
      this.$nextTick(() => {
        const priceSpans = Array.from(this.$el.querySelectorAll('span.price-cell[tabindex="0"]'));
        const idx = priceSpans.findIndex(el => el.dataset.sku === sku);
        if (idx !== -1 && priceSpans[idx + 1]) priceSpans[idx + 1].focus();
      });
    },

    _showToast(msg, ok) {
      this.toast = { msg, ok };
      setTimeout(() => { this.toast = null; }, ok ? 2000 : 5000);
    },
  }));
});
