# Catalog Intake Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hidden dashboard view with a fast disc intake form that appends rows to the Google Sheet via service account.

**Architecture:** New Express router (`server/catalog-intake.js`) handles three endpoints using `googleapis`. New Alpine view (`public/v2/js/views/catalog.js`) renders the form. `index.html` gets a view container and a footer link. No new CSS file needed — uses existing design tokens.

**Tech Stack:** Node.js/Express, googleapis npm package, Alpine.js, existing dark theme CSS

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `server/catalog-intake.js` | Three API endpoints: next-disc-num, manufacturers, disc POST |
| Modify | `server.js` | Mount new router at `/api/catalog-intake` |
| Create | `public/v2/js/views/catalog.js` | Alpine.data('catalogView') — form state + submit logic |
| Modify | `public/v2/index.html` | Add view container + sidebar footer link + script tag |

---

### Task 1: Install googleapis and wire up the server route

**Files:**
- Modify: `package.json`
- Create: `server/catalog-intake.js`
- Modify: `server.js`

- [ ] **Step 1: Install googleapis**

```bash
npm install googleapis
```

Expected: `googleapis` added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Create `server/catalog-intake.js`**

```js
const { google } = require('googleapis');
const path       = require('path');
const router     = require('express').Router();

const SHEET_ID   = '1Gmdw2qcHRA_9wz29CXul3pTCT92pX56V4FPLkrhNnHE';
const SHEET_NAME = 'duckwerks-dg-catalog';
const KEY_PATH   = path.join(__dirname, '..', 'docs', 'handicaps-244e5d936e6c.json');

function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// GET /api/catalog-intake/next-disc-num
router.get('/next-disc-num', async (req, res) => {
  try {
    const sheets = getSheets();
    const resp   = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    });
    const rows = resp.data.values || [];
    // rows[0] is header; find last non-empty row
    const dataRows = rows.slice(1).filter(r => r[0]);
    const lastNum  = dataRows.length > 0 ? parseInt(dataRows[dataRows.length - 1][0], 10) : 0;
    res.json({ nextDiscNum: (isNaN(lastNum) ? 0 : lastNum) + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog-intake/manufacturers
router.get('/manufacturers', async (req, res) => {
  try {
    const sheets = getSheets();
    const resp   = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!F:F`,
    });
    const rows  = (resp.data.values || []).slice(1); // skip header
    const names = [...new Set(rows.map(r => r[0]).filter(Boolean))].sort();
    res.json({ manufacturers: names });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/catalog-intake/disc
