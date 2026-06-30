# Flight Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Speed/Glide/Turn/Fade/Stability to disc golf eBay listings, backed by a SQLite lookup table seeded from `all_discs.csv`.

**Architecture:** `flight_numbers` SQLite table is the persistent source of truth, seeded from CSV (upsertable so it can be refreshed). A `GET /api/flight-numbers` endpoint serves lookups. The catalog-intake form auto-displays flight data when manufacturer+mold are selected (display only — not saved to catalog sheet). `catalog-intake.js` writes flight numbers to the sheet at intake time by looking up the DB. A one-time backfill script populates flight data on existing sheet rows. `bulk-list-discs.js` passes the new columns downstream to `ebay-listings.js` which adds them to the eBay description bullets and item aspects.

**Tech Stack:** Node.js, `better-sqlite3`, `csv-parse/sync`, `googleapis`, Google Sheets API v4, eBay Inventory API, Alpine.js

---

## Sheet Column Layout (current, confirmed)

```
A  Disc #        B  Box           C  List Title    D  Description
E  Sold          F  Manufacturer  G  Mold          H  Type
I  Plastic       J  Run/Edition   K  Notes         L  Condition
M  Weight (g)    N  Color         O  Est. Value    P  List Price
Q  Platform      R  Status        S  Comp Pull
T  speed         U  glide         V  turn          W  fade         X  stability
```

`catalog-intake.js` currently writes A–R (18 cols). Tasks 1+5 extend it to A–X (adding empty Comp Pull at S, then flight numbers T–X).

---

## File Map

| File | Change |
|---|---|
| `server/db.js` | **Modify** — add `flight_numbers` table to schema |
| `scripts/seed-flight-numbers.js` | **Create** — upsert CSV into `flight_numbers` table |
| `server/flight-numbers.js` | **Create** — `GET /api/flight-numbers` router |
| `server.js` | **Modify** — mount flight-numbers router |
| `scripts/backfill-flight-numbers.js` | **Create** — write S–W on existing sheet rows |
| `scripts/bulk-list-discs.js` | **Modify** — add 5 new fields to disc object |
| `server/catalog-intake.js` | **Modify** — lookup + write flight numbers at intake |
| `public/v2/js/views/catalog.js` | **Modify** — auto-display flight numbers on mfg+mold select |
| `server/ebay-listings.js` | **Modify** — description bullets + both aspects blocks |

---

### Task 1: Add `flight_numbers` table + seed script

**Files:**
- Modify: `server/db.js:17` (add table in the `db.exec` block)
- Create: `scripts/seed-flight-numbers.js`

**Context:**
- `docs/tmp/all_discs.csv` columns: `id,name,manufacturer,...,stability,speed,glide,turn,fade,...`
- Lookup key: normalize both strings (lowercase, collapse non-alphanumeric to single space, trim), store as `manufacturer_key` + `mold_key`
- Store raw values too (`manufacturer`, `mold`) for display
- `INSERT OR REPLACE` makes reruns safe
- Same `csv-parse/sync` pattern as `bulk-list-discs.js`

- [ ] **Step 1: Add `flight_numbers` table to `server/db.js`**

In `server/db.js`, inside the `db.exec(`` ... ``)` block, after the `shipments` table and before the closing backtick, add:

```sql

  CREATE TABLE IF NOT EXISTS flight_numbers (
    manufacturer_key TEXT NOT NULL,
    mold_key         TEXT NOT NULL,
    manufacturer     TEXT NOT NULL,
    mold             TEXT NOT NULL,
    speed            REAL,
    glide            REAL,
    turn             REAL,
    fade             REAL,
    stability        REAL,
    PRIMARY KEY (manufacturer_key, mold_key)
  );
```

- [ ] **Step 2: Create `scripts/seed-flight-numbers.js`**

