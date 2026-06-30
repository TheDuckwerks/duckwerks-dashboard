// ── Sites View ────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('sitesView', () => ({

    // ── Orders ────────────────────────────────────────────────────────────────
    ordersLoading:   false,
    ebayOrders:      [],
    reverbOrders:    [],
    ebayOrdersErr:   '',
    reverbOrdersErr: '',
    locations:       {},
    orderSel:        {},   // combine-ship selection: { [orderId]: true }

    // ── Listings ──────────────────────────────────────────────────────────────
    listingsLoading:  false,
    listingsErr:      '',
    listingsSynced:   false,
    unlinkedListings: [],
    linkSelections:   {},
    importCategory:   '',
    importLot:        '',
    importNewLot:     '',
    importMsg:        '',
    importingNew:     false,
    linksMsg:         '',
    savingLinks:      false,

    // ── Details ───────────────────────────────────────────────────────────────
    detailsLoading:  false,
    detailsErr:      '',
    detailsChecked:  false,
    detailDiffs:     [],
    detailsMsg:      '',
    syncingDetails:  false,

    init() {
      this.$watch('$store.dw.activeView', val => {
        if (val === 'sites') this.fetchOrders();
      });
      this.$watch('$store.dw.activeModal', val => {
        if (val === null && this.$store.dw.activeView === 'sites') this.fetchOrders();
      });
      this.$watch('$store.dw.ordersRefreshTick', () => {
        if (this.$store.dw.activeView === 'sites') this.fetchOrders();
      });
    },

    // ── Orders ────────────────────────────────────────────────────────────────

    async fetchOrders() {
      this.ordersLoading   = true;
      this.ebayOrders      = [];
      this.reverbOrders    = [];
      this.orderSel        = {};
      this.ebayOrdersErr   = '';
      this.reverbOrdersErr = '';
      const [ebay, reverb] = await Promise.allSettled([
        this._fetchEbayOrders(),
        this._fetchReverbOrders(),
      ]);
      if (ebay.status   === 'rejected') this.ebayOrdersErr   = ebay.reason?.message   || 'eBay fetch failed';
      if (reverb.status === 'rejected') this.reverbOrdersErr = reverb.reason?.message || 'Reverb fetch failed';
      const allSkus = [
        ...this.ebayOrders.flatMap(e => e.items.map(i => i.rec?.sku).filter(Boolean)),
        ...this.reverbOrders.map(e => e.rec?.sku).filter(Boolean),
      ];
      if (allSkus.length) await this._fetchLocations(allSkus);
      this.ordersLoading = false;
    },

    async _fetchEbayOrders() {
      const res  = await fetch('/api/ebay/orders');
      if (!res.ok) throw new Error(`eBay orders HTTP ${res.status}`);
      const data = await res.json();
      const dw   = Alpine.store('dw');
      this.ebayOrders = (data.orders || [])
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
          const matched    = items.filter(i => i.rec);
          const allShipped = matched.every(i => i.rec.shipment?.tracking_number);
          return matched.length > 0 && !allShipped;
        })
        // sort by buyer so same-buyer orders cluster (combine candidates sit adjacent)
        .sort((a, b) => this.ebayBuyerName(a.order).localeCompare(this.ebayBuyerName(b.order)));
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

    async _fetchLocations(skus) {
      const unique = [...new Set(skus.filter(Boolean))];
      const results = await Promise.all(unique.map(async sku => {
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

    // ── Combine ship (eBay only) ───────────────────────────────────────────────

    toggleOrderSel(orderId) {
      this.orderSel = { ...this.orderSel, [orderId]: !this.orderSel[orderId] };
    },

    get selectedEbayOrders() {
      return this.ebayOrders.filter(e => this.orderSel[e.order.orderId]);
    },

    // normalized shipping-address key — combine is one label, so addresses must match
    _ebayAddrKey(order) {
      const a = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
      const c = a?.contactAddress || {};
      return [a?.fullName, c.addressLine1, c.postalCode]
        .map(x => (x || '').trim().toLowerCase()).join('|');
    },

    get combineReady() {
      const sel = this.selectedEbayOrders;
      if (sel.length < 2) return false;
      return new Set(sel.map(e => this._ebayAddrKey(e.order))).size === 1;
    },

    get combineBlockedReason() {
      const sel = this.selectedEbayOrders;
      if (sel.length < 2) return '';
      return new Set(sel.map(e => this._ebayAddrKey(e.order))).size > 1
        ? 'orders ship to different addresses' : '';
    },

    combineSelectedEbay() {
      const dw  = Alpine.store('dw');
      const sel = this.selectedEbayOrders;
      if (sel.length < 2 || !this.combineReady) return;
      dw.activeEbayOrderGroups = sel.map(e => ({
        orderId:     e.order.orderId,
        lineItemIds: e.items.map(i => i.lineItem.lineItemId),
        recs:        e.items.filter(i => i.rec).map(i => i.rec),
      }));
      dw.previousView = 'sites';
      const primaryRec = dw.activeEbayOrderGroups[0].recs[0];
      if (primaryRec) dw.openModal('label', primaryRec.id);
    },

    // ── Listings ──────────────────────────────────────────────────────────────

    async fetchListings() {
      this.listingsLoading  = true;
      this.listingsErr      = '';
      this.listingsSynced   = false;
      this.unlinkedListings = [];
      this.linkSelections   = {};
      this.importMsg        = '';
      this.linksMsg         = '';
      try {
        const dw = Alpine.store('dw');
        const linkedIds = new Set(
          dw.records.flatMap(r => r.listings || [])
            .map(l => l.platform_listing_id)
            .filter(Boolean)
        );

        const [ebayRes, reverbListings] = await Promise.all([
          fetch('/api/ebay/listings').then(r => r.ok ? r.json() : { listings: [] }),
          this._fetchAllReverbListings(),
        ]);

        const seen = new Set();
        const ebayUnlinked = (ebayRes.listings || [])
          .filter(l => {
            if (linkedIds.has(l.legacyItemId) || seen.has(l.legacyItemId)) return false;
            seen.add(l.legacyItemId);
            return true;
          })
          .map(l => ({
            platform:          'eBay',
            id:                l.legacyItemId,
            title:             l.title || 'Untitled',
            price:             parseFloat(l.price) || 0,
            listingIdKey:      l.legacyItemId,
            quantityAvailable: l.quantityAvailable ?? 1,
            raw:               l,
          }));

        const reverbUnlinked = reverbListings
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
        this.linkSelections  = sel;
        this.listingsSynced  = true;
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
          if (listing.quantityAvailable > 1) itemFields.quantity = listing.quantityAvailable;
          const item = await dw.createItem(itemFields);
          const listingFields = {
            item_id:             item.id,
            site_id:             site.id,
            list_price:          listing.price,
            platform_listing_id: listing.listingIdKey,
          };
          if (listing.platform === 'eBay') {
            listingFields.url = `https://www.ebay.com/itm/${listing.listingIdKey}`;
            try {
              const migrateRes = await fetch('/api/ebay/migrate-listing', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ listingIds: [listing.listingIdKey] }),
              });
              if (migrateRes.ok) {
                const [result] = await migrateRes.json();
                if (result?.offerId) listingFields.offer_id = result.offerId;
              }
            } catch (e) {
              console.warn('migrate-listing failed for', listing.listingIdKey, e.message);
            }
          } else {
            listingFields.url               = listing.raw._links?.web?.href || '';
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
          if (!listing) throw new Error('no unlinked listing on local record');
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

    // ── Details ───────────────────────────────────────────────────────────────

    async fetchDetails() {
      this.detailsLoading = true;
      this.detailsErr     = '';
      this.detailsChecked = false;
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
        this.detailDiffs    = diffs;
        this.detailsChecked = true;
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

  }));
});