router.post('/disc', async (req, res) => {
  try {
    const { discNum, box, manufacturer, mold, type, plastic, run, notes, condition, weight, color, listPrice } = req.body;
    // Column order: A=Disc#, B=Box, C=ListTitle(blank), D=Description(blank),
    // E=Sold, F=Manufacturer, G=Mold, H=Type, I=Plastic, J=Run/Edition,
    // K=Notes, L=Condition, M=Weight, N=Color, O=EstValue(blank), P=ListPrice, Q=Platform, R=Status(blank)
    const row = [
      discNum,       // A
      box,           // B
      '',            // C List Title
      '',            // D Description
      'FALSE',       // E Sold
      manufacturer,  // F
      mold,          // G
      type,          // H
      plastic,       // I
      run || '',     // J Run/Edition
      notes || '',   // K Notes
      condition,     // L
      weight,        // M
      color,         // N
      '',            // O Est. Value
      listPrice,     // P
      'Ebay',        // Q Platform
      '',            // R Status
    ];
    const sheets = getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:R`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });
    res.json({ discNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 3: Mount the router in `server.js`**

Add after the existing `/api/comps` line:

```js
app.use('/api/catalog-intake', require('./server/catalog-intake'));
```

- [ ] **Step 4: Verify server starts without errors**

```bash
npm start
```

Expected: server starts, no crash. Visit `http://localhost:3000` to confirm.

- [ ] **Step 5: Smoke-test the endpoints**

```bash
curl http://localhost:3000/api/catalog-intake/next-disc-num
# Expected: {"nextDiscNum":169} (or similar)

curl http://localhost:3000/api/catalog-intake/manufacturers
# Expected: {"manufacturers":["AGL","Axiom","Discmania",...]}
```

- [ ] **Step 6: Commit**

```bash
git add server/catalog-intake.js server.js package.json package-lock.json
git commit -m "add catalog-intake server routes (next-disc-num, manufacturers, disc POST)"
```

---

### Task 2: Add the Alpine view

**Files:**
- Create: `public/v2/js/views/catalog.js`

- [ ] **Step 1: Create `public/v2/js/views/catalog.js`**

```js
// ── Catalog Intake View ────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('catalogView', () => ({
    // form state
    nextDiscNum:   null,
    box:           localStorage.getItem('catalog_box') || '',
    manufacturer:  '',
    mold:          '',
    type:          '',
    plastic:       '',
    run:           '',
    notes:         '',
    condition:     'Unthrown',
    weight:        175,
    color:         '',
    listPrice:     25,

    // ui state
    manufacturers: [],
    toast:         null,   // { msg, ok }
    submitting:    false,

    TYPES: ['Distance Driver', 'Fairway Driver', 'Midrange', 'Putter'],
    COLORS: [
      'Beige','Black','Blue','Bronze','Brown','Gold','Gray','Green',
      'Multi-Color','Orange','Pink','Purple','Red','Silver','White','Yellow',
    ],

    async init() {
      await Promise.all([this._fetchNextDiscNum(), this._fetchManufacturers()]);
    },

    async _fetchNextDiscNum() {
      const res  = await fetch('/api/catalog-intake/next-disc-num');
      const data = await res.json();
      this.nextDiscNum = data.nextDiscNum;
    },

    async _fetchManufacturers() {
      const res  = await fetch('/api/catalog-intake/manufacturers');
      const data = await res.json();
      this.manufacturers = data.manufacturers || [];
    },

    async submit() {
      if (this.submitting) return;
      this.submitting = true;
      try {
        const res  = await fetch('/api/catalog-intake/disc', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            discNum:      this.nextDiscNum,
            box:          this.box,
            manufacturer: this.manufacturer,
            mold:         this.mold,
            type:         this.type,
            plastic:      this.plastic,
            run:          this.run,
            notes:        this.notes,
            condition:    this.condition,
            weight:       this.weight,
            color:        this.color,
            listPrice:    this.listPrice,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        this._showToast(`Disc #${data.discNum} saved`, true);
        localStorage.setItem('catalog_box', this.box);
        this._reset(data.discNum + 1);
      } catch (err) {
        this._showToast(err.message, false);
      } finally {
        this.submitting = false;
      }
    },

    _reset(nextNum) {
      this.nextDiscNum  = nextNum;
      this.manufacturer = '';
      this.mold         = '';
      this.type         = '';
      this.plastic      = '';
      this.run          = '';
      this.notes        = '';
      this.condition    = 'Unthrown';
      this.weight       = 175;
      this.color        = '';
      this.listPrice    = 25;
      // box kept as-is
      this.$nextTick(() => this.$el.querySelector('[data-focus]')?.focus());
    },

    _showToast(msg, ok) {
      this.toast = { msg, ok };
      setTimeout(() => { this.toast = null; }, 2000);
    },
  }));
});
```

- [ ] **Step 2: Commit**

```bash
git add public/v2/js/views/catalog.js
git commit -m "add catalogView Alpine component"
```

---

### Task 3: Wire up index.html — view container, script tag, sidebar link

**Files:**
- Modify: `public/v2/index.html`

- [ ] **Step 1: Add the script tag**

Find the line (around line 1963):
```html
<script src="js/views/comps.js"></script>
```

Add after it:
```html
<script src="js/views/catalog.js"></script>
```

- [ ] **Step 2: Add the view container**

Find the closing comps view div. The comps view starts with:
```html
<div x-show="$store.dw.activeView === 'comps'" x-data="compsView">
```

After the closing `</div>` of the comps view, add:

```html
    <!-- ── Catalog Intake View ──────────────────────────────────────────── -->
    <div x-show="$store.dw.activeView === 'catalog'" x-data="catalogView" style="padding:24px; max-width:560px">

      <h2 style="font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:2px; margin-bottom:20px; color:var(--white)">Catalog Disc</h2>

      <!-- Toast -->
      <div x-show="toast" x-transition
           :style="toast?.ok ? 'background:var(--green)' : 'background:var(--red)'"
           style="padding:8px 14px; border-radius:4px; margin-bottom:16px; color:#000; font-size:13px; font-weight:bold"
           x-text="toast?.msg"></div>

      <form @submit.prevent="submit" style="display:flex; flex-direction:column; gap:12px">

        <!-- Disc # -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">DISC #</label>
          <span style="color:var(--yellow); font-family:'Bebas Neue',sans-serif; font-size:22px" x-text="nextDiscNum ?? '…'"></span>
        </div>

        <!-- Box -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">BOX</label>
          <input data-focus type="text" x-model="box" placeholder="e.g. S1"
                 style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
        </div>

        <!-- Manufacturer -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">MANUFACTURER</label>
          <select x-model="manufacturer"
                  style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
            <option value="">— select —</option>
            <template x-for="m in manufacturers" :key="m">
              <option :value="m" x-text="m"></option>
            </template>
          </select>
        </div>

        <!-- Mold -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">MOLD</label>
          <input type="text" x-model="mold" placeholder="e.g. Envy"
                 style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
        </div>

        <!-- Type -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">TYPE</label>
          <select x-model="type"
                  style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
            <option value="">— select —</option>
            <template x-for="t in TYPES" :key="t">
              <option :value="t" x-text="t"></option>
            </template>
          </select>
        </div>

        <!-- Plastic -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">PLASTIC</label>
          <input type="text" x-model="plastic" placeholder="e.g. Neutron"
                 style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
        </div>

        <!-- Run/Edition -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">RUN / EDITION</label>
          <input type="text" x-model="run" placeholder="optional"
                 style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
        </div>

        <!-- Notes -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">NOTES</label>
          <input type="text" x-model="notes" placeholder="optional"
                 style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
        </div>

        <!-- Condition -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">CONDITION</label>
          <div style="display:flex; gap:0">
            <button type="button" @click="condition = 'Unthrown'"
                    :style="condition === 'Unthrown' ? 'background:var(--green); color:#000' : 'background:var(--surface); color:var(--muted)'"
                    style="padding:6px 14px; border:1px solid var(--border); border-radius:4px 0 0 4px; font-family:inherit; font-size:13px; cursor:pointer">Unthrown</button>
            <button type="button" @click="condition = 'Used'"
                    :style="condition === 'Used' ? 'background:var(--yellow); color:#000' : 'background:var(--surface); color:var(--muted)'"
                    style="padding:6px 14px; border:1px solid var(--border); border-left:none; border-radius:0 4px 4px 0; font-family:inherit; font-size:13px; cursor:pointer">Used</button>
          </div>
        </div>

        <!-- Weight -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">WEIGHT (g)</label>
          <input type="number" x-model.number="weight" min="100" max="200"
                 style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:100px">
        </div>

        <!-- Color -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">COLOR</label>
          <select x-model="color"
                  style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:200px">
            <option value="">— select —</option>
            <template x-for="c in COLORS" :key="c">
              <option :value="c" x-text="c"></option>
            </template>
          </select>
        </div>

        <!-- List Price -->
        <div style="display:flex; gap:16px; align-items:center">
          <label style="color:var(--muted); font-size:11px; letter-spacing:1px; width:120px">LIST PRICE ($)</label>
          <input type="number" x-model.number="listPrice" min="0" step="1"
                 style="background:var(--surface); border:1px solid var(--border); color:var(--white); padding:6px 10px; border-radius:4px; font-family:inherit; font-size:13px; width:100px">
        </div>

        <!-- Submit -->
        <div style="margin-top:8px">
          <button type="submit" :disabled="submitting"
                  style="background:var(--blue); color:#fff; border:none; padding:10px 28px; border-radius:4px; font-family:inherit; font-size:14px; letter-spacing:1px; cursor:pointer"
                  x-text="submitting ? 'Saving…' : 'Save Disc'"></button>
        </div>

      </form>
    </div>
