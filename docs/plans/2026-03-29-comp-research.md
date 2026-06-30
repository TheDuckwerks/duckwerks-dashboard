# Comp Research Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Comps view to the dashboard that accepts a list of items, searches eBay sold listings, and runs results through Claude API to produce pricing analysis + CSV output.

**Architecture:** Two server endpoints (`/api/comps/search` for eBay Browse API, `/api/comps/analyze` for Claude API) keep concerns separate and enable per-step loading states in the UI. Alpine `compsView` manages input, runs both calls sequentially per item, and renders per-item cards with analysis text and a copyable CSV block.

**Tech Stack:** Node/Express, eBay Browse API (app token — already wired), Anthropic SDK (`@anthropic-ai/sdk`), Alpine.js, Space Mono dark theme.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/comps.js` | Create | `/api/comps/search` + `/api/comps/analyze` |
| `server.js` | Modify line ~30 | Mount `/api/comps` router |
| `public/v2/js/views/comps.js` | Create | Alpine `compsView` — input, run, results |
| `public/v2/index.html` | Modify | Nav pill + view container + script tag |
| `package.json` | Modify | Add `@anthropic-ai/sdk` dependency |

---

## Task 1: Install Anthropic SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

```bash
cd /Users/geoff/projects/duckwerks-dashboard
npm install @anthropic-ai/sdk
```

Expected output: `added N packages` with no errors.

- [ ] **Step 2: Verify install**

```bash
node -e "const Anthropic = require('@anthropic-ai/sdk'); console.log('ok', typeof Anthropic)"
```

Expected: `ok function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "ref #75: install @anthropic-ai/sdk for comp research"
```

---

## Task 2: eBay sold listings search endpoint

This is the highest-risk task — verify the eBay filter works before building anything on top of it.

**Files:**
- Create: `server/comps.js`
- Modify: `server.js`

- [ ] **Step 1: Create `server/comps.js` with the search endpoint**

```js
const express  = require('express');
const router   = express.Router();
const { getAppToken } = require('./ebay-auth');

const EBAY_API = 'https://api.ebay.com';

// POST /api/comps/search
// Body: { items: [{ name, minPrice, notes, alternates }] }
// Returns: { results: [{ name, hints, listings: [...] }] }
router.post('/search', async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }

  try {
    const token   = await getAppToken();
    const results = await Promise.all(items.map(item => searchItem(token, item)));
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: 'eBay search failed', detail: e.message });
  }
});

