// ── Items View ────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('itemsView', () => ({
    statusFilter: 'Listed',
    siteFilters:  [],
    dateRange:    'all',
    nameSearch:   '',
    openStatusId: null,
    sortKey:      'createdTime',
    sortDir:      'desc',
    get trackingLoading() { return Alpine.store('dw').trackingLoading; },

    init() {
      document.addEventListener('click', () => { this.openStatusId = null; });
      this.$watch('$store.dw.pendingFilters', v => {
        if (v) {
          this.statusFilter = v.status;
          this.siteFilters  = v.site && v.site !== 'All' ? [v.site] : [];
          Alpine.store('dw').categoryFilter = v.category;
          Alpine.store('dw').pendingFilters = null;
        }
      });
      const saved = dwSortable.load('items', 'createdTime', 'desc');
      this.sortKey = saved.col;
      this.sortDir = saved.dir;
      try {
        const f = JSON.parse(localStorage.getItem('dw_filter_items') || '{}');
        if (f.status)     this.statusFilter = f.status;
        if (f.siteFilters && Array.isArray(f.siteFilters)) this.siteFilters = f.siteFilters;
        if (f.dateRange)  this.dateRange    = f.dateRange;
      } catch {}
      this.$watch('statusFilter',              () => { this._saveFilters(); this._pushFilteredKpis(); });
      this.$watch('siteFilters',               () => { this._saveFilters(); this._pushFilteredKpis(); });
      this.$watch('dateRange',                 () => { this._saveFilters(); this._pushFilteredKpis(); });
      this.$watch('$store.dw.categoryFilter',  () => this._pushFilteredKpis());
      this.$watch('$store.dw.activeView',      v  => { if (v !== 'items') Alpine.store('dw').clearFilteredKpis(); });
      this._pushFilteredKpis();
    },

    get rows() {
      const dw = Alpine.store('dw');
      let recs = dw.records;

      if (dw.categoryFilter) {
        recs = recs.filter(r => r.category?.name === dw.categoryFilter);
      }
      if (this.statusFilter !== 'All') {
        recs = recs.filter(r => r.status === this.statusFilter);
      }
      if (this.siteFilters.length > 0) {
        const sites = dw.sites || [];
        recs = recs.filter(r =>
          this.siteFilters.some(siteName => {
            const target = sites.find(s => s.name === siteName);
            return target && (r.listings || []).some(l => l.site?.id === target.id);
          })
        );
      }
      if (this.dateRange !== 'all') {
        const hours = { '24h': 30, '3d': 72, '7d': 168, '30d': 720 }[this.dateRange];
        const cutoff = new Date(Date.now() - hours * 3600 * 1000);
        if (this.statusFilter === 'Sold') {
          recs = recs.filter(r => r.order?.date_sold && new Date(r.order.date_sold + 'T00:00:00') >= cutoff);
        } else {
          recs = recs.filter(r => r.created_at && new Date(r.created_at) >= cutoff);
        }
      }
      const q = this.nameSearch.trim().toLowerCase();
      if (q) {
        recs = recs.filter(r =>
          (r.name        || '').toLowerCase().includes(q) ||
          (r.sku         || '').toLowerCase().includes(q) ||
          (r.lot?.name   || '').toLowerCase().includes(q) ||
          (r.notes       || '').toLowerCase().includes(q)
        );
      }

      const key = this.sortKey, dir = this.sortDir;
      recs = [...recs].sort((a, b) => {
        let av, bv;
        if      (key === 'createdTime') { av = new Date(a.created_at).getTime(); bv = new Date(b.created_at).getTime(); }
        else if (key === 'name')       { av = a.name.toLowerCase();             bv = b.name.toLowerCase(); }
        else if (key === 'lot')        { av = (a.lot?.name||'').toLowerCase();  bv = (b.lot?.name||'').toLowerCase(); }
        else if (key === 'category')   { av = (a.category?.name||'').toLowerCase(); bv = (b.category?.name||'').toLowerCase(); }
        else if (key === 'site')       { av = dw.siteLabel(a).toLowerCase();   bv = dw.siteLabel(b).toLowerCase(); }
        else if (key === 'status')     { av = a.status.toLowerCase();          bv = b.status.toLowerCase(); }
        else if (key === 'listPrice')  { av = dw.activeListing(a)?.list_price || 0; bv = dw.activeListing(b)?.list_price || 0; }
        else if (key === 'eaf')        { av = dw.payout(a);  bv = dw.payout(b); }
        else if (key === 'profit')     { av = dw.estProfit(a); bv = dw.estProfit(b); }
        else if (key === 'shipping')   { av = dw.activeListing(a)?.shipping_estimate || 0; bv = dw.activeListing(b)?.shipping_estimate || 0; }
        else if (key === 'soldDate')   { av = a.order?.date_sold || ''; bv = b.order?.date_sold || ''; }
        else return 0;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ?  1 : -1;
        return 0;
      });
      return recs;
    },

    // Expands multi-unit items into per-order rows for the Sold table. Single-unit
    // items pass through as-is. _key is the unique x-for key; _trackingId is the row's
    // shipment tracking_id — the key into the shared $store.dw.trackingData cache (#160).
    get soldRows() {
      const rows = [];
      for (const r of this.rows) {
        if (r.quantity > 1) {
          const orders = (r.listings || []).flatMap(l => l.order ? [l.order] : []);
          if (orders.length === 0) {
            rows.push({ _isMultiUnit: true, _item: r, _order: null, _key: `item-${r.id}`, _trackingId: null });
          } else {
            for (const o of orders) {
              rows.push({ _isMultiUnit: true, _item: r, _order: o, _key: `order-${o.id}`, _trackingId: o.shipment?.tracking_id || null });
            }
          }
        } else {
          rows.push({ _isMultiUnit: false, _item: r, _order: r.order || null, _key: `item-${r.id}`, _trackingId: r.order?.shipment?.tracking_id || null });
        }
      }
      return rows;
    },

    sortBy(key) {
      if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { this.sortKey = key; this.sortDir = 'asc'; }
      dwSortable.save('items', this.sortKey, this.sortDir);
    },
    sortGlyph(key) {
      if (this.sortKey !== key) return '↕';
      return this.sortDir === 'asc' ? '↑' : '↓';
    },
    toggleSite(name) {
      const idx = this.siteFilters.indexOf(name);
      if (idx === -1) this.siteFilters = [...this.siteFilters, name];
      else            this.siteFilters = this.siteFilters.filter(s => s !== name);
    },
    clearSites() {
      this.siteFilters = [];
    },

    badgeClass(status) {
      const s = (status || '').toLowerCase();
      if (s === 'listed')   return 'badge-listed';
      if (s === 'sold')     return 'badge-sold';
      if (s === 'prepping') return 'badge-prepping';
      return 'badge-other';
    },
    catBadgeClass(cat) { return CAT_BADGE[cat] || 'badge-other'; },

    eafDisplay(r)  {
      const dw = Alpine.store('dw');
      const lp = dw.activeListing(r)?.list_price || 0;
      return lp > 0 ? dw.fmt0(dw.payout(r)) : 'n/a';
    },
    profitDisplay(r) {
      const dw = Alpine.store('dw');
      const p  = dw.estProfit(r);
      return (p >= 0 ? '+' : '') + dw.fmt0(p);
    },
    shipDisplay(r) {
      const dw = Alpine.store('dw');
      if (r.shipment?.shipping_cost != null) return dw.fmt0(r.shipment.shipping_cost);
      const sold = (r.listings || []).find(l => l.status === 'sold');
      if (sold?.shipping_estimate != null) return dw.fmt0(sold.shipping_estimate);
      const inPerson = ['Facebook', 'Craigslist'].includes(sold?.site?.name);
      if (inPerson) return dw.fmt0(0);
      const l = dw.activeListing(r);
      return l?.shipping_estimate != null ? dw.fmt0(l.shipping_estimate) : '~$7';
    },
    shipIsEst(r) {
      if (r.shipment?.shipping_cost != null) return false;
      const sold = (r.listings || []).find(l => l.status === 'sold');
      if (sold?.shipping_estimate != null) return false;
      if (['Facebook', 'Craigslist'].includes(sold?.site?.name)) return false;
      return Alpine.store('dw').activeListing(r)?.shipping_estimate == null;
    },

    toggleStatusMenu(id, e) { e.stopPropagation(); this.openStatusId = this.openStatusId === id ? null : id; },

    async changeStatus(r, status, e) {
      e.stopPropagation();
      this.openStatusId = null;
      const fields = { status };
      if (status === 'Sold' && !r.order?.date_sold) fields.date_sold = new Date().toISOString().split('T')[0];
      await Alpine.store('dw').updateItem(r.id, fields);
    },

    dateAdded(r) {
      return new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    daysListed(r) {
      return Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
    },
    needsAttention(r) { return r.status === 'Listed' && this.daysListed(r) >= 20; },

    openItem(r) {
      const dw = Alpine.store('dw');
      if (r.quantity > 1) {
        dw.openModal('multi-unit', r.id);
      } else {
        dw.openModal('item', r.id);
      }
    },

    isMultiUnit(r) { return r.quantity > 1; },

    quantityBadgeClass(r) {
      const remaining = r.quantity - r.quantity_sold;
      if (remaining <= 0) return 'badge badge-sold';
      if (remaining / r.quantity <= 0.2) return 'badge badge-prepping';
      return 'badge badge-listed';
    },

    quantityBadgeText(r) {
      return `${r.quantity - r.quantity_sold} / ${r.quantity}`;
    },

    exportCsv() {
      const dw    = Alpine.store('dw');
      const rows  = this.rows;
      const headers = ['SKU','Name','Category','Status','Site','Cost','List Price','Sale Price','Profit','Date Added'];
      const escape  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines   = [
        headers.join(','),
        ...rows.map(r => [
          escape(r.sku || ''),
          escape(r.name || ''),
          escape(r.category?.name || ''),
          escape(r.status || ''),
          escape(dw.siteLabel(r) || ''),
          r.cost ?? '',
          dw.activeListing(r)?.list_price ?? '',
          r.order?.sale_price ?? '',
          r.order?.profit ?? '',
          escape(r.created_at ? new Date(r.created_at).toLocaleDateString('en-US') : ''),
        ].join(','))
      ];
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `dw-inventory-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },

    _saveFilters() {
      try {
        localStorage.setItem('dw_filter_items', JSON.stringify({
          status:      this.statusFilter,
          siteFilters: this.siteFilters,
          dateRange:   this.dateRange,
        }));
      } catch {}
    },

    _pushFilteredKpis() {
      const dw = Alpine.store('dw');
      const noFilter = this.statusFilter === 'All' && this.siteFilters.length === 0 && this.dateRange === 'all' && !dw.categoryFilter;
      if (noFilter) {
        dw.clearFilteredKpis();
        return;
      }
      const rows = this.rows;
      dw.setFilteredKpis({
        cost:     rows.reduce((s, r) => s + (r.cost || 0), 0),
        revenue:  rows.filter(r => r.status === 'Sold').reduce((s, r) => s + (r.order?.sale_price || 0), 0),
        profit:   rows.filter(r => r.status === 'Sold').reduce((s, r) => s + (r.order?.profit || 0), 0),
        inv:      rows.length,
        listed:   rows.filter(r => r.status === 'Listed').length,
        forecast: rows.filter(r => r.status === 'Listed').reduce((s, r) => s + dw.estProfit(r), 0),
      });
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
      if (!status) return 'n/a';
      return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },
  }));
});