```

- [ ] **Step 3: Add the sidebar footer link**

Find:
```html
    <div style="font-size:10px; color:#444; letter-spacing:1px; text-align:center; padding-bottom:4px" x-data x-text="$store.dw.hostname"></div>
```

Add after it (before `</aside>`):
```html
    <div style="text-align:center; padding-bottom:8px">
      <a @click="$store.dw.activeView = 'catalog'"
         style="font-size:10px; color:#444; letter-spacing:1px; cursor:pointer; text-decoration:none"
         :style="$store.dw.activeView === 'catalog' ? 'color:var(--blue)' : ''"
         >catalog</a>
    </div>
```

- [ ] **Step 4: Restart server and test in browser**

```bash
npm start
```

Open `http://localhost:3000` — click "catalog" in the sidebar footer. Verify:
- Form renders with correct fields
- Disc # shows a number (not "…")
- Manufacturer dropdown has values
- Submit saves a row to the sheet (check the sheet after)
- Toast shows "Disc #N saved"
- Form resets correctly: Box preserved, Disc # incremented, Weight back to 175, List Price back to 25

- [ ] **Step 5: Commit**

```bash
git add public/v2/index.html
git commit -m "add catalog intake form view and sidebar footer link"
```

---

### Task 4: Checkpoint — bump version and push

- [ ] **Step 1: Bump patch version**

In `public/v2/js/config.js`, increment `APP_VERSION` by one patch (e.g. `1.1.25` → `1.1.26`).
In `package.json`, increment `version` to match.

- [ ] **Step 2: Update session log**

Add an entry to `docs/session-log.md` noting the catalog intake form was added.

- [ ] **Step 3: Commit and push**

```bash
git add public/v2/js/config.js package.json docs/session-log.md
git commit -m "bump to v1.1.26, add catalog intake form"
git push
```
