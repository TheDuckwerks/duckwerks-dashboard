// ── Duckwerks v2 — Alpine Store ───────────────────────────────────────────────
// Single source of truth. All API calls happen here.
// Views and modals read $store.dw.* — they never call the API directly.

document.addEventListener('alpine:init', () => {
  Alpine.store('dw', {

    // ── State ─────────────────────────────────────────────────────────────────
    records:          [],
    _lots:            [],        // raw lot rows from /api/lots
    categories:       [],        // from /api/categories
    sites:            [],        // from /api/sites
    loading:          false,
    error:            null,
    activeView:       'dashboard',
    activeModal:      null,
    activeRecordId:   null,
    activeEbayOrderId:     null,
    activeEbayLineItemIds: [],
    activeEbayOrderRecs:   [],
    activeReverbOrderNum: null,
    activeLotName:    null,
    previousModal:    null,
    previousView:     null,
    orderCount:         null,
    ordersRefreshTick:  0,
    checkingOrders:     false,
    categoryFilter:   null,
    pendingFilters:   null,
    pendingComp:      null,
    shippingProvider: 'EASYPOST',
    hostname:         '',
    environment:      '',
    trafficMap:       {},   // { [legacyListingId]: { views, impressions, ctr } } — session cache
    trafficLoading:   false,

    // ── Init ──────────────────────────────────────────────────────────────────
    async init() {
      const saved = localStorage.getItem('dw-view');
      if (saved && ['dashboard', 'items', 'lots', 'analytics'].includes(saved)) {
        this.activeView = saved;
      }
      Alpine.effect(() => { localStorage.setItem('dw-view', this.activeView); });

      try {
        const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
        if (cfg.shippingProvider) this.shippingProvider = cfg.shippingProvider;
        if (cfg.hostname)         this.hostname         = cfg.hostname;
        if (cfg.environment)      this.environment      = cfg.environment;
        await this.fetchAll();
        setInterval(() => this.checkOrders(), DwNotifications.pollIntervalMs);
      } catch (e) {
        this.error = 'Failed to initialize: ' + e.message;
      }
    },

    // ── Data Fetch ────────────────────────────────────────────────────────────
    async fetchAll() {
      this.loading = true;
      this.error   = null;
      try {
        const [items, lots, cats, sites] = await Promise.all([
          fetch('/api/items').then(r => { if (!r.ok) throw new Error('items fetch failed'); return r.json(); }),
          fetch('/api/lots').then(r => { if (!r.ok) throw new Error('lots fetch failed'); return r.json(); }),
          fetch('/api/categories').then(r => r.json()).catch(() => []),
          fetch('/api/sites').then(r => r.json()).catch(() => []),
        ]);
        this.records    = items;
        this._lots      = lots;
        this.categories = cats;
        this.sites      = sites;
      } catch (e) {
        this.error = 'Failed to load records: ' + e.message;
      } finally {
        this.loading = false;
      }
    },

    // ── Modal Helpers ─────────────────────────────────────────────────────────
    async printLabel(zplUrl, fallbackUrl) {
      if (!zplUrl && !fallbackUrl) return;
      try {
        const res = await fetch('/api/print/label', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: zplUrl }),
        });
        if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      } catch(e) {
        console.warn('[printLabel] print failed, falling back to window.open:', e.message);
        if (fallbackUrl) window.open(fallbackUrl, '_blank');
      }
    },
    openModal(type, recordId = null, lotName = null) {
      this.activeModal    = type;
      this.activeRecordId = recordId;
      this.activeLotName  = lotName;
    },
    trapTab(e, el) {
      const sel = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const els = Array.from(el.querySelectorAll(sel)).filter(e => e.offsetParent !== null);
      if (!els.length) return;
      const idx = els.indexOf(document.activeElement);
      if (e.shiftKey) {
        e.preventDefault();
        els[idx <= 0 ? els.length - 1 : idx - 1].focus();
      } else {
        e.preventDefault();
        els[idx >= els.length - 1 ? 0 : idx + 1].focus();
      }
    },
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
        const ebayCount   = (ebayData.orders   || []).filter(o => (o.lineItems || []).length > 0).length;
        const reverbCount = (reverbData.orders || []).length;
        this.orderCount = ebayCount + reverbCount;
        DwNotifications.checkAndNotify(this.orderCount);
        if (this.orderCount === 0) {
          setTimeout(() => { if (this.orderCount === 0) this.orderCount = null; }, 2000);
        }
      } catch(e) {
        this.orderCount = null;
      } finally {
        this.checkingOrders = false;
      }
    },

    navToComp(r) {
      const parts    = r.name.split(' - ');
      const name     = parts[0].trim();
      const notes    = parts.slice(1).join(' - ').trim();
      const site     = this.siteLabel(r).toLowerCase();
      const sources  = (site === 'ebay' || site === 'reverb') ? site : 'ebay';
      const listPrice = this.activeListing(r)?.list_price || 0;
      const minPrice  = listPrice ? String(Math.round(listPrice * 0.6)) : '';
      this.pendingComp = { name, sources, minPrice, notes };
      this.activeView  = 'comps';
    },

    navToItems(status, category, site) {
      this.pendingFilters = {
        status:   status   || 'All',
        category: category || null,
        site:     site     || 'All',
      };
      this.previousModal = null;
      this.activeView = 'items';
      this.closeModal();
    },

    // ── Computed record sets ──────────────────────────────────────────────────
    get listedRecords() { return this.records.filter(r => r.status === 'Listed'); },
    get soldRecords()   { return this.records.filter(r => r.status === 'Sold'); },

    // Lots: _lots from API enriched with their items array
    get lots() {
      return this._lots.map(lot => ({
        ...lot,
        items: this.records.filter(r => r.lot?.id === lot.id),
      }));
    },

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Best active listing — highest estimated net (price - shipping - fees) among active listings
    activeListing(r) {
      const active = (r.listings || []).filter(l => l.status === 'active');
      if (!active.length) return r.listings?.[0] || null;
      const estNet = l => {
        const lp   = l.list_price || 0;
        const ship = l.shipping_estimate ?? 7;
        const fee  = l.site ? (l.site.fee_on_shipping ? (lp + ship) * l.site.fee_rate + l.site.fee_flat
                                                      :  lp         * l.site.fee_rate + l.site.fee_flat)
                            : 0;
        return lp - ship - fee;
      };
      return active.reduce((best, l) => estNet(l) > estNet(best) ? l : best, active[0]);
    },

    // Site label — 'Multiple' when item has more than one active listing
    siteLabel(r) {
      const active = (r.listings || []).filter(l => l.status === 'active');
      if (active.length > 1) return 'Multiple';
      return active[0]?.site?.name || this.activeListing(r)?.site?.name || '';
    },

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

    // Listing URL — constructed from site + platform_listing_id; falls back to stored url
    listingUrl(r) {
      const l = this.activeListing(r);
      if (!l) return null;
      if (l.platform_listing_id) {
        const site = l.site?.name;
        if (site === 'eBay')   return `https://www.ebay.com/itm/${l.platform_listing_id}`;
        if (site === 'Reverb') return `https://reverb.com/item/${l.platform_listing_id}`;
      }
      return l.url || null;
    },

    // Est. profit for a listed item.
    // Uses shipment cost if shipped, else listing shipping_estimate, else $7 placeholder.
    // Fees come from listing.site.
    estProfit(r) {
      const listing = this.activeListing(r);
      const lp      = listing?.list_price || 0;
      const cost    = r.cost || 0;

      let ship;
      if (r.shipment?.shipping_cost != null) {
        ship = r.shipment.shipping_cost;
      } else if (listing?.shipping_estimate != null) {
        ship = listing.shipping_estimate;
      } else {
        ship = 7; // placeholder
      }

      let fee = 0;
      if (listing?.site) {
        const s = listing.site;
        fee = s.fee_on_shipping ? (lp + ship) * s.fee_rate + s.fee_flat
                                :  lp         * s.fee_rate + s.fee_flat;
      }
      return lp - cost - ship - fee;
    },

    // Post-fee payout for a listed item (est.)
    payout(r) {
      const listing = this.activeListing(r);
      const lp      = listing?.list_price || 0;
      const ship    = listing?.shipping_estimate ?? 7;
      let fee = 0;
      if (listing?.site) {
        const s = listing.site;
        fee = s.fee_on_shipping ? (lp + ship) * s.fee_rate + s.fee_flat
                                :  lp         * s.fee_rate + s.fee_flat;
      }
      return lp - fee;
    },

    fmt0(n)  { return '$' + Math.round(Math.abs(n)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); },
    fmtK(n)  { return Math.abs(n) >= 1000 ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'K' : this.fmt0(n); },
    pct(a, b){ return b > 0 ? Math.round((a / b) * 100) : 0; },
    fmtMoney(val) {
      if (val == null) return '—';
      if (val === 0)   return '$0';
      return '$' + Math.abs(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
    },
    isZero(val) { return val === 0; },
    allSame(rows, field) {
      if (!rows || rows.length === 0) return true;
      const first = rows[0]?.[field];
      return rows.every(r => r[field] === first);
    },

    get pipeline() {
      return this.records
        .filter(r => r.status === 'Listed')
        .reduce((s, r) => s + this.estProfit(r), 0);
    },

    filteredKpis: null,
    setFilteredKpis(kpis) { this.filteredKpis = kpis; },
    clearFilteredKpis()   { this.filteredKpis = null; },

    toastMsg:    null,
    toastType:   'success',
    _toastTimer: null,

    notify(msg, type = 'success') {
      clearTimeout(this._toastTimer);
      this.toastMsg  = msg;
      this.toastType = type;
      if (type === 'success') {
        this._toastTimer = setTimeout(() => { this.toastMsg = null; }, 3000);
      }
    },
    dismissToast() { this.toastMsg = null; },

    // ── Writes ────────────────────────────────────────────────────────────────
    async updateItem(id, fields, { skipRefresh = false } = {}) {
      const res = await fetch(`/api/items/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      if (!skipRefresh) {
        const updated = await res.json();
        const idx = this.records.findIndex(r => r.id === id);
        if (idx !== -1) this.records[idx] = updated;
      }
      this.notify('Saved', 'success');
    },

    async deleteItem(id) {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      this.records = this.records.filter(r => r.id !== id);
      this.notify('Deleted', 'success');
    },

    async createItem(fields) {
      const res = await fetch('/api/items', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const created = await res.json();
      this.records.push(created);
      this.notify('Item added', 'success');
      return created;
    },

    async createListing(fields) {
      const res = await fetch('/api/listings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create listing failed: ${res.status}`);
      // Refresh item in store (status changed to Listed)
      const itemRes = await fetch(`/api/items`).then(r => r.json());
      this.records = itemRes;
      return await res.json();
    },

    async updateListing(id, fields, { skipRefresh = false } = {}) {
      const res = await fetch(`/api/listings/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update listing failed: ${res.status}`);
      if (!skipRefresh) await this.fetchAll(); // listings are nested in items — full refresh needed
    },

    async createOrder(fields) {
      const res = await fetch('/api/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create order failed: ${res.status}`);
      const created = await res.json(); // capture before fetchAll — body stream can only be read once
      await this.fetchAll();
      return created;
    },

    async updateOrder(id, fields) {
      const res = await fetch(`/api/orders/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update order failed: ${res.status}`);
    },

    async createShipment(fields) {
      const res = await fetch('/api/shipments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Create shipment failed: ${res.status}`);
      const created = await res.json(); // capture before fetchAll — body stream can only be read once
      await this.fetchAll();
      return created;
    },

    async updateShipment(id, fields) {
      const res = await fetch(`/api/shipments/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Update shipment failed: ${res.status}`);
    },

    // ── Tracking ──────────────────────────────────────────────────────────────
    _carrierName(raw) {
      const map = { UPSDAP: 'UPS', UPS: 'UPS', USPS: 'USPS', FedEx: 'FedEx',
                    DHLExpress: 'DHL Express', DHL: 'DHL' };
      return map[raw] || raw || null;
    },

    async fetchTracker(trackingId) {
      if (!trackingId) return null;
      try {
        const res  = await fetch(`/api/label/tracker/${trackingId}`);
        const data = await res.json();
        if (!res.ok || data.skipped) return null;
        const events      = data.tracking_details || [];
        const deliveryEvt = events.find(e => e.status === 'delivered');
        return {
          status:      data.status,
          carrier:     this._carrierName(data.carrier),
          estDelivery: data.est_delivery_date || null,
          deliveredAt: deliveryEvt?.datetime || null,
          events,
          publicUrl:   data.public_url || null,
        };
      } catch (e) {
        console.warn('fetchTracker failed:', e);
        return null;
      }
    },

    isInTransit(r, trackingData) {
      if (r.status !== 'Sold' || !r.shipment?.tracking_id) return false;
      const td = trackingData[r.id];
      if (!td || td.status !== 'delivered') return true;
      if (!td.deliveredAt) return false;
      return (Date.now() - new Date(td.deliveredAt).getTime()) < 3 * 24 * 60 * 60 * 1000;
    },

  });
});
