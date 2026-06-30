# Multi-Item eBay Order Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support eBay orders containing multiple line items (discs) — matching all items to local records, shipping them in one package, applying the same tracking number to all items in eBay and in the local DB.

**Architecture:** The eBay modal `_process()` currently hard-codes `lineItems[0]`. We change it to group all lineItems per order into a multi-item structure. The label modal receives all lineItemIds and all matched recs via new store state. `saveShipment()` loops over all recs; `markShippedEbay()` sends all lineItemIds in one eBay API call.

**Tech Stack:** Alpine.js (frontend state + UI), Express + better-sqlite3 (backend), eBay Sell Fulfillment API v1

---

## File Map

| File | Change |
|------|--------|
| `public/v2/js/store.js` | Add `activeEbayLineItemIds: []` and `activeEbayOrderRecs: []` to store |
| `public/v2/js/modals/ebay-modal.js` | Rewrite `_process()` to group all lineItems per order; update `openShip()`; add `lineItemTitles()` helper |
| `public/v2/index.html` | Update matched order row template to render per-item SKU + title list; update `openShip` call |
| `public/v2/js/modals/label-modal.js` | Read new store state on open; update `markShippedEbay()` to send array; update `saveShipment()` to loop all recs |
| `server/ebay.js` | Change tracking endpoint to accept `lineItemIds: []` array instead of single `lineItemId` |

---

## Task 1: Server — accept lineItemIds array in tracking endpoint

**Files:**
- Modify: `server/ebay.js:84-111`

Current code sends `lineItems: [{ lineItemId, quantity: quantity || 1 }]` using a single `lineItemId` from the request body. We change it to accept a `lineItemIds` array and map each into the eBay payload.

- [ ] **Open `server/ebay.js` and find the tracking route at line ~84**

- [ ] **Replace the destructure and body construction:**

Change:
```js
const { lineItemId, quantity, trackingNumber, shippingCarrierCode } = req.body;
```
To:
```js
const { lineItemIds, trackingNumber, shippingCarrierCode } = req.body;
```

Change the `lineItems` field in the fetch body from:
```js
lineItems: [{ lineItemId, quantity: quantity || 1 }],
```
To:
```js
lineItems: lineItemIds.map(id => ({ lineItemId: id, quantity: 1 })),
```

- [ ] **Verify the full updated route looks like this:**

```js
router.post('/orders/:id/tracking', async (req, res) => {
  const { id } = req.params;
  const { lineItemIds, trackingNumber, shippingCarrierCode } = req.body;
  const ebayCarrier = EBAY_CARRIER_CODES[shippingCarrierCode] || shippingCarrierCode;
  try {
    const headers  = await ebayHeaders();
    const response = await fetch(
      `${EBAY_API}/sell/fulfillment/v1/order/${encodeURIComponent(id)}/shipping_fulfillment`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          lineItems:           lineItemIds.map(id => ({ lineItemId: id, quantity: 1 })),
          trackingNumber,
          shippingCarrierCode: ebayCarrier,
          shippedDate:         new Date().toISOString(),
        }),
      }
    );
    if (response.status === 201) return res.status(201).json({ ok: true });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'eBay tracking push failed', detail: e.message });
  }
});
```

- [ ] **Commit:**
```bash
git add server/ebay.js
git commit -m "feat: tracking endpoint accepts lineItemIds array for multi-item orders ref #112"
```

---

## Task 2: Store — add multi-item order state

**Files:**
- Modify: `public/v2/js/store.js`

The store currently has `activeEbayOrderId: null`. We add two parallel properties to carry multi-item context into the label modal.

- [ ] **Find the store init block (around line 18) and add two properties after `activeEbayOrderId`:**

```js
activeEbayOrderId:   null,
activeEbayLineItemIds: [],   // all lineItemIds for current multi-item order
activeEbayOrderRecs:   [],   // all matched local recs for the order (primary first)
```

- [ ] **Commit:**
```bash
git add public/v2/js/store.js
git commit -m "feat: add activeEbayLineItemIds and activeEbayOrderRecs to store ref #112"
```

---

## Task 3: eBay modal — rewrite `_process()` to group all lineItems

**Files:**
- Modify: `public/v2/js/modals/ebay-modal.js:70-94`

Currently `_process()` does `order.lineItems?.[0]` and builds `matched` as `[{ order, rec, lineItem }]`. We change it so each matched entry represents a whole order with all its items: `{ order, items: [{ lineItem, rec }] }`. This lets the UI render every disc in the order.

- [ ] **Replace the `_process()` loop body (lines 75–93) with:**

```js
for (const order of this.orders) {
  const items = (order.lineItems || []).map(lineItem => {
    const legacyId = lineItem.legacyItemId ? String(lineItem.legacyItemId) : null;
    const rec = legacyId
      ? dw.records.find(r =>
          (r.listings || []).some(l =>
            l.site?.name === 'eBay' && l.platform_listing_id === legacyId
          )
        )
      : null;
    return { lineItem, rec };
  });

  const matchedItems = items.filter(i => i.rec);
  const allShipped   = matchedItems.every(i => i.rec.shipment?.tracking_number);

  if (matchedItems.length > 0 && !allShipped) {
    this.matched.push({ order, items });
  } else if (matchedItems.length === 0) {
    this.unmatched.push(order);
  }
}
```

