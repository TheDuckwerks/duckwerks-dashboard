# eBay Order & Listing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate eBay Sell Fulfillment API to sync orders, retrieve buyer shipping addresses, push tracking numbers, and sync listing name/price diffs — mirroring the existing Reverb modal workflow.

**Architecture:** New `server/ebay-auth.js` handles OAuth token lifecycle (one-time setup + auto-refresh). New `server/ebay.js` exposes fulfillment routes. New `public/v2/js/modals/ebay-modal.js` provides the frontend sync modal, following the same three-section pattern as `reverb-modal.js`. Label modal gets minor updates to handle eBay order addresses alongside Reverb. A `activeEbayOrderId` temp field on the store bridges the eBay modal → label modal for address lookup before an order record is saved.

**Tech Stack:** eBay Sell Fulfillment API v1 (REST), eBay OAuth 2.0 Authorization Code Grant, Express, Alpine.js, existing EasyPost label flow.

---

## Key Differences vs Reverb

- **Auth:** Reverb uses a static PAT. eBay requires OAuth with short-lived access tokens (2hr) and long-lived refresh tokens (18 months). One-time browser setup flow, then fully automatic.
- **Orders:** eBay order IDs are strings (e.g. `12-34567-89012`). Fulfillment status filter: `orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`.
- **Matching:** eBay order line items include `legacyItemId` — the eBay listing ID. This maps to `listing.platform_listing_id` in our store, exactly like Reverb's `product_id` maps to `platform_listing_id`.
- **Tracking push:** POST to `/sell/fulfillment/v1/order/{orderId}/shipping_fulfillment`. Carrier codes use eBay's own values (see Task 3).
- **Listing sync:** eBay's REST listing APIs require managed inventory. Deferred to follow-up — see notes.
- **Shipping address:** Lives at `order.buyer.buyerRegistrationAddress` (not a separate `shipping_address` field like Reverb).

---

## Pre-Implementation: eBay Developer Portal Setup

Before writing code, complete these steps in the eBay developer portal:

1. Go to **Application Keys → User Tokens** for the `duckwerks_dash` **Production** app
2. Under **"Your auth accepted URL"**, add: `http://localhost:3000/api/ebay/auth/callback`
3. Save — eBay will display a **RuName** (e.g. `GeoffGos-duckwerksd-PRD-xxxx`). Copy it.
4. From the Application Keys page, copy:
   - **App ID (Client ID):** from Application Keys page
   - **Cert ID (Client Secret):** found under the Production keyset (the "Rotate (Reset) Cert ID" row)
   - **RuName:** from User Tokens → Your eBay Sign-in Settings table

> **OAuth callback note:** eBay Production requires HTTPS for callback URLs. Since this is a local tool, the flow uses `https://duckwerks.com/ebay-oauth-callback.php` as the registered callback. That page displays the authorization code; you then exchange it manually via `POST /api/ebay/auth/exchange` on localhost. One-time setup only.

> **Note:** The authorize URL (`https://auth.ebay.com/oauth2/authorize`) is for Production. If you ever test with Sandbox credentials, change it to `https://auth.sandbox.ebay.com/oauth2/authorize`.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `server/ebay-auth.js` | Create | OAuth flow + token read/write/refresh |
| `server/ebay.js` | Create | Fulfillment API routes (orders, tracking, listings) |
| `server.js` | Modify | Mount new eBay routers |
| `public/v2/js/modals/ebay-modal.js` | Create | eBay sync modal (Alpine component) |
| `public/v2/js/modals/label-modal.js` | Modify | Support eBay order address alongside Reverb |
| `public/v2/js/store.js` | Modify | Add `activeEbayOrderId` temp field |
| `public/v2/index.html` | Modify | Add Sync eBay button, modal container, script tag |
| `data/ebay-tokens.json` | Runtime | Persisted OAuth tokens — never commit |
| `.env` | Modify | Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME |
| `.gitignore` | Modify | Exclude data/ebay-tokens.json |

---

## Task 1: Credentials + Token Storage

**Files:**
- Modify: `.env`
- Modify: `.gitignore`

- [ ] **Step 1: Add eBay credentials to .env**

```
EBAY_CLIENT_ID=<from eBay developer portal — App ID>
EBAY_CLIENT_SECRET=<from eBay developer portal — Cert ID>
EBAY_RUNAME=<from eBay developer portal — RuName>
```

- [ ] **Step 2: Check existing .gitignore for data/ coverage**

```bash
grep "data/" .gitignore
```

