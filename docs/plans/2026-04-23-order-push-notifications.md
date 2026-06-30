# Order Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OS-level browser push notifications that fire when the order count increases, with a 5-minute background poller and a hidden test page at `/push-test`.

**Architecture:** A new `notifications.js` module owns all notification logic (permission, delta tracking, firing). `store.js` calls into it from the ORDERS button click and from `checkOrders()`. A `setInterval` in `store.js` `init()` drives the poller. A standalone `/push-test` route in `server.js` serves a minimal HTML page for testing without waiting for real orders.

**Tech Stack:** Browser Notification API, Alpine.js store, Express (server.js), vanilla JS (no build step)

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `public/v2/js/notifications.js` | All notification logic: constants, permission, delta tracking, firing |
| Modify | `public/v2/index.html` | Add `<script src="js/notifications.js">` before `store.js` |
| Modify | `public/v2/js/store.js` | Wire poller in `init()`, call `requestPermission()` on ORDERS click, call `checkAndNotify()` in `checkOrders()` |
| Modify | `server.js` | Add `GET /push-test` route serving standalone test HTML |

---

## Task 1: Create `notifications.js`

**Files:**
- Create: `public/v2/js/notifications.js`

- [ ] **Step 1: Create the file with constants and module object**

```js
const POLL_INTERVAL_MS   = 5 * 60 * 1000;
const NOTIFICATION_TITLE = 'New Orders';
const NOTIFICATION_BODY  = 'You have {count} orders awaiting shipment';
const NOTIFICATION_TAG   = 'dw-orders';
const NOTIFICATION_ICON  = '';

const DwNotifications = {
  lastOrderCount: null,

  async requestPermission() {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  },

  notify(title, body, tag) {
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body, tag, icon: NOTIFICATION_ICON });
  },

  checkAndNotify(count) {
    if (this.lastOrderCount === null) {
      this.lastOrderCount = count;
      return;
    }
    if (count > this.lastOrderCount) {
      const body = NOTIFICATION_BODY.replace('{count}', count);
      this.notify(NOTIFICATION_TITLE, body, NOTIFICATION_TAG);
    }
    this.lastOrderCount = count;
  },

  get pollIntervalMs() {
    return POLL_INTERVAL_MS;
  },

  // Exposed for test page
  get testTitle()   { return NOTIFICATION_TITLE; },
  get testBody()    { return NOTIFICATION_BODY.replace('{count}', 3); },
  get testTag()     { return NOTIFICATION_TAG; },
};
```

- [ ] **Step 2: Verify the file looks correct**

Open `public/v2/js/notifications.js` and confirm constants are at the top, `DwNotifications` is a plain object, and `checkAndNotify` has the null-baseline guard.

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/notifications.js
git commit -m "feat: add notifications.js module ref #<issue>"
```

---

## Task 2: Load `notifications.js` in `index.html`

**Files:**
- Modify: `public/v2/index.html` (around line 190 — the script block)

- [ ] **Step 1: Add the script tag before `store.js`**

Find this line (around line 190):
```html
<script src="js/config.js"></script>
```

Add `notifications.js` immediately after `config.js` and before `store.js`:
```html
<script src="js/config.js"></script>
<script src="js/notifications.js"></script>
<script src="js/store.js"></script>
```

- [ ] **Step 2: Verify load order in browser console**

Start the server (`npm start`), open `http://localhost:3000`, open DevTools console, type `DwNotifications`. It should return the module object, not `undefined`.

- [ ] **Step 3: Commit**

```bash
git add public/v2/index.html
git commit -m "feat: load notifications.js ref #<issue>"
```

---

## Task 3: Wire `store.js` — poller, permission, delta check

**Files:**
- Modify: `public/v2/js/store.js`

Three separate wiring points. Do them in order.

### 3a — Start the poller in `init()`

- [ ] **Step 1: Add `setInterval` at the end of `init()`**

Current `init()` ends around line 51:
```js
      } catch (e) {
        this.error = 'Failed to initialize: ' + e.message;
      }
    },
```

Add the interval call inside `init()`, after `fetchAll()` completes (still inside the try block, after `await this.fetchAll()`):