```js
#!/usr/bin/env node
// scripts/seed-flight-numbers.js
// Usage: node scripts/seed-flight-numbers.js [--csv <path>]
// Upserts flight numbers from CSV into the flight_numbers SQLite table.
// Safe to re-run — uses INSERT OR REPLACE.

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const db   = require('../server/db');

const csvPath = (() => {
  const i = process.argv.indexOf('--csv');
  return i >= 0 ? process.argv[i + 1] : path.join(__dirname, '..', 'docs', 'tmp', 'all_discs.csv');
})();

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const upsert = db.prepare(`
  INSERT OR REPLACE INTO flight_numbers
    (manufacturer_key, mold_key, manufacturer, mold, speed, glide, turn, fade, stability)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const csvText = fs.readFileSync(csvPath, 'utf8');
const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });

const run = db.transaction(() => {
  let inserted = 0;
  for (const r of records) {
    if (!r.manufacturer || !r.name) continue;
    upsert.run(
      normalize(r.manufacturer),
      normalize(r.name),
      r.manufacturer,
      r.name,
      parseFloat(r.speed)     || null,
      parseFloat(r.glide)     || null,
      parseFloat(r.turn)      || null,
      parseFloat(r.fade)      || null,
      parseFloat(r.stability) || null,
    );
    inserted++;
  }
  return inserted;
});

const count = run();
console.log(`Seeded ${count} discs from ${csvPath}`);
```

- [ ] **Step 3: Run the seed script**

```bash
node scripts/seed-flight-numbers.js
```

Expected: `Seeded NNNN discs from .../all_discs.csv`

Spot-check:
```bash
node -e "const db=require('./server/db'); console.log(db.prepare('SELECT * FROM flight_numbers WHERE manufacturer_key LIKE ? LIMIT 3').all('innova%'));"
```

Expected: 3 rows with speed/glide/turn/fade/stability populated.

- [ ] **Step 4: Commit**

```bash
git add server/db.js scripts/seed-flight-numbers.js
git commit -m "feat: flight_numbers table + seed script from all_discs.csv ref #108"
git push
```

---

### Task 2: Flight numbers API endpoint

**Files:**
- Create: `server/flight-numbers.js`
- Modify: `server.js` (mount the router)

**Context:**
- Endpoint: `GET /api/flight-numbers?manufacturer=X&mold=Y`
- Normalize query params the same way as the seed script before looking up
- Returns `{ found: true, speed, glide, turn, fade, stability }` or `{ found: false }`
- Check `server.js` for how other routers are mounted (e.g., `app.use('/api/catalog-intake', require('./server/catalog-intake').router)`)

- [ ] **Step 1: Create `server/flight-numbers.js`**

```js
const router = require('express').Router();
const db     = require('./db');

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const lookup = db.prepare(
  'SELECT speed, glide, turn, fade, stability FROM flight_numbers WHERE manufacturer_key = ? AND mold_key = ?'
);

// GET /api/flight-numbers?manufacturer=X&mold=Y
router.get('/', (req, res) => {
  const mfgKey  = normalize(req.query.manufacturer);
  const moldKey = normalize(req.query.mold);
  if (!mfgKey || !moldKey) return res.json({ found: false });
  const row = lookup.get(mfgKey, moldKey);
  if (!row) return res.json({ found: false });
  res.json({ found: true, ...row });
});

