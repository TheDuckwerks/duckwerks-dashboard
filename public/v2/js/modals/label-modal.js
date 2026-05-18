// ── Label Modal — SQLite version ─────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('labelModal', () => ({
    step:           'form',   // 'form' | 'rates' | 'result'
    addrText:       '',
    insuredAmount:  '100',
    insureEnabled:  true,
    parcel:         { type: 'poly', weightLbs: '0', weightOz: '8', length: '9.5', width: '9.5', height: '1' },
    rates:          [],
    purchaseResult: null,
    ratePrice:      0,
    carrier:        null,
    reverbLinks:       null,
    reverbSaleAmount:  null,
    reverbOrderNum:    null,
    platformSaleDate:  null,  // date_sold from Reverb/eBay; falls back to today in saveShipping
    loading:        false,
    errMsg:         '',
    saveMsg:        '',
    savingShip:     false,
    reverbShipMsg:  '',   // separate from saveMsg so it isn't overwritten by saveShipping()
    ebayOrderId:      null,
    ebayLineItemId:   null,
    ebayLineItemIds:   [],
    ebayLineItemPrices: [],
    ebayOrderRecs:     [],
    ebayShipMsg:      '',
    carrierWarnings:  [],

    init() {
      this.$watch('$store.dw.activeModal', val => {
        if (val === 'label') this._open();
      });
    },

    async _open() {
      this.step              = 'form';
      this.addrText          = '';
      this.insureEnabled     = true;
      this.insuredAmount     = '100';
      this.rates             = [];
      this.purchaseResult    = null;
      this.ratePrice         = 0;
      this.carrier           = null;
      this.reverbLinks       = null;
      this.reverbSaleAmount  = null;
      this.reverbOrderNum    = null;
      this.platformSaleDate  = null;
      this.loading           = false;
      this.errMsg            = '';
      this.saveMsg           = '';
      this.savingShip        = false;
      this.reverbShipMsg     = '';
      this.ebayOrderId       = null;
      this.ebayLineItemId    = null;
      this.ebayLineItemIds    = [];
      this.ebayLineItemPrices = [];
      this.ebayOrderRecs      = [];
      this.ebayShipMsg       = '';
      this.carrierWarnings   = [];

      const dw      = Alpine.store('dw');
      const r       = dw.records.find(x => x.id === dw.activeRecordId);
      if (!r) return;

      const isDisc       = r.category?.name?.toLowerCase() === 'disc golf';
      this.insureEnabled = !isDisc;

      const listing  = dw.activeListing(r);
      const siteName = listing?.site?.name;
      const isReverb = siteName === 'Reverb' && !dw.activeEbayOrderId;
      const isEbay   = siteName === 'eBay' || !!dw.activeEbayOrderId;
      // activeReverbOrderNum is set by reverbModal SHIP button for items without a local order yet
      const pendingOrderNum = dw.activeReverbOrderNum;
      dw.activeReverbOrderNum = null; // clear so it doesn't leak to subsequent opens
      const orderNum = isReverb ? (r.order?.platform_order_num || pendingOrderNum) : null;

      if (orderNum) {
        this.reverbOrderNum = orderNum;
        try {
          const res = await fetch(`/api/reverb/my/orders/selling/${orderNum}`);
          if (res.ok) {
            const order = await res.json();
            this.reverbLinks      = order._links || null;
            // direct_checkout_payout is post-fee seller payout; amount_product is pre-fee listing price
            this.reverbSaleAmount = parseFloat(order.direct_checkout_payout?.amount) || parseFloat(order.amount_product?.amount) || null;
            this.reverbOrderNum   = order.order_number || orderNum;
            if (order.created_at) this.platformSaleDate = order.created_at.split('T')[0];
            console.log('[Reverb order] direct_checkout_payout:', order.direct_checkout_payout, '| amount_product:', order.amount_product?.amount);
            if (order.shipping_address) {
              this.addrText = this._addrToText(order.shipping_address);
            }
          }
        } catch(e) { console.warn('Reverb order fetch failed:', e); }
      }

      // eBay: activeEbayOrderId is set by ebayModal before opening label modal; fall back to saved order num
      if (isEbay) {
        const ebayOrderId = dw.activeEbayOrderId || r.order?.platform_order_num || null;
        dw.activeEbayOrderId = null; // clear so it doesn't leak to subsequent opens

        this.ebayOrderRecs = dw.activeEbayOrderRecs?.length ? [...dw.activeEbayOrderRecs] : [];
        dw.activeEbayOrderRecs = [];

        if (ebayOrderId) {
          this.ebayOrderId = ebayOrderId;
          try {
            const res = await fetch(`/api/ebay/orders/${encodeURIComponent(ebayOrderId)}`);
            if (res.ok) {
              const order = await res.json();
              this.ebayLineItemId = order.lineItems?.[0]?.lineItemId || null;
              // Use store-provided lineItemIds if available (set by ebay modal); fall back to fetched order
              this.ebayLineItemIds = dw.activeEbayLineItemIds?.length
                ? [...dw.activeEbayLineItemIds]
                : (order.lineItems || []).map(li => li.lineItemId).filter(Boolean);
              dw.activeEbayLineItemIds = [];
              // Split totalDueSeller proportionally by total per line item
              const totalDueSeller = parseFloat(order.paymentSummary?.totalDueSeller?.value) || 0;
              const discountedTotal = (order.lineItems || []).reduce(
                (sum, li) => sum + (parseFloat(li.total?.value) || 0), 0
              );
              this.ebayLineItemPrices = this.ebayLineItemIds.map(id => {
                const li = (order.lineItems || []).find(l => l.lineItemId === id);
                const discounted = parseFloat(li?.total?.value) || 0;
                return discountedTotal > 0
                  ? Math.round((totalDueSeller * (discounted / discountedTotal)) * 100) / 100
                  : null;
              });
              // totalDueSeller: confirmed available pre-fulfillment (validated 2026-03-26)
              const dueSeller = parseFloat(order.paymentSummary?.totalDueSeller?.value);
              if (dueSeller) this.reverbSaleAmount = dueSeller;
              if (order.creationDate) this.platformSaleDate = order.creationDate.split('T')[0];
              // shipTo is the actual shipping address; buyerRegistrationAddress is account address (may differ)
              const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
              const addr = shipTo || order.buyer?.buyerRegistrationAddress;
              if (addr) {
                const c = addr.contactAddress || {};
                this.addrText = this._addrToText({
                  name:             addr.fullName || '',
                  street_address:   c.addressLine1 || '',
                  extended_address: c.addressLine2 || '',
                  locality:         c.city || '',
                  region:           c.stateOrProvince || '',
                  postal_code:      c.postalCode || '',
                  country_code:     c.countryCode || 'US',
                });
              }
            }
          } catch(e) { console.warn('eBay order fetch failed:', e); }
        }
      }

      // Auto-set insured amount to sale price if > $100
      if (this.reverbSaleAmount && this.reverbSaleAmount > 100) {
        this.insuredAmount = String(Math.ceil(this.reverbSaleAmount));
      }
    },

    get record() {
      const dw = Alpine.store('dw');
      return dw.records.find(r => r.id === dw.activeRecordId) || null;
    },

    get itemName() {
      return this.record ? this.record.name || 'n/a' : 'n/a';
    },
    get itemSku() { return this.record?.sku || null; },

    setType(type) {
      this.parcel.type = type;
      if (type === 'poly') { this.parcel.weightLbs = '0'; this.parcel.weightOz = '8'; this.parcel.length = '9.5'; this.parcel.width = '9.5'; this.parcel.height = '1'; }
    },

    _addrToText(a) {
      const lines = [a.name, a.street_address];
      if (a.extended_address) lines.push(a.extended_address);
      lines.push(`${a.locality} ${a.region} ${a.postal_code}`);
      if (a.country_code && a.country_code !== 'US') lines.push(a.country_code);
      return lines.join('\n');
    },

    _parseAddress(text) {
      const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 3) return null;
      const name = lines[0];
      let rest = lines.slice(1);
      let country = 'US';
      const last = rest[rest.length - 1];
      if (/^[A-Z]{2}$/.test(last))       { country = last; rest = rest.slice(0, -1); }
      else if (/united states/i.test(last)) { country = 'US'; rest = rest.slice(0, -1); }
      const csz    = rest[rest.length - 1];
      const streets = rest.slice(0, -1);
      const parts  = csz.split(/\s+/);
      if (parts.length < 2) return null;
      const zip   = parts[parts.length - 1];
      const state = parts[parts.length - 2];
      const city  = parts.slice(0, parts.length - 2).join(' ');
      return { name, street1: streets[0] || '', street2: streets[1] || '', city, state, zip, country };
    },

    async getRates() {
      this.errMsg = '';
      const addr = this._parseAddress(this.addrText);
      if (!addr)                { this.errMsg = 'Could not parse address — check format'; return; }
      const totalLbs = (parseFloat(this.parcel.weightLbs) || 0) + (parseFloat(this.parcel.weightOz) || 0) / 16;
      if (!totalLbs)            { this.errMsg = 'Weight required'; return; }
      if (!this.parcel.length)  { this.errMsg = 'Length required'; return; }
      if (this.parcel.type === 'box' && (!this.parcel.width || !this.parcel.height)) {
        this.errMsg = 'Width and height required for boxes'; return;
      }
      const parcel = {
        weight: totalLbs,
        length: this.parcel.length,
        width:  this.parcel.width  || '1',
        height: this.parcel.type === 'box' ? this.parcel.height : '1',
      };
      this.loading = true;
      try {
        const res  = await fetch('/api/label/rates', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ toAddress: addr, parcel }),
        });
        const data = await res.json();
        if (!res.ok || !data.rates) {
          this.errMsg = data.error || 'No rates returned';
          return;
        }
        this.rates           = data.rates;
        this.carrierWarnings = data.warnings || [];
        this.step            = 'rates';
      } catch(e) {
        this.errMsg = e.message;
      } finally {
        this.loading = false;
      }
    },

    async purchase(rateId, price, carrier) {
      this.carrier   = carrier || null;
      this.ratePrice = price;
      this.loading   = true;
      this.errMsg    = '';
      try {
        const res  = await fetch('/api/label/purchase', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ rateObjectId: rateId, ...(this.insureEnabled ? { insurance: this.insuredAmount || '100' } : {}) }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.errMsg = data.error || 'Purchase failed';
          this.step   = 'rates';
          return;
        }
        this.purchaseResult = data;
        this.step = 'result';
        // Auto-fire on purchase — don't wait for button clicks
        if (this.reverbLinks?.ship && data.trackingNumber) this.markShipped();
        if (this.ebayOrderId && this.ebayLineItemId && data.trackingNumber) this.markShippedEbay();
        this.saveShipping();
      } catch(e) {
        this.errMsg = e.message;
        this.step   = 'rates';
      } finally {
        this.loading = false;
      }
    },

    async saveShipping() {
      const r = this.record;
      if (!r) return;
      this.savingShip = true;
      this.saveMsg    = '';
      const dw      = Alpine.store('dw');
      const listing = dw.activeListing(r);

      try {
        // ── 1. Create or update the order ──────────────────────────────────────
        const dateSold         = this.platformSaleDate || new Date().toISOString().split('T')[0];
        const sale_price = this.ebayLineItemPrices.length > 0
          ? (this.ebayLineItemPrices[0] ?? this.reverbSaleAmount ?? null)
          : (this.reverbSaleAmount || null);
        const platform_order_num = this.reverbOrderNum || this.ebayOrderId || null;

        let orderId;
        if (r.order) {
          await dw.updateOrder(r.order.id, { sale_price, date_sold: dateSold, platform_order_num });
          orderId = r.order.id;
        } else {
          const newOrder = await dw.createOrder({
            listing_id:          listing?.id || null,
            sale_price,
            date_sold:           dateSold,
            platform_order_num,
          });
          orderId = newOrder.id;
        }

        // ── 2. Mark item sold ──────────────────────────────────────────────────
        if (r.status !== 'Sold') {
          await dw.updateItem(r.id, { status: 'Sold' });
        }

        // ── 3. Create or update the shipment ──────────────────────────────────
        const shipmentFields = {
          carrier:         this.carrier || null,
          service:         this.purchaseResult?.service || null,
          tracking_id:     this.purchaseResult?.trackingId     || null,
          tracking_number: this.purchaseResult?.trackingNumber || null,
          tracker_url:     this.purchaseResult?.trackerUrl     || null,
          label_url:       this.purchaseResult?.labelUrl       || null,
          shipping_cost:   this.purchaseResult?.totalCost ?? this.ratePrice,
        };
        if (r.shipment) {
          await dw.updateShipment(r.shipment.id, shipmentFields);
        } else {
          await dw.createShipment({ order_id: orderId, ...shipmentFields });
        }

        // For multi-item eBay orders: mark secondary recs sold and attach same tracking
        if (this.ebayOrderRecs.length > 1) {
          const trackingFields = {
            carrier:         this.carrier || null,
            service:         this.purchaseResult?.service || null,
            tracking_id:     this.purchaseResult?.trackingId     || null,
            tracking_number: this.purchaseResult?.trackingNumber || null,
            tracker_url:     this.purchaseResult?.trackerUrl     || null,
            label_url:       this.purchaseResult?.labelUrl       || null,
            shipping_cost:   0,
          };
          for (const [idx, secRec] of this.ebayOrderRecs.slice(1).entries()) {
            const secSalePrice = this.ebayLineItemPrices[idx + 1] ?? null;
            let secOrderId;
            if (secRec.order) {
              await dw.updateOrder(secRec.order.id, {
                sale_price:         secSalePrice,
                date_sold:          this.platformSaleDate || new Date().toISOString().split('T')[0],
                platform_order_num: this.ebayOrderId,
              });
              secOrderId = secRec.order.id;
            } else {
              const secListing = dw.activeListing(secRec);
              const newOrder = await dw.createOrder({
                listing_id:         secListing?.id || null,
                sale_price:         secSalePrice,
                date_sold:          this.platformSaleDate || new Date().toISOString().split('T')[0],
                platform_order_num: this.ebayOrderId,
              });
              secOrderId = newOrder.id;
            }
            if (secRec.status !== 'Sold') await dw.updateItem(secRec.id, { status: 'Sold' });
            if (secRec.shipment) {
              await dw.updateShipment(secRec.shipment.id, trackingFields);
            } else {
              await dw.createShipment({ order_id: secOrderId, ...trackingFields });
            }
          }
        }

        // createShipment calls fetchAll internally — store is fresh
        this.saveMsg = '✓ saved';
      } catch(e) {
        this.saveMsg = 'ERROR: ' + e.message;
      } finally {
        this.savingShip = false;
      }
    },

    async markShippedEbay() {
      if (!this.ebayOrderId || !this.ebayLineItemIds.length || !this.purchaseResult?.trackingNumber) return;
      this.ebayShipMsg = 'Notifying eBay...';
      try {
        const res = await fetch(`/api/ebay/orders/${encodeURIComponent(this.ebayOrderId)}/tracking`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            lineItemIds:         this.ebayLineItemIds,
            trackingNumber:      this.purchaseResult.trackingNumber,
            shippingCarrierCode: this.carrier || 'OTHER',
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        this.ebayShipMsg = '✓ buyer notified';
      } catch(e) {
        this.ebayShipMsg = 'eBay error: ' + e.message;
        console.error('[markShippedEbay] error:', e);
      }
    },

    carrierColor(carrier) {
      const map = { USPS: 'var(--blue)', UPS: 'var(--yellow)', FedEx: 'var(--orange)', DHL: 'var(--purple)' };
      return map[carrier] || 'var(--white)';
    },

    printLabel() {
      Alpine.store('dw').printLabel(this.purchaseResult?.labelZplUrl, this.purchaseResult?.labelUrl);
    },


    async markShipped() {
      if (!this.reverbLinks?.ship?.href || !this.purchaseResult?.trackingNumber) return;
      this.reverbShipMsg = 'Notifying Reverb...';
      const apiPath = this.reverbLinks.ship.href
        .replace(/^https?:\/\/api\.reverb\.com\/api\//, '');
      const carrierMap = { USPS: 'USPS', UPS: 'UPS', FedEx: 'FedEx', DHL: 'DHL', DHLExpress: 'DHLExpress' };
      const provider   = (this.carrier && carrierMap[this.carrier]) || this.carrier || 'Other';
      try {
        const res = await fetch(`/api/reverb/${apiPath}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            provider,
            tracking_number:   this.purchaseResult.trackingNumber,
            send_notification: true,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.message || `HTTP ${res.status}`);
        }
        this.reverbShipMsg = '✓ buyer notified';
      } catch(e) {
        this.reverbShipMsg = 'Reverb error: ' + e.message;
        console.error('[markShipped] error:', e);
      }
    },
  }));
});