```js
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
```

### 3b — Request permission on ORDERS button click

- [ ] **Step 2: Update the ORDERS button in `index.html`**

The ORDERS button is around line 70 of `index.html`. Current click handler:
```html
@click="$store.dw.orderCount > 0 ? ($store.dw.activeView = 'sites', $store.dw.orderCount = null) : $store.dw.checkOrders()"
```

Replace with:
```html
@click="$store.dw.orderCount > 0 ? ($store.dw.activeView = 'sites', $store.dw.orderCount = null) : (DwNotifications.requestPermission(), $store.dw.checkOrders())"
```

### 3c — Call `checkAndNotify` inside `checkOrders()`

- [ ] **Step 3: Add `checkAndNotify` call in `checkOrders()`**

Current `checkOrders()` around line 142:
```js
        this.orderCount = ebayCount + reverbCount;
        if (this.orderCount === 0) {
          setTimeout(() => { if (this.orderCount === 0) this.orderCount = null; }, 2000);
        }
```

Add the `checkAndNotify` call immediately after setting `orderCount`:
```js
        this.orderCount = ebayCount + reverbCount;
        DwNotifications.checkAndNotify(this.orderCount);
        if (this.orderCount === 0) {
          setTimeout(() => { if (this.orderCount === 0) this.orderCount = null; }, 2000);
        }
```

- [ ] **Step 4: Smoke test in browser**

Open `http://localhost:3000`, open DevTools console. Click ORDERS — you should see the browser permission prompt (if never granted before). After granting, click ORDERS again — `DwNotifications.lastOrderCount` should be set to the current order count. Confirm no notification fired on first click (baseline set).

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/store.js public/v2/index.html
git commit -m "feat: wire notifications poller and permission to store ref #<issue>"
```

---

## Task 4: Add `/push-test` route to `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add the route before the static file middleware**

In `server.js`, add this route after the `/api/config` block (around line 44) and before the `app.use(express.static(...))` lines:

```js
app.get('/push-test', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Push Test — Duckwerks</title>
  <style>
    body { font: 14px/1.6 monospace; padding: 40px; background: #111; color: #ccc; }
    h1 { font-size: 16px; letter-spacing: .1em; margin-bottom: 24px; }
    button { display: block; margin-bottom: 12px; padding: 8px 16px; font: 13px monospace; cursor: pointer; background: #222; color: #eee; border: 1px solid #444; }
    button:hover { background: #333; }
    #status { margin-top: 20px; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <h1>Push Notification Test</h1>
  <button onclick="requestPerm()">Request Permission</button>
  <button onclick="fireTest()">Fire Test Notification</button>
  <div id="status"></div>
  <script>
    const TITLE = 'New Orders';
    const BODY  = 'You have 3 orders awaiting shipment';
    const TAG   = 'dw-orders';

    function log(msg) {
      document.getElementById('status').textContent = msg;
    }

    async function requestPerm() {
      const result = await Notification.requestPermission();
      log('Permission: ' + result);
    }

    function fireTest() {
      if (Notification.permission !== 'granted') {
        log('Permission not granted — click Request Permission first');
        return;
      }
      new Notification(TITLE, { body: BODY, tag: TAG });
      log('Notification fired.');
    }
  </script>
</body>
</html>`);
});
```

- [ ] **Step 2: Test the page**

Restart the server (`npm start`), navigate to `http://localhost:3000/push-test`. Confirm both buttons appear. Click "Request Permission" — browser prompt should appear. Click "Fire Test Notification" — an OS notification should appear with title "New Orders" and body "You have 3 orders awaiting shipment". Status line should update after each action.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add /push-test route ref #<issue>"
```

---

## Task 5: Deploy and verify

- [ ] **Step 1: Push and deploy**

```bash
git push origin main
bash scripts/deploy-nuc.sh
```

- [ ] **Step 2: Verify on production**

Navigate to `dash.duckwerks.com/push-test`, confirm it loads. Test permission prompt and test notification. Then navigate to the main app, click ORDERS, confirm no unexpected behavior.