If only `data/duckwerks.db` is listed (not `data/`), add `data/ebay-tokens.json` explicitly. If `data/` is already fully ignored, skip.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "ref #31: add eBay token file to .gitignore"
```

---

## Task 2: server/ebay-auth.js — OAuth + Token Management

**Files:**
- Create: `server/ebay-auth.js`

eBay access tokens expire in 2 hours. Refresh tokens last 18 months and do not change on refresh — the original refresh token stays valid until its own expiry.

eBay OAuth endpoints:
- Authorize: `https://auth.ebay.com/oauth2/authorize`
- Token exchange: `https://api.ebay.com/identity/v1/oauth2/token`
- Scope: `https://api.ebay.com/oauth/api_scope/sell.fulfillment`

- [ ] **Step 1: Create server/ebay-auth.js**

```js
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '../data/ebay-tokens.json');
const TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const AUTH_URL   = 'https://auth.ebay.com/oauth2/authorize';
const SCOPES     = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment';

function clientCredentials() {
  const id     = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); }
  catch { return null; }
}

function writeTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

async function refreshAccessToken(refreshToken) {
  // Note: do NOT send `scope` in the refresh body — eBay rejects it.
  // The refreshed token inherits scopes from the original grant.
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${clientCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token refresh failed: ${text}`);
  }
  return res.json();
}

async function getAccessToken() {
  const tokens = readTokens();
  if (!tokens) throw new Error('eBay not authorized. Visit /api/ebay/auth to set up.');

  const expiresAt = tokens.expires_at || 0;
  if (Date.now() < expiresAt - 60_000) {
    return tokens.access_token; // Still valid with 1-minute buffer
  }

  // Refresh — refresh_token itself stays the same across refreshes
  const fresh = await refreshAccessToken(tokens.refresh_token);
  const updated = {
    ...tokens,
    access_token: fresh.access_token,
    expires_at:   Date.now() + fresh.expires_in * 1000,
  };
  writeTokens(updated);
  return updated.access_token;
}

function authRedirectUrl() {
  // redirect_uri must be the RuName (eBay's alias for the registered callback URL)
  // The actual redirect goes to duckwerks.com/ebay-oauth-callback.php
  const params = new URLSearchParams({
    client_id:     process.env.EBAY_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  process.env.EBAY_RUNAME,
    scope:         SCOPES,
    state:         'duckwerks',
  });
  return `${AUTH_URL}?${params}`;
}

async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${clientCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: process.env.EBAY_RUNAME,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token exchange failed: ${text}`);
  }
  return res.json();
}

module.exports = { getAccessToken, authRedirectUrl, exchangeCodeForTokens, readTokens, writeTokens };
```

- [ ] **Step 2: Verify it loads without errors**

```bash
node -e "require('./server/ebay-auth')"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/ebay-auth.js
git commit -m "ref #31: add eBay OAuth token management"
```

---

## Task 3: server/ebay.js — Routes + Auth Flow

**Files:**
- Create: `server/ebay.js`
- Modify: `server.js`

**eBay carrier codes** — eBay uses its own carrier code strings for `createShippingFulfillment`. Map from EasyPost carrier names (from `CARRIER_NAMES` in `server/label.js`) to eBay codes:

| EasyPost carrier | eBay carrier code |
|---|---|
| USPS | `USPS` |
| UPS | `UPS` |
| FedEx | `FEDEX` |
| DHL | `DHL` |

The `shippingCarrierCode` in the tracking POST comes from the client (the eBay modal will pass the carrier from the label purchase result).

**Filter note:** The `orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}` filter must be passed as a raw string — `URLSearchParams` URL-encodes the `{`, `}`, and `|` characters which eBay may reject. Build the query string manually for this parameter.

- [ ] **Step 1: Create server/ebay.js**

```js
const express = require('express');
const router  = express.Router();
const { getAccessToken, authRedirectUrl, exchangeCodeForTokens, writeTokens } = require('./ebay-auth');

const EBAY_API = 'https://api.ebay.com';

// Map EasyPost carrier names to eBay carrier codes
const EBAY_CARRIER_CODES = {
  'USPS':   'USPS',
  'UPS':    'UPS',
  'FedEx':  'FEDEX',
  'DHL':    'DHL',
};

async function ebayHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
  };
}

// ── OAuth setup routes ────────────────────────────────────────────────────────

// Step 1: redirect to eBay consent page (visit in browser once)
router.get('/auth', (req, res) => {
  res.redirect(authRedirectUrl());
});

// Step 2: eBay redirects to duckwerks.com/ebay-oauth-callback.php which
// displays the code. Paste it into the curl command shown on that page,
// which hits this endpoint to complete the exchange.
router.post('/auth/exchange', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const tokens = await exchangeCodeForTokens(code);
    writeTokens({
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    Date.now() + tokens.expires_in * 1000,
    });
    res.json({ ok: true, message: 'eBay authorization complete.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Fulfillment routes ────────────────────────────────────────────────────────

// GET /api/ebay/orders — orders awaiting fulfillment
// Filter is passed as raw string to avoid URLSearchParams encoding { } |
router.get('/orders', async (req, res) => {
  try {
    const headers  = await ebayHeaders();
    const url      = `${EBAY_API}/sell/fulfillment/v1/order?filter=orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}&limit=50`;
    const response = await fetch(url, { headers });
    const data     = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'eBay orders request failed', detail: e.message });
  }
});

// GET /api/ebay/orders/:id — single order (address + line item lookup)
router.get('/orders/:id', async (req, res) => {
  try {
    const headers  = await ebayHeaders();
    const response = await fetch(
      `${EBAY_API}/sell/fulfillment/v1/order/${encodeURIComponent(req.params.id)}`,
      { headers }
    );
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'eBay order request failed', detail: e.message });
  }
});

// POST /api/ebay/orders/:id/tracking — push tracking number
router.post('/orders/:id/tracking', async (req, res) => {
  const { id } = req.params;
  const { lineItemId, quantity, trackingNumber, shippingCarrierCode } = req.body;
  const ebayCarrier = EBAY_CARRIER_CODES[shippingCarrierCode] || shippingCarrierCode;
  try {
    const headers  = await ebayHeaders();
    const response = await fetch(
      `${EBAY_API}/sell/fulfillment/v1/order/${encodeURIComponent(id)}/shipping_fulfillment`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          lineItems:           [{ lineItemId, quantity: quantity || 1 }],
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

module.exports = router;
```

