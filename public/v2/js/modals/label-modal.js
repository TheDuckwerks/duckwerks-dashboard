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
    orderGroups:      [],   // eBay ship: [{ orderId, recs[], lineItemIds[], lineItemPrices[], address, saleTotal, saleDate }]; empty for Reverb
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
      this.orderGroups       = [];
      this.ebayShipMsg       = '';
      this.carrierWarnings   = [];

      const dw      = Alpine.store('dw');
      const r       = dw.records.find(x => x.id === dw.activeRecordId);
      if (!r) return;

      const isDisc       = r.category?.name?.toLowerCase() === 'disc golf';
      this.insureEnabled = !isDisc;

      const listing  = dw.activeListing(r);
      const siteName = listing?.site?.name;
      const isCombine = !!dw.activeEbayOrderGroups?.length;
      const isReverb = siteName === 'Reverb' && !dw.activeEbayOrderId && !isCombine;
      const isEbay   = siteName === 'eBay' || !!dw.activeEbayOrderId || isCombine;
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

      // eBay: combine-ship passes activeEbayOrderGroups; single-order ship builds one group from the scalar fields
      if (isEbay) {
        const rawGroups = dw.activeEbayOrderGroups?.length
          ? dw.activeEbayOrderGroups
          : [{
              orderId:     dw.activeEbayOrderId || r.order?.platform_order_num || null,
              recs:        dw.activeEbayOrderRecs?.length ? [...dw.activeEbayOrderRecs] : [r],
              lineItemIds: dw.activeEbayLineItemIds?.length ? [...dw.activeEbayLineItemIds] : [],
            }];
        // clear so nothing leaks to subsequent opens
        dw.activeEbayOrderGroups = [];
        dw.activeEbayOrderId     = null;
        dw.activeEbayOrderRecs   = [];
        dw.activeEbayLineItemIds = [];

        this.orderGroups = [];
        for (const g of rawGroups.filter(g => g.orderId)) {
          const built = await this._fetchOrderGroup(g);
          if (built) this.orderGroups.push(built);
        }

        // Primary group seeds the shared address + insurance default; sale total sums across orders
        const primary = this.orderGroups[0];
        if (primary) {
          if (primary.address)  this.addrText         = primary.address;
          if (primary.saleDate) this.platformSaleDate = primary.saleDate;
          const total = this.orderGroups.reduce((s, g) => s + (g.saleTotal || 0), 0);
          if (total) this.reverbSaleAmount = total;
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

    // all records going on this one label (>1 = multi-item order or a combined ship)
    get shipItems() {
      return this.orderGroups.flatMap(g => g.recs.map(r => r.name || r.sku || 'item'));
    },

    setType(type) {
      this.parcel.type = type;
      if (type === 'poly') { this.parcel.weightLbs = '0'; this.parcel.weightOz = '8'; this.parcel.length = '9.5'; this.parcel.width = '9.5'; this.parcel.height = '1'; }
    },

    // Fetch one eBay order → resolve its line-item ids, per-item sale prices, address, total, date
    async _fetchOrderGroup(g) {
      try {
        const res = await fetch(`/api/ebay/orders/${encodeURIComponent(g.orderId)}`);
        if (!res.ok) return null;
        const order = await res.json();
        const lineItemIds = g.lineItemIds?.length
          ? g.lineItemIds
          : (order.lineItems || []).map(li => li.lineItemId).filter(Boolean);
        // Split totalDueSeller proportionally by total per line item
        // totalDueSeller: confirmed available pre-fulfillment (validated 2026-03-26)
        const totalDueSeller  = parseFloat(order.paymentSummary?.totalDueSeller?.value) || 0;
        const discountedTotal = (order.lineItems || []).reduce(
          (sum, li) => sum + (parseFloat(li.total?.value) || 0), 0
        );
        const lineItemPrices = lineItemIds.map(id => {
          const li = (order.lineItems || []).find(l => l.lineItemId === id);
          const discounted = parseFloat(li?.total?.value) || 0;
          return discountedTotal > 0
            ? Math.round((totalDueSeller * (discounted / discountedTotal)) * 100) / 100
            : null;
        });
        // shipTo is the actual shipping address; buyerRegistrationAddress is account address (may differ)
        const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
        const a      = shipTo || order.buyer?.buyerRegistrationAddress;
        let address  = null;
        if (a) {
          const c = a.contactAddress || {};
          address = this._addrToText({
            name:             a.fullName || '',
            street_address:   c.addressLine1 || '',
            extended_address: c.addressLine2 || '',
            locality:         c.city || '',
            region:           c.stateOrProvince || '',
            postal_code:      c.postalCode || '',
            country_code:     c.countryCode || 'US',
          });
        }
        return {
          orderId:   g.orderId,
          recs:      g.recs || [],
          lineItemIds,
          lineItemPrices,
          address,
          saleTotal: totalDueSeller,
          saleDate:  order.creationDate ? order.creationDate.split('T')[0] : null,
        };
      } catch(e) { console.warn('eBay order group fetch failed:', e); return null; }
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
        if (this.orderGroups.length && data.trackingNumber) this.markShippedEbay();
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
      const dw       = Alpine.store('dw');
      const dateSold = this.platformSaleDate || new Date().toISOString().split('T')[0];
      const totalCost = this.purchaseResult?.totalCost ?? this.ratePrice ?? 0;

      const tracking = {
        carrier:         this.carrier || null,
        service:         this.purchaseResult?.service || null,
        tracking_id:     this.purchaseResult?.trackingId     || null,
        tracking_number: this.purchaseResult?.trackingNumber || null,
        tracker_url:     this.purchaseResult?.trackerUrl     || null,
        label_url:       this.purchaseResult?.labelUrl       || null,
      };

      const saveRec = async (rec, { sale_price, platform_order_num, shipping_cost, fees }) => {
        const listing = dw.activeListing(rec);
        let orderId;
        if (rec.order) {
          await dw.updateOrder(rec.order.id, { sale_price, date_sold: dateSold, platform_order_num, fees });
          orderId = rec.order.id;
        } else {
          const newOrder = await dw.createOrder({ listing_id: listing?.id || null, sale_price, date_sold: dateSold, platform_order_num, fees });
          orderId = newOrder.id;
        }
        if (rec.status !== 'Sold') await dw.updateItem(rec.id, { status: 'Sold' });
        const shipmentFields = { ...tracking, shipping_cost };
        if (rec.shipment) await dw.updateShipment(rec.shipment.id, shipmentFields);
        else              await dw.createShipment({ order_id: orderId, ...shipmentFields });
      };

      try {
        if (this.orderGroups.length) {
          // eBay (single or combined): one label, shipping evenly amortized across every record
          const flat = this.orderGroups.flatMap(g =>
            g.recs.map((rec, i) => ({ rec, orderId: g.orderId, salePrice: g.lineItemPrices[i] ?? null }))
          );
          const n         = flat.length || 1;
          const per       = Math.floor((totalCost / n) * 100) / 100;
          const remainder = Math.round((totalCost - per * n) * 100) / 100;  // pennies land on the first rec
          for (const [idx, { rec, orderId, salePrice }] of flat.entries()) {
            await saveRec(rec, {
              sale_price:         salePrice,
              platform_order_num: orderId,
              shipping_cost:      idx === 0 ? Math.round((per + remainder) * 100) / 100 : per,
            });
          }
        } else {
          // Reverb / non-eBay single record
          // direct_checkout_payout is already net of Reverb fees — record fees as 0,
          // never the site formula (that would double-count). eBay recs omit fees too:
          // their sale_price is the totalDueSeller split, also post-fee, so the server
          // default of 0 is correct for both.
          await saveRec(r, {
            sale_price:         this.reverbSaleAmount || null,
            platform_order_num: this.reverbOrderNum || null,
            shipping_cost:      totalCost,
            fees:               this.reverbSaleAmount ? 0 : undefined,
          });
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
      if (!this.orderGroups.length || !this.purchaseResult?.trackingNumber) return;
      this.ebayShipMsg = 'Notifying eBay...';
      try {
        // push the same tracking to every combined order so none flag unshipped
        for (const g of this.orderGroups) {
          if (!g.orderId || !g.lineItemIds.length) continue;
          const res = await fetch(`/api/ebay/orders/${encodeURIComponent(g.orderId)}/tracking`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              lineItemIds:         g.lineItemIds,
              trackingNumber:      this.purchaseResult.trackingNumber,
              shippingCarrierCode: this.carrier || 'OTHER',
            }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || `HTTP ${res.status}`);
          }
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
