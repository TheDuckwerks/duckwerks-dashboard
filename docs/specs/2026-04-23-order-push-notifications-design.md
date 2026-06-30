# Order Push Notifications — Design Spec

**Date:** 2026-04-23  
**Status:** Approved

---

## Overview

Add browser push notifications to the Duckwerks dashboard so that new eBay and Reverb orders trigger an OS-level notification without requiring the user to manually check. Uses the browser Notification API (no service worker, no backend push agent) with a client-side polling loop.

---

## Architecture

### New file: `public/v2/js/notifications.js`

Owns all notification logic. Exports a plain object (`DwNotifications`) with:

- `POLL_INTERVAL_MS` — configurable at top of file (default: 5 minutes)
- `NOTIFICATION_TITLE` — configurable string
- `NOTIFICATION_BODY_TEMPLATE` — configurable string, `{count}` placeholder replaced at fire time
- `NOTIFICATION_TAG` — configurable string; ensures repeat fires replace rather than stack
- `NOTIFICATION_ICON` — configurable path/URL, defaults to empty (browser default)
- `lastOrderCount` — internal state, `null` until first poll completes (baseline)
- `requestPermission()` — calls `Notification.requestPermission()` if state is `default`; no-ops if `granted` or `denied`
- `checkAndNotify(count)` — core logic: if `lastOrderCount` is `null`, sets baseline silently; if `count > lastOrderCount`, fires notification; always updates `lastOrderCount`
- `notify(title, body, tag)` — thin wrapper around `new Notification(...)`, exported for test page use

### Changes to `public/v2/js/store.js`

- On ORDERS button click: call `DwNotifications.requestPermission()` before the existing `checkOrders()` logic
- In `checkOrders()`: after computing `orderCount`, call `DwNotifications.checkAndNotify(this.orderCount)`
- In `init()`: start a `setInterval` calling `this.checkOrders()` every `DwNotifications.POLL_INTERVAL_MS`

### New route: `server.js`

`GET /push-test` — serves a minimal standalone HTML page (not the app shell). No auth. Contains:
- "Request Permission" button — calls `Notification.requestPermission()`
- "Fire Test Notification" button — calls `new Notification(...)` directly with a fake count of 3, using the same title/body/tag constants as the module

The page is self-contained inline HTML (no partial system), bookmarkable, not linked from the app.

---

## Notification Behavior

| Condition | Action |
|---|---|
| First poll after page load | Set `lastOrderCount` = count, no notification (baseline) |
| `count > lastOrderCount` | Fire notification, update `lastOrderCount` |
| `count <= lastOrderCount` | Update `lastOrderCount` silently, no notification |
| Permission `default` on ORDERS click | Prompt user |
| Permission `granted` | Proceed normally |
| Permission `denied` | Silent no-op, never re-prompt |

Notification content: `"New Orders"` / `"You have {count} orders awaiting shipment"`. Generic count only — per-order detail (item name, platform) is out of scope; `checkOrders()` doesn't return order objects at poll time.

---

## Configurables (top of `notifications.js`)

```js
const POLL_INTERVAL_MS       = 5 * 60 * 1000;
const NOTIFICATION_TITLE     = 'New Orders';
const NOTIFICATION_BODY      = 'You have {count} orders awaiting shipment';
const NOTIFICATION_TAG       = 'dw-orders';
const NOTIFICATION_ICON      = '';
```

These are the extension points for future work: per-platform notifications (eBay vs Reverb), feedback API alerts, different intervals, etc.

---

## Out of Scope

- Service workers / background push (no tab required)
- Per-order detail in notification body (needs order object diffing across polls)
- Per-platform notification splitting (eBay vs Reverb counts separate) — future extension
- Feedback API notifications — future extension
- A settings UI to configure poll interval at runtime
- A "turn off" button — permission is managed via browser settings

---

## Test Page (`/push-test`)

Accessible at `dash.duckwerks.com/push-test`. Not linked from the app. Standalone HTML, no app dependencies. Buttons:
1. **Request Permission** — triggers browser permission prompt
2. **Fire Test Notification** — fires immediately using the same constants, fake count of 3

Used to verify the full OS notification flow without waiting for a real order delta.