- [ ] **Step 2: Mount in server.js**

Add after the existing router mounts:
```js
app.use('/api/ebay', require('./server/ebay'));
```

Add startup log alongside the shipping provider log:
```js
const ebayAuth = require('./server/ebay-auth');
console.log('eBay auth:', ebayAuth.readTokens() ? 'tokens present' : 'NOT AUTHORIZED — visit /api/ebay/auth');
```

- [ ] **Step 3: Restart + run OAuth setup**

```bash
npm start
```

First, deploy the duckwerks callback page (from the duckwerks project):
```bash
cd ~/projects/duckwerks && npm run build && ./deploy.sh
```

Then visit `http://localhost:3000/api/ebay/auth` in the browser. Sign in with your eBay seller account. eBay redirects to `https://duckwerks.com/ebay-oauth-callback.php?code=...` which displays the code and a pre-filled `curl` command. Run that curl command in your terminal to exchange the code for tokens.

Verify token file:
```bash
cat data/ebay-tokens.json
```
Expected: JSON with `access_token`, `refresh_token`, `expires_at`.

- [ ] **Step 4: Smoke test orders endpoint**

```bash
curl -s "http://localhost:3000/api/ebay/orders" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('total:', d.total, 'first orderId:', d.orders?.[0]?.orderId)"
```
Expected: `total: N` and an order ID (or `total: 0` if no open orders).

- [ ] **Step 5: Commit**

```bash
git add server/ebay.js server.js
git commit -m "ref #31: add eBay fulfillment routes + OAuth setup flow"
```

---

## Task 4: store.js — Add activeEbayOrderId

**Files:**
- Modify: `public/v2/js/store.js`

When the eBay modal opens the label modal via the SHIP button, it needs to pass the eBay orderId so the label modal can fetch the buyer's address. Since label-modal reads from the store, we add a temp field — same pattern as `activeRecordId`.

- [ ] **Step 1: Grep for activeRecordId in store.js to find the state block**

```bash
grep -n "activeRecordId\|activeModal\|previousModal" public/v2/js/store.js | head -10
```

- [ ] **Step 2: Add activeEbayOrderId to the store's state**

In the same block where `activeModal`, `activeRecordId`, and `previousModal` are defined, add:

```js
activeEbayOrderId: null,
```

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/store.js
git commit -m "ref #31: add activeEbayOrderId to store for label modal bridge"
```

---

## Task 5: label-modal.js — Support eBay Order Addresses

**Files:**
- Modify: `public/v2/js/modals/label-modal.js`

The label modal currently fetches the Reverb order to pre-fill shipping address when `listing?.site?.name === 'Reverb'`. Add a parallel eBay branch using `activeEbayOrderId` from the store.

- [ ] **Step 1: Read the address pre-fill section**

```bash
grep -n "reverb\|shipping_address\|reverbOrder\|toAddress\|site\b" public/v2/js/modals/label-modal.js | head -30
```

- [ ] **Step 2: Add eBay address fetch**

Find the block that checks for Reverb and fetches the order. Add an eBay branch immediately after the Reverb block:

```js
// eBay address pre-fill: activeEbayOrderId is set by ebayModal before opening
const ebayOrderId = Alpine.store('dw').activeEbayOrderId;
if (ebayOrderId && listing?.site?.name === 'eBay') {
  try {
    const res   = await fetch(`/api/ebay/orders/${encodeURIComponent(ebayOrderId)}`);
    const order = await res.json();
    const addr  = order.buyer?.buyerRegistrationAddress;
    if (addr) {
      const c = addr.contactAddress || {};
      this.toAddress = {
        name:    addr.fullName || '',
        street1: c.addressLine1 || '',
        street2: c.addressLine2 || '',
        city:    c.city || '',
        state:   c.stateOrProvince || '',
        zip:     c.postalCode || '',
        country: c.countryCode || 'US',
        phone:   addr.primaryPhone?.phoneNumber || '',
      };
    }
  } catch (e) {
    console.warn('eBay address fetch failed:', e.message);
  }
}
```

Also clear `activeEbayOrderId` when the label modal closes so it doesn't leak into subsequent modal opens:

```js
// In the modal close/reset handler:
Alpine.store('dw').activeEbayOrderId = null;
```

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/modals/label-modal.js
git commit -m "ref #31: label modal fetches eBay order address via activeEbayOrderId"
```

---

## Task 6: public/v2/js/modals/ebay-modal.js — Sync Modal

**Files:**
- Create: `public/v2/js/modals/ebay-modal.js`

Three sections mirroring `reverb-modal.js`:

1. **Awaiting Shipment** — eBay orders matched to local records by `legacyItemId` (from order line item) ↔ `listing.platform_listing_id`. Shows buyer name, order ID. SHIP button stashes ebayOrderId + opens label modal.
2. **Link Listings** — unlinked Listed/eBay records (no `platform_listing_id`). Dropdown of unmatched eBay orders by title. SAVE LINKS writes `platform_listing_id`.
3. **Unmatched Orders** — orders with no matching local record. Read-only, for awareness.

**Matching logic:** eBay order line items include `legacyItemId` (the eBay listing number visible in eBay URLs). This maps directly to `listing.platform_listing_id` on local records — same as Reverb's `product_id`.

- [ ] **Step 1: Create public/v2/js/modals/ebay-modal.js**