module.exports = router;
```

- [ ] **Step 2: Mount in `server.js`**

Find where other `/api/*` routers are mounted. Add:

```js
app.use('/api/flight-numbers', require('./server/flight-numbers'));
```

- [ ] **Step 3: Verify endpoint**

Start server (`npm start`), then:

```bash
curl "http://localhost:3000/api/flight-numbers?manufacturer=Innova&mold=Destroyer"
```

Expected: `{"found":true,"speed":12,"glide":5,"turn":-1,"fade":3,"stability":...}` (values will vary)

```bash
curl "http://localhost:3000/api/flight-numbers?manufacturer=Fake&mold=Disc"
```

Expected: `{"found":false}`

- [ ] **Step 4: Commit**

```bash
git add server/flight-numbers.js server.js
git commit -m "feat: GET /api/flight-numbers lookup endpoint ref #108"
git push
```

---

### Task 3: Backfill existing sheet rows

**Files:**
- Create: `scripts/backfill-flight-numbers.js`

**Context:**
- Sheet: `duckwerks-dg-catalog`, spreadsheet ID `1Gmdw2qcHRA_9wz29CXul3pTCT92pX56V4FPLkrhNnHE`
- Credentials: `docs/handicaps-244e5d936e6c.json`
- Flight number columns: T=speed, U=glide, V=turn, W=fade, X=stability (headers are lowercase in the sheet)
- There is also S=Comp Pull which the script ignores (read-only)
- Script reads the header row dynamically to find column indices — does not hardcode column letters
- Lookup is from the `flight_numbers` SQLite table (seeded in Task 1)
- Dry run by default; `--confirm` to write
- Skip rows already populated (all 5 cells non-empty) unless `--force` is passed

Column letter helper for 0-indexed column number (handles A–Z, AA–AZ, etc.):
```js
function colLetter(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1)
    s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}
```

- [ ] **Step 1: Create `scripts/backfill-flight-numbers.js`**

```js
#!/usr/bin/env node
// scripts/backfill-flight-numbers.js
// Usage: node scripts/backfill-flight-numbers.js [--confirm] [--force]
//   Dry run by default. --confirm writes to sheet. --force overwrites existing values.

const path   = require('path');
const { google } = require('googleapis');
const db     = require('../server/db');

const SHEET_ID   = '1Gmdw2qcHRA_9wz29CXul3pTCT92pX56V4FPLkrhNnHE';
const SHEET_NAME = 'duckwerks-dg-catalog';
const KEY_PATH   = path.join(__dirname, '..', 'docs', 'handicaps-244e5d936e6c.json');

const confirm = process.argv.includes('--confirm');
const force   = process.argv.includes('--force');

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function colLetter(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1)
    s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

function getSheets() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

const lookupFlight = db.prepare(
  'SELECT speed, glide, turn, fade, stability FROM flight_numbers WHERE manufacturer_key = ? AND mold_key = ?'
);

async function main() {
  const sheets = getSheets();
  const resp   = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range:         `${SHEET_NAME}!A:W`,
  });
  const rows    = resp.data.values || [];
  if (rows.length < 2) { console.error('No data rows'); process.exit(1); }

  const headers = rows[0];
  const col     = name => headers.indexOf(name);

  const mfgCol      = col('Manufacturer');
  const moldCol     = col('Mold');
  const speedCol    = col('speed');
  const glideCol    = col('glide');
  const turnCol     = col('turn');
  const fadeCol     = col('fade');
  const stabilityCol = col('stability');

  if ([mfgCol, moldCol, speedCol, glideCol, turnCol, fadeCol, stabilityCol].includes(-1)) {
    const missing = ['Manufacturer','Mold','speed','glide','turn','fade','stability']
      .filter(h => col(h) === -1);
    console.error(`Missing headers: ${missing.join(', ')}\nFound: ${headers.join(', ')}`);
    process.exit(1);
  }

  const startCol = colLetter(speedCol);
  const endCol   = colLetter(stabilityCol);

  let matched = 0, missing = 0, skipped = 0;
  const updates = [];

  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i];
    const mfg  = (row[mfgCol]  || '').trim();
    const mold = (row[moldCol] || '').trim();
    if (!mfg && !mold) continue;

    // Skip already-populated rows unless --force
    const alreadyFilled = row[speedCol] && row[glideCol] && row[turnCol] && row[fadeCol] && row[stabilityCol];
    if (alreadyFilled && !force) { skipped++; continue; }

    const sheetRow = i + 1;
    const flight   = lookupFlight.get(normalize(mfg), normalize(mold));

    if (flight) {
      matched++;
      updates.push({ sheetRow, data: [flight.speed, flight.glide, flight.turn, flight.fade, flight.stability] });
      console.log(`  MATCH  row ${String(sheetRow).padEnd(4)} ${mfg} ${mold}  →  ${flight.speed}/${flight.glide}/${flight.turn}/${flight.fade}  stab:${flight.stability}`);
    } else {
      missing++;
      console.log(`  MISS   row ${String(sheetRow).padEnd(4)} ${mfg} ${mold}`);
    }
  }

  console.log(`\nMatched: ${matched}  |  Not found: ${missing}  |  Already filled (skipped): ${skipped}`);

  if (!confirm) {
    console.log(`\nDry run — pass --confirm to write ${updates.length} rows to ${startCol}:${endCol}`);
    return;
  }

  const data = updates.map(u => ({
    range:  `${SHEET_NAME}!${startCol}${u.sheetRow}:${endCol}${u.sheetRow}`,
    values: [u.data],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
  console.log(`\nWrote flight numbers to ${updates.length} rows.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 2: Dry run**

```bash
node scripts/backfill-flight-numbers.js
```

Expected: table of MATCH/MISS rows, summary, then `Dry run — pass --confirm to write N rows to S:W`. Spot-check a few MATCHes against known discs.

- [ ] **Step 3: Run with --confirm**

```bash
node scripts/backfill-flight-numbers.js --confirm
```

Expected: `Wrote flight numbers to N rows.` Open the sheet and verify S–W are populated on several rows.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-flight-numbers.js
git commit -m "feat: backfill-flight-numbers script — populates S:W on existing sheet rows ref #108"
git push
```

---

### Task 4: Pass flight fields through bulk-list-discs.js

**Files:**
- Modify: `scripts/bulk-list-discs.js:167-181`

**Context:** `p.row[colName]` reads by column header name from the CSV. The sheet has `speed`, `glide`, `turn`, `fade`, `stability` as headers (lowercase) in T–X.

- [ ] **Step 1: Add 5 new fields to the disc object**

In `scripts/bulk-list-discs.js`, find this block (around line 167):

```js
        const disc = {
          id:           p.id,
          title:        p.title,
          listPrice:    p.price,
          description:  p.row['Description']    || '',
          condition:    p.row['Condition']      || '',
          manufacturer: p.row['Manufacturer']   || '',
          mold:         p.row['Mold']           || '',
          type:         p.row['Type']           || '',
          plastic:      p.row['Plastic']        || '',
          color:        p.row['Color']          || '',
          run:          p.row['Run / Edition']  || '',
          weight:       p.row['Weight (g)']     || '',
          notes:        p.row['Notes']          || '',
        };
```

Replace with:

```js
        const disc = {
          id:           p.id,
          title:        p.title,
          listPrice:    p.price,
          description:  p.row['Description']    || '',
          condition:    p.row['Condition']      || '',
          manufacturer: p.row['Manufacturer']   || '',
          mold:         p.row['Mold']           || '',
          type:         p.row['Type']           || '',
          plastic:      p.row['Plastic']        || '',
          color:        p.row['Color']          || '',
          run:          p.row['Run / Edition']  || '',
          weight:       p.row['Weight (g)']     || '',
          notes:        p.row['Notes']          || '',
          speed:        p.row['speed']          || '',
          glide:        p.row['glide']          || '',
          turn:         p.row['turn']           || '',
          fade:         p.row['fade']           || '',
          stability:    p.row['stability']      || '',
        };
```

- [ ] **Step 2: Commit**

```bash
git add scripts/bulk-list-discs.js
git commit -m "feat: pass Speed/Glide/Turn/Fade/Stability through bulk-list disc object ref #108"
git push
```

---

### Task 5: Update catalog-intake.js to write flight numbers at intake

**Files:**
- Modify: `server/catalog-intake.js`

**Context:**
- Current row array covers A–R (18 columns). Extending to A–X adds: S=Comp Pull (empty), T=speed, U=glide, V=turn, W=fade, X=stability.
- Look up from `flight_numbers` DB table at POST time using normalized manufacturer+mold. If no match, write empty strings (not an error).
- `db` is at `./db` (same directory). Import it at the top.
- The existing `resource:` key in the append call needs to change to `requestBody:` — `resource` is the older googleapis v3 style; `requestBody` is v4. Check which one the file currently uses and keep it consistent (don't change if it works).
- Update `range` from `A:R` to `A:X`.

- [ ] **Step 1: Add db import and normalize helper at top of catalog-intake.js**

Find the existing imports at the top of `server/catalog-intake.js`:

```js
const { google } = require('googleapis');
const path       = require('path');
const router     = require('express').Router();
```

Replace with:

```js
const { google } = require('googleapis');
const path       = require('path');
const router     = require('express').Router();
const db         = require('./db');

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const lookupFlight = db.prepare(
  'SELECT speed, glide, turn, fade, stability FROM flight_numbers WHERE manufacturer_key = ? AND mold_key = ?'
);
```

- [ ] **Step 2: Update the POST /disc route to include flight numbers**

Find this block in the POST route (around line 85):

```js
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
```

Replace with:

```js
    const { discNum, box, manufacturer, mold, type, plastic, run, notes, condition, weight, color, listPrice } = req.body;
    const flight = lookupFlight.get(normalize(manufacturer), normalize(mold)) || {};
    // Column order: A=Disc#, B=Box, C=ListTitle(blank), D=Description(blank),
    // E=Sold, F=Manufacturer, G=Mold, H=Type, I=Plastic, J=Run/Edition,
    // K=Notes, L=Condition, M=Weight, N=Color, O=EstValue(blank), P=ListPrice, Q=Platform, R=Status(blank)
    // S=Comp Pull, T=speed, U=glide, V=turn, W=fade, X=stability
    const row = [
      discNum,              // A
      box,                  // B
      '',                   // C List Title
      '',                   // D Description
      'FALSE',              // E Sold
      manufacturer,         // F
      mold,                 // G
      type,                 // H
      plastic,              // I
      run || '',            // J Run/Edition
      notes || '',          // K Notes
      condition,            // L
      weight,               // M
      color,                // N
      '',                   // O Est. Value
      listPrice,            // P
      'Ebay',               // Q Platform
      '',                   // R Status
      '',                   // S Comp Pull
      flight.speed     ?? '', // T
      flight.glide     ?? '', // U
      flight.turn      ?? '', // V
      flight.fade      ?? '', // W
      flight.stability ?? '', // X
    ];
```

- [ ] **Step 3: Update the range in the append call**

Find:

```js
      range: `${SHEET_NAME}!A:R`,
```

Replace with:

```js
      range: `${SHEET_NAME}!A:X`,
```

- [ ] **Step 4: Test — add a disc via the catalog page**

Start server (`npm start`), open the catalog-intake form, submit a disc with a known manufacturer+mold (e.g., Innova Destroyer). Open the sheet and verify the new row has S–W populated.

Submit another with an unknown mold. Verify S–W are blank (not an error).

- [ ] **Step 5: Commit**

```bash
git add server/catalog-intake.js
git commit -m "feat: write flight numbers to sheet at catalog intake time ref #108"
git push
```

---

### Task 6: Auto-display flight numbers on catalog page

**Files:**
- Modify: `public/v2/js/views/catalog.js`
- Modify: `public/v2/index.html` (find catalog section, add display block)

**Context:**
- catalog.js uses Alpine.js `catalogView` component
- The form has `manufacturer` and `mold` / `moldNew` state fields
- Add `$watch` on manufacturer, mold, and moldNew in `init()` to trigger a flight lookup
- Flight data is display-only — not submitted with the form
- If the API returns `found: false`, show nothing (don't clutter the form)
- Grep `index.html` for `catalogView` or `catalog-intake` to find where to add the display block

- [ ] **Step 1: Add flight state and watcher to catalog.js**

In `public/v2/js/views/catalog.js`, add flight state fields to the component data (after `listPrice`):

```js
    listPrice:     '',

    // flight number display (read-only, from DB lookup)
    flightData:    null,
```

In `init()`, add watchers after the existing `await Promise.all(...)`:

```js
    async init() {
      await Promise.all([this._fetchNextDiscNum(), this._fetchManufacturers(), this._fetchMolds(), this._fetchPlastics()]);
      this.$watch('manufacturer', () => this._fetchFlightNumbers());
      this.$watch('mold',         () => this._fetchFlightNumbers());
      this.$watch('moldNew',      () => this._fetchFlightNumbers());
    },
```

Add the `_fetchFlightNumbers` method before `_reset`:

```js
    async _fetchFlightNumbers() {
      const mfg  = this.manufacturer;
      const mold = this.moldNew || this.mold;
      if (!mfg || !mold) { this.flightData = null; return; }
      try {
        const res  = await fetch(`/api/flight-numbers?manufacturer=${encodeURIComponent(mfg)}&mold=${encodeURIComponent(mold)}`);
        const data = await res.json();
        this.flightData = data.found ? data : null;
      } catch { this.flightData = null; }
    },
```

Also clear `flightData` in `_reset`:

```js
    _reset(nextNum) {
      // ... existing reset fields ...
      this.flightData   = null;
```

- [ ] **Step 2: Find the catalog section in index.html**

```bash
grep -n "catalogView\|catalog-intake\|x-data.*catalog\|moldNew\|nextDiscNum" public/v2/index.html | head -20
```

Identify the line range of the catalog form. Find where the weight/color/listPrice fields end — add the flight display block just before the submit button.

- [ ] **Step 3: Add flight numbers display block in index.html**

After the last form field and before the submit button in the catalog section, add:

```html
<!-- flight numbers (auto-populated from lookup, read-only) -->
<div x-show="flightData" x-cloak class="text-xs text-gray-400 mt-1 mb-2">
  <span class="font-medium text-gray-300">Flight:</span>
  Speed <span x-text="flightData?.speed"></span> &nbsp;|&nbsp;
  Glide <span x-text="flightData?.glide"></span> &nbsp;|&nbsp;
  Turn <span x-text="flightData?.turn"></span> &nbsp;|&nbsp;
  Fade <span x-text="flightData?.fade"></span> &nbsp;|&nbsp;
  Stability <span x-text="flightData?.stability"></span>
</div>
```

- [ ] **Step 4: Test in browser**

Open catalog-intake page. Select a manufacturer + mold. Verify flight numbers appear below the fields. Select an unknown mold — verify display disappears. Submit a disc — verify flight numbers still show correctly, form resets cleanly.

- [ ] **Step 5: Commit**

```bash
git add public/v2/js/views/catalog.js public/v2/index.html
git commit -m "feat: auto-display flight numbers on catalog intake when mfg+mold selected ref #108"
git push
```

---

### Task 7: Add flight numbers to eBay description + aspects

**Files:**
- Modify: `server/ebay-listings.js:140-146` (description spec lines)
- Modify: `server/ebay-listings.js:189-196` (bulk-list aspects block)
- Modify: `server/ebay-listings.js:435-443` (bulk-update aspects block)

**Context:**
- Description gets two new bullet lines: `Stability: X` and `Flight Numbers: Speed - X | Glide - X | Turn - X | Fade - X`
- eBay aspect key names come from eBay's item specifics UI (from the ticket): `Speed Rating`, `Glide Rating`, `Turn (Right) Rating`, `Fade (Left) Rating` — stability is not an eBay aspect
- There are TWO identical `aspects` blocks — one in the bulk-list route (~line 189) and one in the bulk-update route (~line 435). Both need the same additions.

- [ ] **Step 1: Add Stability + Flight Numbers to description spec lines**

In `server/ebay-listings.js`, find this block (lines ~140–146):

```js
  if (disc.manufacturer) lines.push(`Brand: ${disc.manufacturer}`);
  if (disc.mold)         lines.push(`Mold: ${disc.mold}`);
  if (disc.type)         lines.push(`Type: ${disc.type}`);
  if (disc.plastic)      lines.push(`Plastic: ${disc.plastic}`);
  if (disc.run)          lines.push(`Run/Edition: ${disc.run}`);
  if (disc.weight)       lines.push(`Weight: ${disc.weight}g`);
  if (disc.notes)        lines.push(`\nNotes: ${disc.notes}`);
```

Replace with:

```js
  if (disc.manufacturer) lines.push(`Brand: ${disc.manufacturer}`);
  if (disc.mold)         lines.push(`Mold: ${disc.mold}`);
  if (disc.type)         lines.push(`Type: ${disc.type}`);
  if (disc.plastic)      lines.push(`Plastic: ${disc.plastic}`);
  if (disc.run)          lines.push(`Run/Edition: ${disc.run}`);
  if (disc.weight)       lines.push(`Weight: ${disc.weight}g`);
  if (disc.stability)    lines.push(`Stability: ${disc.stability}`);
  if (disc.speed || disc.glide || disc.turn || disc.fade) {
    const parts = [];
    if (disc.speed) parts.push(`Speed - ${disc.speed}`);
    if (disc.glide) parts.push(`Glide - ${disc.glide}`);
    if (disc.turn)  parts.push(`Turn - ${disc.turn}`);
    if (disc.fade)  parts.push(`Fade - ${disc.fade}`);
    lines.push(`Flight Numbers: ${parts.join(' | ')}`);
  }
  if (disc.notes)        lines.push(`\nNotes: ${disc.notes}`);
```

- [ ] **Step 2: Add flight aspects to the bulk-list aspects block (~line 189)**

Find:

```js
      aspects: {
        Type:                                        ['Disc Golf Disc'],
        ...(disc.manufacturer && { Brand:            [normalizeManufacturer(disc.manufacturer)] }),
        ...(disc.mold         && { Model:            [disc.mold] }),
        ...(disc.type         && { 'Disc Type':      [normalizeDiscType(disc.type)] }),
        ...(disc.plastic      && { 'Disc Plastic Type': [disc.plastic] }),
        ...(disc.weight       && { 'Disc Weight':    [`${disc.weight} grams`] }),
      },
```

Replace with:

```js
      aspects: {
        Type:                                        ['Disc Golf Disc'],
        ...(disc.manufacturer && { Brand:            [normalizeManufacturer(disc.manufacturer)] }),
        ...(disc.mold         && { Model:            [disc.mold] }),
        ...(disc.type         && { 'Disc Type':      [normalizeDiscType(disc.type)] }),
        ...(disc.plastic      && { 'Disc Plastic Type': [disc.plastic] }),
        ...(disc.weight       && { 'Disc Weight':    [`${disc.weight} grams`] }),
        ...(disc.speed        && { 'Speed Rating':        [String(disc.speed)] }),
        ...(disc.glide        && { 'Glide Rating':        [String(disc.glide)] }),
        ...(disc.turn         && { 'Turn (Right) Rating': [String(disc.turn)] }),
        ...(disc.fade         && { 'Fade (Left) Rating':  [String(disc.fade)] }),
      },
```

- [ ] **Step 3: Add flight aspects to the bulk-update aspects block (~line 435)**

Find:

```js
        aspects: {
          Type:                                        ['Disc Golf Disc'],
          ...(disc.manufacturer && { Brand:            [normalizeManufacturer(disc.manufacturer)] }),
          ...(disc.mold         && { Model:            [disc.mold] }),
          ...(disc.type         && { 'Disc Type':      [normalizeDiscType(disc.type)] }),
          ...(disc.plastic      && { 'Disc Plastic Type': [disc.plastic] }),
          ...(disc.weight       && { 'Disc Weight':    [`${disc.weight} grams`] }),
          ...(disc.color && VALID_COLORS.has(disc.color) && { Color: [disc.color] }),
        },
```

Replace with:

```js
        aspects: {
          Type:                                        ['Disc Golf Disc'],
          ...(disc.manufacturer && { Brand:            [normalizeManufacturer(disc.manufacturer)] }),
          ...(disc.mold         && { Model:            [disc.mold] }),
          ...(disc.type         && { 'Disc Type':      [normalizeDiscType(disc.type)] }),
          ...(disc.plastic      && { 'Disc Plastic Type': [disc.plastic] }),
          ...(disc.weight       && { 'Disc Weight':    [`${disc.weight} grams`] }),
          ...(disc.color && VALID_COLORS.has(disc.color) && { Color: [disc.color] }),
          ...(disc.speed        && { 'Speed Rating':        [String(disc.speed)] }),
          ...(disc.glide        && { 'Glide Rating':        [String(disc.glide)] }),
          ...(disc.turn         && { 'Turn (Right) Rating': [String(disc.turn)] }),
          ...(disc.fade         && { 'Fade (Left) Rating':  [String(disc.fade)] }),
        },
```

- [ ] **Step 4: Commit**

```bash
git add server/ebay-listings.js
git commit -m "feat: add Speed/Glide/Turn/Fade/Stability to eBay description and aspects ref #108"
git push
```