async function searchItem(token, item) {
  const { name, minPrice, alternates } = item;

  // Search the primary item name first, then any alternates
  const queries = [name, ...(alternates || [])];
  const allListings = [];

  for (const q of queries) {
    const params = new URLSearchParams({
      q,
      limit: '30',
      sort: '-itemEndDate',
      fieldgroups: 'EXTENDED',
    });

    // soldItems:{true} filters to sold/completed listings only
    let filter = 'itemLocationCountry:US,soldItems:{true}';
    if (minPrice) filter += `,price:[${minPrice}..],priceCurrency:USD`;
    params.set('filter', filter);

    const url      = `${EBAY_API}/buy/browse/v1/item_summary/search?${params}`;
    const response = await fetch(url, {
      headers: {
        'Authorization':           `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`eBay Browse API error for "${q}": ${response.status} — ${text}`);
    }

    const data  = await response.json();
    const items = data.itemSummaries || [];

    for (const i of items) {
      const salePrice = parseFloat(i.price?.value || 0);
      const shipping  = parseFloat(i.shippingOptions?.[0]?.shippingCost?.value || 0);
      allListings.push({
        query:          q,
        title:          i.title,
        condition:      i.condition || '',
        sold_price:     salePrice,
        shipping,
        total_landed:   +(salePrice + shipping).toFixed(2),
        sale_type:      normalizeBuyingOption(i.buyingOptions),
        end_date:       i.itemEndDate || i.soldDate || '',
        item_id:        i.legacyItemId || i.itemId,
      });
    }
  }

  return { name: item.name, hints: item, listings: allListings };
}

function normalizeBuyingOption(opts) {
  if (!opts) return 'BIN';
  const s = opts.join(',').toLowerCase();
  if (s.includes('best_offer')) return 'OBO';
  if (s.includes('auction'))    return 'Auction';
  return 'BIN';
}

module.exports = { router };
```

- [ ] **Step 2: Mount in `server.js`**

In `server.js`, after the `app.use('/api/ebay', ...)` line, add:

```js
app.use('/api/comps',     require('./server/comps').router);
```

- [ ] **Step 3: Restart server and test the endpoint manually**

```bash
curl -s -X POST http://localhost:3000/api/comps/search \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"Nikon EN-EL15b battery"}]}' | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
if(j.error) { console.error('ERROR:', j.error, j.detail); process.exit(1); }
const r=j.results[0];
console.log('item:', r.name);
console.log('listings count:', r.listings.length);
if(r.listings[0]) console.log('first:', JSON.stringify(r.listings[0], null, 2));
"
```

Expected: JSON with at least a few listings (5+) with price and title.

**If `soldItems:{true}` filter returns 0 results or an error:** The filter may not be available with our app token scope. Fallback: remove `soldItems:{true}` from the filter string — this returns active listings instead. Not ideal for comps but still useful. Note the difference in Claude's system prompt (`listing_status: active` vs `sold`).

**If the entire request errors 403/401:** `getAppToken()` may need a scope update. Check `server/ebay-auth.js` for the app token scope string and ensure `https://api.ebay.com/oauth/api_scope/buy.item.summary` is included.

- [ ] **Step 4: Commit**

```bash
git add server/comps.js server.js
git commit -m "ref #75: add /api/comps/search — eBay Browse API sold listings"
```

---

## Task 3: Claude analysis endpoint

**Files:**
- Modify: `server/comps.js`

- [ ] **Step 1: Read `docs/gear-comp-research.md` to build the system prompt**

The system prompt should instruct Claude to:
1. Analyze the provided eBay listings JSON
2. Return a brief analysis paragraph (price range, outliers, recommended list price)
3. Return a CSV block in the format from the comp workflow doc

Add this to `server/comps.js` (after the existing require statements):

```js
const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');

const COMP_WORKFLOW = fs.readFileSync(
  path.join(__dirname, '../docs/gear-comp-research.md'), 'utf8'
);

const SYSTEM_PROMPT = `You are a reseller pricing assistant. Your job is to analyze eBay sold listing data and produce structured comp analysis.

Here is the comp research workflow and CSV format you must follow:

${COMP_WORKFLOW}

When given raw eBay listing data for an item, you will:
1. Write a brief analysis paragraph (2-4 sentences): price range, notable outliers or patterns, recommended list price and floor price. Be specific with dollar amounts.
2. Output a CSV block in the exact format from the workflow doc above.

For the CSV:
- source is always "eBay"
- date_pulled is today's date
- Use the listing data as-is for title, condition, sold_price, shipping, total_landed, sale_type
- listing_status: use "sold" if end_date is populated, otherwise "active"
- notes: flag outliers (parts-only, lot, Japanese import, no PSU, etc.) as described in the workflow

Format your response EXACTLY as:
ANALYSIS:
<analysis paragraph>

CSV:
\`\`\`
item,source,date_pulled,title,condition,sold_price,shipping,total_landed,sale_type,listing_status,notes
<rows>
\`\`\`

Do not include any other text outside this format.`;
```

- [ ] **Step 2: Add the analyze endpoint to `server/comps.js`**

Append after the `module.exports` line (replace it with the full module):

```js
// POST /api/comps/analyze
// Body: { item: { name, hints, listings: [...] } }
// Returns: { name, analysis, csv }
router.post('/analyze', async (req, res) => {
  const { item } = req.body;
  if (!item || !item.listings) {
    return res.status(400).json({ error: 'item with listings required' });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const today    = new Date().toISOString().split('T')[0];
  const userMsg  = `Item: ${item.name}
Date today: ${today}
Hints: ${JSON.stringify(item.hints)}

eBay listings (${item.listings.length} results):
${JSON.stringify(item.listings, null, 2)}`;

  try {
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMsg }],
    });

    const text     = message.content[0]?.text || '';
    const analysis = extractSection(text, 'ANALYSIS:', 'CSV:');
    const csv      = extractCsvBlock(text);

    res.json({ name: item.name, analysis, csv });
  } catch (e) {
    res.status(502).json({ error: 'Claude API error', detail: e.message });
  }
});

function extractSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end   = endMarker ? text.indexOf(endMarker) : text.length;
  if (start === -1) return text.trim();
  return text.slice(start + startMarker.length, end > start ? end : text.length).trim();
}

function extractCsvBlock(text) {
  const match = text.match(/```[\s\S]*?\n([\s\S]*?)```/);
  return match ? match[1].trim() : '';
}

module.exports = { router };
```

- [ ] **Step 3: Test the analyze endpoint manually**

First run the search to get listings, then pipe to analyze:

```bash
curl -s -X POST http://localhost:3000/api/comps/search \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"Nikon EN-EL15b battery"}]}' > /tmp/search_result.json

node -e "
const d=require('fs').readFileSync('/tmp/search_result.json','utf8');
const item=JSON.parse(d).results[0];
require('child_process').exec(
  'curl -s -X POST http://localhost:3000/api/comps/analyze -H \"Content-Type: application/json\" -d \'' + JSON.stringify({item}).replace(/'/g,'\\''') + '\'',
  (err, stdout) => {
    const r=JSON.parse(stdout);
    console.log('=== ANALYSIS ===');
    console.log(r.analysis);
    console.log('=== CSV (first 3 lines) ===');
    console.log(r.csv.split('\n').slice(0,3).join('\n'));
  }
);
"
```

Expected: analysis paragraph with dollar figures, CSV with correct columns.

- [ ] **Step 4: Commit**

```bash
git add server/comps.js
git commit -m "ref #75: add /api/comps/analyze — Claude API comp analysis"
```

---

## Task 4: Comp Research Alpine view

**Files:**
- Create: `public/v2/js/views/comps.js`

- [ ] **Step 1: Create the view file**

```js
// ── Comp Research View ─────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('compsView', () => ({

    inputText:   '',
    results:     [],   // [{ name, status, analysis, csv, error }]
    running:     false,

    parseItems(raw) {
      return raw.split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const [namePart, ...hintParts] = line.split('|').map(s => s.trim());
          const hints = {};
          hintParts.forEach(h => {
            const eq = h.indexOf('=');
            if (eq === -1) return;
            const key = h.slice(0, eq).trim();
            const val = h.slice(eq + 1).trim();
            if (key === 'min_price')  hints.minPrice   = parseFloat(val) || undefined;
            if (key === 'alternates') hints.alternates = val.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
            if (key === 'notes')      hints.notes      = val;
          });
          return { name: namePart, ...hints };
        });
    },

    async run() {
      const items = this.parseItems(this.inputText);
      if (!items.length) return;

      this.running = true;
      this.results = items.map(i => ({ name: i.name, status: 'searching', analysis: '', csv: '', error: '' }));

      // Fan out: search all items in parallel, then analyze sequentially to avoid rate limits
      let searchResults;
      try {
        const response = await fetch('/api/comps/search', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ items }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Search failed');
        searchResults = data.results;
      } catch (e) {
        this.results.forEach(r => { r.status = 'error'; r.error = e.message; });
        this.running = false;
        return;
      }

      // Update status to 'analyzing' for all
      this.results.forEach(r => { r.status = 'analyzing'; });

      // Analyze each item sequentially
      for (let i = 0; i < searchResults.length; i++) {
        const item   = searchResults[i];
        const result = this.results[i];
        try {
          const response = await fetch('/api/comps/analyze', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ item }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Analysis failed');
          result.analysis = data.analysis;
          result.csv      = data.csv;
          result.status   = 'done';
        } catch (e) {
          result.status = 'error';
          result.error  = e.message;
        }
      }

      this.running = false;
    },

    csvRows(csv) {
      if (!csv) return [];
      const lines = csv.split('\n').filter(Boolean);
      if (lines.length < 2) return [];
      const headers = lines[0].split(',');
      return lines.slice(1).map(line => {
        // naive CSV parse — handles quoted fields
        const cols = [];
        let cur = '', inQ = false;
        for (const ch of line + ',') {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
          else cur += ch;
        }
        return headers.reduce((obj, h, i) => { obj[h] = cols[i] || ''; return obj; }, {});
      });
    },

    copyCSV(csv) {
      navigator.clipboard.writeText(csv);
    },

    copyAll() {
      const all = this.results
        .filter(r => r.csv)
        .map(r => r.csv)
        .join('\n');
      navigator.clipboard.writeText(all);
    },

  }));
});
```

No verification step here — it gets tested end-to-end in Task 5 after wiring into the HTML.

---

## Task 5: Wire into index.html

**Files:**
- Modify: `public/v2/index.html`

Four surgical edits — do them in order.

- [ ] **Step 1: Add nav pill (after Analytics pill, line ~61)**

Find the line:
```html
      <button class="nav-pill" :class="{ active: $store.dw.activeView === 'analytics' }" @click="$store.dw.activeView = 'analytics'; $store.dw.categoryFilter = null"><span x-text="$store.dw.activeView === 'analytics' ? '◉' : '○'"></span> Analytics</button>
```

Add immediately after it:
```html
      <button class="nav-pill" :class="{ active: $store.dw.activeView === 'comps' }"     @click="$store.dw.activeView = 'comps'; $store.dw.categoryFilter = null"><span x-text="$store.dw.activeView === 'comps' ? '◉' : '○'"></span> Comps</button>
```

- [ ] **Step 2: Add view container (after the Analytics view div, around line ~407)**

Find:
```html
      <!-- Analytics -->
      <div x-show="$store.dw.activeView === 'analytics'" x-data="analyticsView">
```

Add a new view container AFTER the closing `</div>` of the analytics view. First, grep for the closing analytics div to find the exact line number:
```bash
grep -n "analyticsView\|<!-- Comps" public/v2/index.html
```

Then add after the analytics view's closing `</div>`:
```html

      <!-- Comps -->
      <div x-show="$store.dw.activeView === 'comps'" x-data="compsView">
        <div class="view-header">
          <div class="view-title">Comp Research</div>
        </div>

        <!-- Input panel -->
        <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px">
          <textarea
            x-model="inputText"
            placeholder="One item per line. Optional hints: item name | min_price=50 | alternates=[Model A, Model B] | notes=no charger"
            style="width:100%; height:120px; background:var(--surface); border:1px solid var(--border); color:var(--white); font-family:'Space Mono',monospace; font-size:12px; padding:10px; resize:vertical; border-radius:4px; box-sizing:border-box"
            :disabled="running"
          ></textarea>
          <div style="display:flex; gap:8px; align-items:center">
            <button class="btn btn-active" @click="run()" :disabled="running || !inputText.trim()">
              <span x-show="!running">Run Comps</span>
              <span x-show="running">Running…</span>
            </button>
            <button class="btn btn-muted" x-show="results.some(r => r.csv)" @click="copyAll()">Copy All CSV</button>
          </div>
        </div>

        <!-- Results -->
        <template x-for="(result, idx) in results" :key="idx">
          <div style="margin-bottom:32px; border:1px solid var(--border); border-radius:6px; padding:16px">

            <!-- Card header -->
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px">
              <div style="font-size:14px; font-weight:bold; color:var(--white)" x-text="result.name"></div>
              <div style="font-size:11px; color:var(--muted)"
                   :style="result.status === 'done' ? 'color:var(--green)' : result.status === 'error' ? 'color:var(--red)' : 'color:var(--yellow)'"
                   x-text="result.status === 'searching' ? 'Searching eBay…' : result.status === 'analyzing' ? 'Analyzing…' : result.status === 'done' ? 'Done' : 'Error'">
              </div>
            </div>

            <!-- Error -->
            <div x-show="result.status === 'error'" x-text="result.error" style="color:var(--red); font-size:12px; margin-bottom:8px"></div>

            <!-- Analysis paragraph -->
            <div x-show="result.analysis" x-text="result.analysis"
                 style="font-size:12px; color:var(--white); line-height:1.6; margin-bottom:16px; padding:10px; background:rgba(255,255,255,0.04); border-radius:4px">
            </div>

            <!-- CSV table -->
            <div x-show="result.csv">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
                <div style="font-size:11px; color:var(--muted)">Comp table</div>
                <button class="btn btn-muted" style="font-size:11px; padding:3px 8px" @click="copyCSV(result.csv)">Copy CSV</button>
              </div>
              <div style="overflow-x:auto">
                <table class="data-table" style="font-size:11px">
                  <thead>
                    <tr>
                      <th style="text-align:left">Title</th>
                      <th>Cond</th>
                      <th class="num-col">Sold</th>
                      <th class="num-col">Ship</th>
                      <th class="num-col">Landed</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th style="text-align:left">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template x-for="(row, ri) in csvRows(result.csv)" :key="ri">
                      <tr>
                        <td x-text="row.title" style="max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis"></td>
                        <td x-text="row.condition" style="color:var(--muted)"></td>
                        <td class="num-col" x-text="row.sold_price ? '$' + parseFloat(row.sold_price).toFixed(2) : '—'" style="color:var(--green)"></td>
                        <td class="num-col" x-text="parseFloat(row.shipping) > 0 ? '$' + parseFloat(row.shipping).toFixed(2) : 'Free'" style="color:var(--muted)"></td>
                        <td class="num-col" x-text="row.total_landed ? '$' + parseFloat(row.total_landed).toFixed(2) : '—'" style="color:var(--white); font-weight:bold"></td>
                        <td x-text="row.sale_type" style="color:var(--muted)"></td>
                        <td x-text="row.listing_status" :style="row.listing_status === 'sold' ? 'color:var(--green)' : 'color:var(--yellow)'"></td>
                        <td x-text="row.notes" style="color:var(--muted); max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis"></td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </template>

      </div>
```

- [ ] **Step 3: Add script tag (after analytics.js, around line ~1643)**

Find:
```html
<script src="js/views/analytics.js"></script>
```

Add after it:
```html
<script src="js/views/comps.js"></script>
```

- [ ] **Step 4: Restart server, open browser, test end-to-end**

1. Navigate to http://localhost:3000
2. Click **Comps** in the sidebar nav
3. Paste one item: `Nikon EN-EL15b battery | min_price=15`
4. Click **Run Comps**
5. Verify: status shows "Searching eBay…" → "Analyzing…" → "Done"
6. Verify: analysis paragraph appears with dollar figures
7. Verify: comp table renders with rows and correct columns
8. Click **Copy CSV** — paste into a text editor and verify the CSV format matches the workflow doc

- [ ] **Step 5: Test multi-item input**

Paste two items:
```
Nikon EN-EL15b battery | min_price=15
Roland TR-8S
```

Verify both cards render, Copy All CSV includes both item blocks.

- [ ] **Step 6: Commit**

```bash
git add public/v2/js/views/comps.js public/v2/index.html
git commit -m "ref #75: add Comps view — Alpine UI, nav pill, view container"
```

---

## Task 6: Version bump + session wrap

**Files:**
- Modify: `public/v2/js/config.js`
- Modify: `package.json`
- Modify: `docs/session-log.md`

- [ ] **Step 1: Bump version**

In `public/v2/js/config.js`, update `APP_VERSION` to the next patch (e.g. `'1.0.4'`).
In `package.json`, update `"version"` to match.

- [ ] **Step 2: Update session log**

Add an entry to `docs/session-log.md` noting:
- Added Comps view (issue #75)
- eBay Browse API sold listings search
- Claude API (`claude-sonnet-4-6`) for comp analysis + CSV generation
- Input format: `item name | min_price=X | alternates=[A, B] | notes=...`

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/config.js package.json docs/session-log.md
git commit -m "ref #75: v1.0.4 — comp research view"
```

---

## Notes for the Implementer

**If eBay `soldItems:{true}` filter doesn't work:**
The Browse API app token may not have the `buy.marketplace.insights` scope needed for sold item data. If you get 0 results or a 403, remove `soldItems:{true}` from the filter. This returns active listings — still useful as price signals but less reliable than sold comps. Update the `listing_status` mapping to `'active'` accordingly and note in the analysis system prompt.

**eBay app token scope:**
If `getAppToken()` fails with a scope error, open `server/ebay-auth.js` and check the `APP_TOKEN_SCOPE` or `CLIENT_CREDENTIALS_SCOPE` constant. Ensure `https://api.ebay.com/oauth/api_scope/buy.item.summary` is present.

**Claude model:**
Plan uses `claude-sonnet-4-6`. If that model ID returns a 404, try `claude-sonnet-4-5-20251001` as fallback.

**CSV parsing in the UI:**
The `csvRows()` helper handles basic quoted fields. If Claude returns CSV with complex quoting (e.g. commas in titles), the naive parser may misalign columns. A quick fix: truncate long titles server-side before passing to Claude, or add `fieldgroups=EXTENDED` to the eBay query to get cleaner title strings.