```js
// ── eBay Sync Modal ───────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('ebayModal', () => ({
    loading:      false,
    errMsg:       '',
    orders:       [],
    matched:      [],
    unmatched:    [],
    unlinkedRecs: [],
    linkSelections: {},
    savingLinks:  false,
    linksMsg:     '',

    init() {
      this.$watch('$store.dw.activeModal', val => {
        if (val === 'ebay') this.run();
      });
    },

    async run() {
      this.loading       = true;
      this.errMsg        = '';
      this.orders        = [];
      this.matched       = [];
      this.unmatched     = [];
      this.unlinkedRecs  = [];
      this.linkSelections = {};
      this.linksMsg      = '';
      try {
        const res = await fetch('/api/ebay/orders');
        if (!res.ok) throw new Error(`Orders HTTP ${res.status}`);
        const data = await res.json();
        this.orders = data.orders || [];
        this._process();
      } catch(e) {
        this.errMsg = e.message;
      } finally {
        this.loading = false;
      }
    },

    _process() {
      const dw = Alpine.store('dw');
      this.matched   = [];
      this.unmatched = [];

      for (const order of this.orders) {
        // Match by legacyItemId from order line items ↔ listing.platform_listing_id
        const lineItem   = order.lineItems?.[0];
        const legacyId   = lineItem ? String(lineItem.legacyItemId) : null;
        const rec = legacyId
          ? dw.records.find(r =>
              (r.listings || []).some(l =>
                l.site?.name === 'eBay' && l.platform_listing_id === legacyId
              )
            )
          : null;

        if (rec) this.matched.push({ order, rec, lineItem });
        else     this.unmatched.push(order);
      }

      // Unlinked: Listed eBay items with no platform_listing_id
      this.unlinkedRecs = dw.records.filter(r => {
        if (r.status !== 'Listed') return false;
        return (r.listings || []).some(
          l => l.site?.name === 'eBay' && l.status === 'active' && !l.platform_listing_id
        );
      });

      const sel = {};
      for (const r of this.unlinkedRecs) sel[r.id] = '';
      this.linkSelections = sel;
    },

    openShip(rec, order) {
      const dw = Alpine.store('dw');
      dw.activeEbayOrderId = order.orderId;
      dw.previousModal     = { type: 'ebay' };
      dw.openModal('label', rec.id);
    },

    async saveLinks() {
      const toLink = this.unlinkedRecs
        .filter(r => this.linkSelections[r.id])
        .map(r => {
          const listing = (r.listings || []).find(
            l => l.site?.name === 'eBay' && l.status === 'active' && !l.platform_listing_id
          );
          return { rec: r, listing, listingId: this.linkSelections[r.id] };
        })
        .filter(({ listing }) => listing);
      if (!toLink.length) { this.linksMsg = 'nothing selected'; return; }

      this.savingLinks = true;
      this.linksMsg    = '';
      let saved = 0, errors = 0;
      const dw = Alpine.store('dw');
      for (const { listing, listingId } of toLink) {
        try {
          await dw.updateListing(listing.id, { platform_listing_id: listingId });
          saved++;
        } catch(e) {
          console.error('eBay saveLinks:', e);
          errors++;
        }
      }
      this.linksMsg    = errors ? `${saved} saved, ${errors} failed` : `✓ ${saved} saved`;
      this.savingLinks = false;
      setTimeout(async () => { await dw.fetchAll(); this._process(); }, 800);
    },

    // Listings available to link — unmatched orders only (already-matched ones are taken)
    get linkableOrders() {
      return this.unmatched;
    },

    buyerName(order) {
      return order.buyer?.buyerRegistrationAddress?.fullName || order.orderId;
    },

    lineItemTitle(order) {
      return order.lineItems?.[0]?.title || '—';
    },

    lineItemId(order) {
      return order.lineItems?.[0]?.legacyItemId ? String(order.lineItems[0].legacyItemId) : '';
    },
  }));
});
```

- [ ] **Step 2: Commit**

```bash
git add public/v2/js/modals/ebay-modal.js
git commit -m "ref #31: add eBay sync modal component"
```

---

## Task 7: index.html — Wire Up Modal + Sidebar Button

**Files:**
- Modify: `public/v2/index.html`

- [ ] **Step 1: Grep for insertion points**

```bash
grep -n "reverb-modal\|reverbModal\|Sync Reverb\|ebay" public/v2/index.html
```

- [ ] **Step 2: Add script tag**

After the `reverb-modal.js` script tag:
```html
<script src="/v2/js/modals/ebay-modal.js"></script>
```

- [ ] **Step 3: Add Sync eBay button to sidebar**

After the "Sync Reverb" button:
```html
<button @click="$store.dw.openModal('ebay')" class="btn-action">Sync eBay</button>
```

- [ ] **Step 4: Add modal overlay**

Copy the Reverb modal container and adapt it for eBay. Three sections:

**Awaiting Shipment** (from `matched`):
- Table: Item Name | eBay Order ID | Buyer | Ship
- Each row: `rec.name`, `order.orderId`, `buyerName(order)`, SHIP button calls `openShip(rec, order)`

**Link Listings** (from `unlinkedRecs`):
- Same pattern as Reverb's link listings section
- Dropdown uses `linkableOrders` — shows `lineItemTitle(order)` as the label, `lineItemId(order)` as the value
- SAVE LINKS button calls `saveLinks()`

**Unmatched Orders** (from `unmatched`):
- Simple list: eBay Order ID + item title (read-only, informational)

Use `x-data="ebayModal"` and `x-show="$store.dw.activeModal === 'ebay'"` following the exact same modal wrapper structure as the Reverb modal.

- [ ] **Step 5: Restart and validate**

```bash
npm start
```

- Click "Sync eBay" in sidebar — modal opens, spinner shows
- Orders load into correct sections
- SHIP button opens label modal with address pre-filled (verify with a real order)
- Close returns to eBay modal

- [ ] **Step 6: Commit**

```bash
git add public/v2/index.html
git commit -m "ref #31: wire up eBay modal in index.html + sidebar button"
```

---

## Follow-up Issues to File After This Plan

1. **eBay listing sync** — determine if account uses managed inventory (Sell Inventory API GET /sell/inventory/v1/offer) or legacy listings (Trading API GetMyeBaySelling). Then implement name/price diff sync matching Reverb's listing details section.
2. **Mark shipped on eBay** — `createShippingFulfillment` auto-transitions order status. Confirm with a real order that no additional call is needed; close follow-up if so.