Note: `items` on a matched entry includes ALL lineItems for the order, even unmatched ones (so the UI can display them). `allShipped` skips orders where every matched rec already has tracking.

- [ ] **Update `openShip()` to pass all lineItemIds and all matched recs:**

Replace the current `openShip(rec, order)`:
```js
openShip(orderEntry) {
  const dw = Alpine.store('dw');
  dw.activeEbayOrderId      = orderEntry.order.orderId;
  dw.activeEbayLineItemIds  = orderEntry.items.map(i => i.lineItem.lineItemId);
  dw.activeEbayOrderRecs    = orderEntry.items.filter(i => i.rec).map(i => i.rec);
  dw.previousModal          = { type: 'ebay' };
  // Open label modal using the first matched rec as primary
  const primaryRec = dw.activeEbayOrderRecs[0];
  if (primaryRec) dw.openModal('label', primaryRec.id);
},
```

- [ ] **Update helper methods `lineItemTitle()` and `lineItemId()` — these are now unused by the template (we'll render per-item in Task 4), but leave them for unmatched rendering:**

`lineItemTitle(order)` still works for the unmatched section since it reads `order.lineItems?.[0]?.title`. No change needed.

- [ ] **Commit:**
```bash
git add public/v2/js/modals/ebay-modal.js
git commit -m "feat: _process() groups all lineItems per order, openShip passes full item set ref #112"
```

---

## Task 4: index.html — update matched order row template

**Files:**
- Modify: `public/v2/index.html` around line 2083–2101

The current template renders one row per matched order showing `lineItemTitle(item.order)`. We update it to show a list of items (each with SKU + title) and change the `openShip` call signature.

- [ ] **Find the matched orders template (around line 2083) and replace the inner content:**

Change from:
```html
<template x-for="item in matched" :key="item.order.orderId">
  <div style="padding:10px 0;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;color:var(--white);margin-bottom:3px" x-text="lineItemTitle(item.order)"></div>
      <div style="font-size:11px;color:var(--muted)" x-text="buyerName(item.order)"></div>
      <div style="font-size:10px;color:#555;margin-top:2px">
        <span x-text="'Order: ' + item.order.orderId"></span>
        <template x-if="item.lineItem?.sku">
          <span x-text="' · SKU: ' + item.lineItem.sku" style="color:#666"></span>
        </template>
      </div>
    </div>
    <div style="flex-shrink:0;margin-top:2px">
      <button @click="openShip(item.rec, item.order)"
        style="padding:5px 14px;background:var(--blue);color:#fff;border:none;font-family:'Space Mono',monospace;font-weight:700;font-size:10px;letter-spacing:2px;cursor:pointer">
        SHIP
      </button>
    </div>
  </div>
</template>
```

To:
```html
<template x-for="item in matched" :key="item.order.orderId">
  <div style="padding:10px 0;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px" x-text="buyerName(item.order)"></div>
      <template x-for="entry in item.items" :key="entry.lineItem.lineItemId">
        <div style="margin-bottom:3px">
          <span style="font-size:12px;color:var(--white)" x-text="entry.lineItem.title || '(unknown)'"></span>
          <template x-if="entry.lineItem.sku">
            <span style="font-size:10px;color:var(--muted);margin-left:6px" x-text="entry.lineItem.sku"></span>
          </template>
          <template x-if="!entry.rec">
            <span style="font-size:10px;color:#f66;margin-left:6px">no local match</span>
          </template>
        </div>
      </template>
      <div style="font-size:10px;color:#555;margin-top:3px" x-text="'Order: ' + item.order.orderId"></div>
    </div>
    <div style="flex-shrink:0;margin-top:2px">
      <button @click="openShip(item)"
        style="padding:5px 14px;background:var(--blue);color:#fff;border:none;font-family:'Space Mono',monospace;font-weight:700;font-size:10px;letter-spacing:2px;cursor:pointer">
        SHIP
      </button>
    </div>
  </div>
</template>
```

Note: `openShip(item)` now receives the whole order entry (not `rec, order` separately) — matching the updated method signature from Task 3.

- [ ] **Commit:**
```bash
git add public/v2/index.html
git commit -m "feat: matched order rows show all items with SKU and title ref #112"
```

---

## Task 5: Label modal — read multi-item store state, update markShippedEbay and saveShipment

**Files:**
- Modify: `public/v2/js/modals/label-modal.js`

Three changes:
1. On open, read `dw.activeEbayLineItemIds` and `dw.activeEbayOrderRecs` from store (clearing them so they don't leak)
2. `markShippedEbay()` sends the full `lineItemIds` array
3. `saveShipment()` loops all recs to mark each sold and create a shipment record

### 5a — State properties and init

- [ ] **Add two properties to the data init block (alongside `ebayLineItemId: null`):**

```js
ebayLineItemId:   null,   // keep for single-item compat / fallback
ebayLineItemIds:  [],     // all lineItemIds for multi-item order
ebayOrderRecs:    [],     // all matched recs for the order (primary is index 0)
```

- [ ] **In the `open()` method, after the block that reads `dw.activeEbayOrderId` (around line 88), add:**

```js
// Multi-item order state (set by ebay modal's openShip)
this.ebayLineItemIds = dw.activeEbayLineItemIds?.length
  ? [...dw.activeEbayLineItemIds]
  : (this.ebayLineItemId ? [this.ebayLineItemId] : []);
dw.activeEbayLineItemIds = [];

this.ebayOrderRecs = dw.activeEbayOrderRecs?.length
  ? [...dw.activeEbayOrderRecs]
  : [];
dw.activeEbayOrderRecs = [];
```

Place this immediately after the existing line that clears `dw.activeEbayOrderId`:
```js
dw.activeEbayOrderId = null; // clear so it doesn't leak
```

### 5b — Update markShippedEbay

- [ ] **Replace the current `markShippedEbay()` method body:**

```js
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
```

### 5c — Update saveShipment to loop all recs

The current `saveShipment()` handles one rec (the one the modal opened with). For multi-item orders, after saving the primary rec normally, we loop through secondary recs (`ebayOrderRecs` index 1+) to mark them sold and create their shipment records.

- [ ] **After the existing `try` block in `saveShipment()` (after the primary rec's shipment is created, before `this.saveMsg = '✓ saved'`), insert:**

```js
// For multi-item eBay orders: mark secondary recs sold and attach tracking
if (this.ebayOrderRecs.length > 1) {
  const dw = Alpine.store('dw');
  const trackingFields = {
    carrier:         this.carrier || null,
    service:         this.purchaseResult?.service || null,
    tracking_id:     this.purchaseResult?.trackingId     || null,
    tracking_number: this.purchaseResult?.trackingNumber || null,
    tracker_url:     this.purchaseResult?.trackerUrl     || null,
    label_url:       this.purchaseResult?.labelUrl       || null,
    shipping_cost:   0, // $0 on secondary recs; actual cost on primary only
  };

  for (const secRec of this.ebayOrderRecs.slice(1)) {
    // Create/update order for secondary rec
    let secOrderId;
    if (secRec.order) {
      await dw.updateOrder(secRec.order.id, {
        sale_price:          null,
        date_sold:           this.platformSaleDate || new Date().toISOString().split('T')[0],
        platform_order_num:  this.ebayOrderId,
      });
      secOrderId = secRec.order.id;
    } else {
      const secListing = dw.activeListing(secRec);
      const newOrder = await dw.createOrder({
        listing_id:         secListing?.id || null,
        sale_price:         null,
        date_sold:          this.platformSaleDate || new Date().toISOString().split('T')[0],
        platform_order_num: this.ebayOrderId,
      });
      secOrderId = newOrder.id;
    }

    if (secRec.status !== 'Sold') {
      await dw.updateItem(secRec.id, { status: 'Sold' });
    }

    if (secRec.shipment) {
      await dw.updateShipment(secRec.shipment.id, trackingFields);
    } else {
      await dw.createShipment({ order_id: secOrderId, ...trackingFields });
    }
  }
}
```

- [ ] **Confirm `markShippedEbay` is called after `saveShipment` in the purchase flow (check the button handler in index.html calls both)** — no change needed if the existing call to `markShippedEbay()` on line ~228 still fires after save.

- [ ] **Commit:**
```bash
git add public/v2/js/modals/label-modal.js
git commit -m "feat: label modal saves tracking to all recs and notifies eBay for all lineItemIds ref #112"
```

---

## Task 6: Manual verification checklist

No automated tests in this project — verify in the browser.

- [ ] **Single-item order (regression):** Open eBay modal, find a single-disc pending order. Confirm it still renders with title + SKU, Ship button opens label modal, tracking push succeeds.

- [ ] **Multi-item order (happy path):** Using a real multi-disc eBay order (or a test order if available):
  - eBay modal shows all discs in the order, each with title + SKU
  - "no local match" warning appears for any disc without a local record
  - Ship button opens label modal for the primary rec
  - After purchasing label, both/all recs are marked Sold in the DB
  - Each rec has `tracking_number` + `tracker_url` saved to its shipment
  - eBay receives one tracking push covering all lineItemIds (check eBay Seller Hub for order status = Shipped)

- [ ] **Already-shipped orders don't appear:** Confirm an order where all matched recs already have `tracking_number` is excluded from the pending list.

- [ ] **Commit any fixes found during verification, then bump patch version:**
```bash
# In public/v2/js/config.js, increment APP_VERSION
# In package.json, increment version field
git add public/v2/js/config.js package.json
git commit -m "chore: v1.1.X — multi-item eBay order support ref #112"
git push
```

---

## Notes

- **Shipping cost**: Primary rec gets the actual `shipping_cost`; secondary recs get `0`. This way the estimated shipping on secondary listings resolves to a real (zero) value rather than staying as an estimate, while the true cost lives on the primary.
- **GitHub issue**: #112
