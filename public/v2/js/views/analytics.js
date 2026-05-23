// ── Analytics View ────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('analyticsView', () => ({
    activeTab:     'listed',

    // Listed tab state
    listedRows:       [],
    listedLoading:    false,
    listedLoaded:     false,
    listedError:      null,
    listedSiteFilter: ['eBay', 'Reverb'],
    sortKey:          'views',
    sortDir:          'desc',

    // Sold tab state
    soldRows:       [],
    soldLoading:    false,
    soldLoaded:     false,
    soldError:      null,
    soldSiteFilter: ['eBay', 'Reverb'],
    soldSortKey:    'daysSince',
    soldSortDir:    'desc',

    async init() {
      this.$watch('activeTab', tab => {
        if (tab === 'listed' && !this.listedLoaded) this._loadListed();
        if (tab === 'sold'   && !this.soldLoaded)   this._loadSold();
      });
      this.$watch('$store.dw.activeView', v => {
        if (v === 'analytics' && !this.listedLoaded) this._loadListed();
      });
      if (Alpine.store('dw').activeView === 'analytics') this._loadListed();
      const saved = dwSortable.load('analytics', 'views', 'desc');
      this.sortKey = saved.col;
      this.sortDir = saved.dir;
      this.$watch('listedSiteFilter', () => this._pushFilteredKpis());
      this.$watch('soldSiteFilter',   () => this._pushFilteredKpis());
      this.$watch('$store.dw.activeView', v => { if (v !== 'analytics') Alpine.store('dw').clearFilteredKpis(); });
    },

    sortBy(key) {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortKey = key;
        this.sortDir = 'asc';
      }
      dwSortable.save('analytics', this.sortKey, this.sortDir);
    },

    sortGlyph(key) {
      if (this.sortKey !== key) return '↕';
      return this.sortDir === 'asc' ? '↑' : '↓';
    },

    soldSortBy(key) {
      if (this.soldSortKey === key) {
        this.soldSortDir = this.soldSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.soldSortKey = key;
        this.soldSortDir = 'asc';
      }
    },

    soldSortIndicator(key) {
      if (this.soldSortKey !== key) return '';
      return this.soldSortDir === 'asc' ? ' ↑' : ' ↓';
    },

    toggleListedSite(site) {
      if (this.listedSiteFilter.includes(site)) {
        this.listedSiteFilter = this.listedSiteFilter.filter(s => s !== site);
      } else {
        this.listedSiteFilter = [...this.listedSiteFilter, site];
      }
    },

    toggleSoldSite(site) {
      if (this.soldSiteFilter.includes(site)) {
        this.soldSiteFilter = this.soldSiteFilter.filter(s => s !== site);
      } else {
        this.soldSiteFilter = [...this.soldSiteFilter, site];
      }
    },

    openItem(itemId) {
      if (itemId) Alpine.store('dw').openModal('item', itemId);
    },

    get sortedListedRows() {
      return [...this.listedRows].filter(r => this.listedSiteFilter.includes(r.site)).sort((a, b) => {
        const av = a[this.sortKey] ?? -1;
        const bv = b[this.sortKey] ?? -1;
        if (av < bv) return this.sortDir === 'asc' ? -1 : 1;
        if (av > bv) return this.sortDir === 'asc' ?  1 : -1;
        return 0;
      });
    },

    get sortedSoldRows() {
      return [...this.soldRows].filter(r => this.soldSiteFilter.includes(r.site)).sort((a, b) => {
        let av = a[this.soldSortKey];
        let bv = b[this.soldSortKey];
        // Date objects: compare timestamps
        if (av instanceof Date) av = av.getTime();
        if (bv instanceof Date) bv = bv.getTime();
        av = av ?? -1;
        bv = bv ?? -1;
        if (typeof av === 'string') return this.soldSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        if (av < bv) return this.soldSortDir === 'asc' ? -1 : 1;
        if (av > bv) return this.soldSortDir === 'asc' ?  1 : -1;
        return 0;
      });
    },

    _pushFilteredKpis() {
      const dw = Alpine.store('dw');
      const defaultSites = ['eBay', 'Reverb'];
      const listedFiltered = this.listedSiteFilter.length !== defaultSites.length
        || this.soldSiteFilter.length !== defaultSites.length;
      if (!listedFiltered) {
        dw.clearFilteredKpis();
        return;
      }
      const listed = this.sortedListedRows;
      const sold   = this.sortedSoldRows;
      dw.setFilteredKpis({
        cost:    0,
        revenue: sold.reduce((s, r) => s + (r.sale_price || 0), 0),
        profit:  sold.reduce((s, r) => s + (r.profit || 0), 0),
        inv:     listed.length + sold.length,
        listed:  listed.length,
      });
    },

    async _loadListed() {
      this.listedLoading = true;
      this.listedError   = null;
      try {
        // Fetch eBay listings first — need IDs before firing traffic request
        const ebayListings  = await fetch('/api/ebay/listings').then(r => r.json()).catch(() => ({}));
        const activeEbayIds = (ebayListings.listings || []).map(l => l.legacyItemId).filter(Boolean);

        // Fetch Reverb listings + eBay traffic in parallel
        const [reverbListings, ebayTraffic] = await Promise.all([
          this._fetchReverbListings(),
          fetch('/api/ebay/traffic', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ listingIds: activeEbayIds }),
          }).then(r => r.json()).catch(() => ({})),
        ]);

        // ebayTraffic.listings: { [legacyListingId]: { views, impressions, ctr } }
        const ebayMap = ebayTraffic.listings || {};
        Object.assign(Alpine.store('dw').trafficMap, ebayMap);

        // watchCount map: legacyItemId → count (null until eBay App Check approved)
        const watchMap = {};
        for (const l of (ebayListings.listings || [])) {
          if (l.legacyItemId) watchMap[l.legacyItemId] = l.watchCount;
        }

        const dw   = Alpine.store('dw');
        const rows = [];

        // Reverb rows
        for (const l of reverbListings) {
          const lid   = String(l.id);
          const local = dw.records.find(r =>
            r.listings?.some(li => String(li.platform_listing_id) === lid)
          );
          const reverbDate   = l.published_at ? new Date(l.published_at) : null;
          const reverbDaysListed = reverbDate ? Math.floor((Date.now() - reverbDate) / 86400000) : null;
          rows.push({
            name:        local?.name || l.title || 'n/a',
            site:        'Reverb',
            listingId:   lid,
            itemId:      local?.id || null,
            listPrice:   l.price?.amount != null ? parseFloat(l.price.amount) : null,
            daysListed:  reverbDaysListed,
            views:       l.stats?.views   ?? null,
            watchers:    l.stats?.watches ?? null,
            impressions: null,
            ctr:         null,
          });
        }

        // eBay rows — from store records with active eBay listings
        for (const r of dw.records) {
          if (r.status !== 'Listed') continue;
          const listing = (r.listings || []).find(l => l.status === 'active' && l.site?.name === 'eBay');
          if (!listing) continue;
          const lid     = listing?.platform_listing_id ? String(listing.platform_listing_id) : null;
          const traffic = lid ? (ebayMap[lid] || {}) : {};
          const ebayDate     = listing?.listed_at ? new Date(listing.listed_at) : null;
          const ebayDaysListed = ebayDate ? Math.floor((Date.now() - ebayDate) / 86400000) : null;
          rows.push({
            name:        r.name,
            site:        'eBay',
            listingId:   lid || '',
            itemId:      r.id || null,
            listPrice:   listing?.list_price != null ? parseFloat(listing.list_price) : null,
            daysListed:  ebayDaysListed,
            views:       traffic.views       ?? null,
            watchers:    lid ? (watchMap[lid] ?? null) : null,
            impressions: traffic.impressions ?? null,
            ctr:         traffic.ctr != null ? Math.round(traffic.ctr * 100) : null,
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

    async _fetchReverbListings() {
      const listings = [];
      let nextPath   = 'my/listings?per_page=100&state=live';
      while (nextPath) {
        const res  = await fetch('/api/reverb/' + nextPath);
        if (!res.ok) break;
        const data = await res.json();
        (data.listings || []).forEach(l => listings.push(l));
        const nextHref = data._links?.next?.href || '';
        nextPath = nextHref ? nextHref.replace('https://api.reverb.com/api/', '') : null;
      }
      return listings;
    },

    async _loadSold() {
      this.soldLoading = true;
      this.soldError   = null;
      try {
        const [reverbOrders, ebayData] = await Promise.all([
          this._fetchReverbPendingFeedback(),
          fetch('/api/ebay/fulfilled-orders').then(r => r.json()).catch(() => ({ orders: [] })),
        ]);

        const dw   = Alpine.store('dw');
        const rows = [];

        // Reverb rows — needs_feedback_for_seller: true
        for (const order of reverbOrders) {
          const orderNum  = String(order.order_number);
          const local     = dw.records.find(r => String(r.order?.platform_order_num) === orderNum);
          const soldDate  = new Date(order.created_at);
          const daysSince = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24));
          rows.push({
            name:       local?.name || order.title || 'n/a',
            site:       'Reverb',
            orderNum,
            itemId:     local?.id || null,
            soldDate,
            daysSince,
            orderUrl:   order._links?.web?.href || null,
            salePrice:  local?.order?.sale_price || null,
            profit:     local?.order?.profit     || null,
          });
        }

        // eBay rows — all FULFILLED orders within 60d feedback window
        // Note: eBay's per-order feedback API is not publicly accessible;
        // showing all recently fulfilled orders so you can check/nudge as needed
        for (const order of (ebayData.orders || [])) {
          const local = dw.records.find(r =>
            r.order?.platform_order_num &&
            (String(r.order.platform_order_num) === String(order.orderId) ||
             String(r.order.platform_order_num) === String(order.legacyOrderId))
          );
          const soldDate  = new Date(order.creationDate);
          const daysSince = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24));
          const orderUrl  = order.orderId
            ? `https://www.ebay.com/mesh/ord/details?orderId=${order.orderId}`
            : null;
          rows.push({
            name:       local?.name || order.lineItems?.[0]?.title || 'n/a',
            site:       'eBay',
            orderNum:   order.orderId || order.legacyOrderId,
            itemId:     local?.id || null,
            soldDate,
            daysSince,
            orderUrl,
            salePrice:  local?.order?.sale_price || null,
            profit:     local?.order?.profit     || null,
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
      // Collect order numbers from list (needs_feedback_for_seller only on detail endpoint)
      const orderNums = [];
      let nextPath    = 'my/orders/selling?per_page=50';
      let pages       = 0;
      while (nextPath && pages < 6) {
        const data = await fetch('/api/reverb/' + nextPath).then(r => r.json());
        (data.orders || []).forEach(o => { if (o.order_number) orderNums.push(o.order_number); });
        const nextHref = data._links?.next?.href || '';
        nextPath = nextHref ? nextHref.replace('https://api.reverb.com/api/', '') : null;
        pages++;
      }

      // Fetch details in parallel, filter for needs_feedback_for_seller
      const details = await Promise.all(
        orderNums.map(num =>
          fetch(`/api/reverb/my/orders/selling/${num}`).then(r => r.json()).catch(() => null)
        )
      );
      return details.filter(o => o?.needs_feedback_for_seller === true);
    },
  }));
});
