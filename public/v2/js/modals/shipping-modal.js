// ── Shipping Modal — Tracking Panel ──────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('shippingModal', () => ({
    loading:      false,
    refreshing:   false,
    locations:    {},
    errMsg:       '',

    init() {
      this.$watch('$store.dw.activeModal', val => {
        if (val === 'shipping') this._open();
      });
    },

    async _open() {
      this.loading   = true;
      this.errMsg    = '';
      this.locations = {};
      await Alpine.store('dw').loadTrackers();   // refresh the shared tracker cache on open
      await this._fetchLocations(this.inTransitRecords);
      this.loading = false;
    },

    get inTransitRecords() {
      const dw = Alpine.store('dw');
      return dw.records.filter(r => dw.isInTransit(r));
    },

    async refreshAll() {
      this.refreshing = true;
      this.locations  = {};
      await Alpine.store('dw').loadTrackers();
      await this._fetchLocations(this.inTransitRecords);
      this.refreshing = false;
    },

    async _fetchLocations(records) {
      const skus = [...new Set(records.map(r => r.sku).filter(Boolean))];
      const results = await Promise.all(skus.map(async sku => {
        try {
          const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`);
          if (!res.ok) return { sku, location: null };
          const data = await res.json();
          return { sku, location: data.location || null };
        } catch { return { sku, location: null }; }
      }));
      const map = {};
      results.forEach(({ sku, location }) => { map[sku] = location; });
      this.locations = map;
    },

    openItem(r) {
      Alpine.store('dw').openModal('item', r.id);
    },

    trackStatus(r) {
      return Alpine.store('dw').trackerFor(r.shipment)?.status || null;
    },

    trackCarrier(r) {
      return Alpine.store('dw').trackerFor(r.shipment)?.carrier || 'n/a';
    },

    trackEstDelivery(r) {
      const raw = Alpine.store('dw').trackerFor(r.shipment)?.estDelivery;
      if (!raw) return null;
      return new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    trackPublicUrl(r) {
      return Alpine.store('dw').trackerFor(r.shipment)?.publicUrl || r.shipment?.tracker_url || null;
    },

    statusBadgeClass(status) {
      switch (status) {
        case 'delivered':        return 'badge-sold';       // green
        case 'out_for_delivery': return 'badge-pending';    // yellow
        case 'in_transit':       return 'badge-listed';     // blue
        case 'return_to_sender':
        case 'failure':          return 'badge-prepping';   // red
        default:                 return 'badge-other';      // muted
      }
    },

    statusLabel(status) {
      if (!status) return 'Unknown';
      return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },
  }));
});
