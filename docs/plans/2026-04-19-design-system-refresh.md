    # Design System Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Space Mono / Bebas Neue dark theme with the "B" trading-terminal design language from the Claude Design export, updating the dashboard data layer to power the new income waterfall and tape stats.

**Architecture:** Three-phase approach — (1) CSS tokens and fonts drop-in, (2) app shell restructure (tape strip + 64px rail nav replacing 220px sidebar), (3) dashboard data + HTML rewrite, then a light reskin pass over remaining views. No new routes or API endpoints needed; all data is already in the Alpine store.

**Tech Stack:** Alpine.js, vanilla CSS (no build step), Express/SQLite backend (read-only for this plan), IBM Plex Mono + Space Grotesk + Azeret Mono fonts via Google Fonts.

**Design source:** `/tmp/duckwerks-design/update-duckwerks-fash/project/b_dashboard.html` + `_shared.css`

**Scope boundary:** This plan reskins existing views. Inventory IA, lot modal, and sync flow are rev-2. Modals keep their current markup; only token-driven styles change.

---

## File Map

| File | What changes |
|---|---|
| `public/v2/css/main.css` | Replace token system + fonts, update layout shell |
| `public/v2/css/components.css` | New component classes: tape, rail, cell-head, kpi, inc waterfall, tb table, ctag/pmark/smark, lot-mini, ship panel |
| `public/v2/index.html` | Tape strip + rail nav (replaces sidebar), hero-band per view, dashboard section rewrite |
| `public/v2/js/views/dashboard.js` | Add `incomeWindows`, `tape24h`, improve `tapeStats` |
| `public/v2/js/sidebar.js` | Adapt search to new rail (search opens from hero-band button) |
| `public/v2/js/config.js` | Update `APP_VERSION` patch bump at end |

---

## Task 1: Design tokens + fonts

**Files:**
- Modify: `public/v2/css/main.css`

Replace the entire `:root` block and font import with the new design system. Map old variable names to new so nothing breaks before the HTML is updated.

- [ ] **Step 1: Update font import and `:root` tokens**

Replace the existing `@import` line and `:root` block in `main.css` with:

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Azeret+Mono:wght@400;500;700;800;900&display=swap');

:root {
  /* Surfaces */
  --bg:      #070707;
  --panel:   #0d0d0d;
  --panel-2: #121212;
  --line:    #1b1b1b;
  --line-2:  #262626;

  /* Text tiers */
  --ink:   #f2f2f2;
  --ink-2: #d4d4d4;
  --ink-3: #a0a0a0;
  --ink-4: #6a6a6a;

  /* Semantic */
  --pos:        #5ed39a;
  --neg:        #ff6b6b;
  --warn:       #ffcf5c;
  --accent:     #ffcf5c;
  --accent-ink: #0a0a0a;

  /* Platform */
  --ebay:   #e53238;
  --reverb: #f57a32;

  /* Typography */
  --mono:    'IBM Plex Mono', ui-monospace, monospace;
  --sans:    'Space Grotesk', system-ui, sans-serif;
  --display: 'Azeret Mono', ui-monospace, monospace;

  /* Legacy aliases — keep while HTML still uses old names */
  --surface:  var(--panel);
  --surface2: var(--panel-2);
  --border:   var(--line);
  --border2:  var(--line-2);
  --green:    var(--pos);
  --red:      var(--neg);
  --yellow:   var(--warn);
  --muted:    var(--ink-3);
  --white:    var(--ink);
  --font-body: var(--mono);
  --font-big:  var(--display);
}
```

- [ ] **Step 2: Update body base styles**

Replace the `body` rule to use new vars and bump base font to 14px (Space Grotesk reads larger than Space Mono at 15px):

```css
body {
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 3: Verify app still loads**

```bash
npm start
```
Open http://localhost:3000 — app should render with noticeably different font (Space Grotesk instead of Space Mono) and slightly darker backgrounds. No layout breakage expected.

- [ ] **Step 4: Commit**

```bash
git add public/v2/css/main.css
git commit -m "style: replace design tokens with B trading-terminal system ref #N"
```

---

## Task 2: App shell — tape strip + rail nav

**Files:**
- Modify: `public/v2/css/main.css` (shell layout rules)
- Modify: `public/v2/css/components.css` (tape + rail component styles)
- Modify: `public/v2/index.html` (replace `#sidebar` and `#app` structure)
- Modify: `public/v2/js/sidebar.js` (adapt search trigger)

The current layout is `flex` with a 220px `#sidebar`. New layout is:

```
┌─────────────────────────────────────────────┐
│  .tape  (full width, 45px, position:sticky) │
├──────┬──────────────────────────────────────┤
│ .rail│  .main                               │
│ 64px │  (hero-band + view content)          │
└──────┴──────────────────────────────────────┘
```

The sidebar search moves to a `⌕ Search` button in each view's hero-band header. Clicking it focuses the existing inline search input (which becomes a narrow bar under the hero-band, hidden by default).

- [ ] **Step 1: Add tape + rail + hero-band CSS to `components.css`**

Append to the end of `public/v2/css/components.css`:

```css
/* ── Tape ─────────────────────────────────────────────────────────────── */

.tape {
  background: #0b0b0b;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: stretch;
  font: 500 11px/1 var(--mono);
  letter-spacing: .12em;
  text-transform: uppercase;
  position: sticky;
  top: 0;
  z-index: 100;
}
.tape-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-right: 1px solid var(--line);
  min-width: 64px;
  width: 64px;
  height: 44px;
  flex-shrink: 0;
}
.tape-brand .mark {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  font: 800 11px/1 var(--mono);
  letter-spacing: 0;
  flex-shrink: 0;
}
.tape-live {
  display: flex;
  align-items: center;
  flex: 1;
  overflow: hidden;
}
.tape-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-right: 1px solid var(--line);
  color: var(--ink-4);
  white-space: nowrap;
  flex-shrink: 0;
  font: 500 11px/1 var(--mono);
  letter-spacing: .12em;
  text-transform: uppercase;
}
.tape-item b { color: var(--ink); font-weight: 500; }
.tape-item .up { color: var(--pos); }
.tape-item .dn { color: var(--neg); }
.tape-sys {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  color: var(--ink-4);
  font: 500 11px/1 var(--mono);
  letter-spacing: .1em;
  margin-left: auto;
}
.tape-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pos);
  box-shadow: 0 0 0 3px rgba(94,211,154,.18);
  animation: tape-pulse 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes tape-pulse { 0%,100%{opacity:.7} 50%{opacity:1} }

/* ── Rail nav ─────────────────────────────────────────────────────────── */

#app {
  display: grid;
  grid-template-columns: 64px 1fr;
  min-height: calc(100vh - 44px);
}

#sidebar {
  width: 64px;
  min-width: 64px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 10px 0;
  gap: 3px;
  position: sticky;
  top: 44px;
  height: calc(100vh - 44px);
  overflow: hidden;
}
#sidebar .rail-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 12px 4px;
  color: var(--ink-4);
  text-decoration: none;
  cursor: pointer;
  font: 500 9px/1 var(--mono);
  letter-spacing: .14em;
  text-transform: uppercase;
  border-left: 2px solid transparent;
  border-right: none;
  background: none;
  border-top: none;
  border-bottom: none;
  width: 100%;
}
#sidebar .rail-link .gl {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  font-family: var(--mono);
  color: var(--ink-3);
  font-weight: 500;
  font-size: 14px;
}
#sidebar .rail-link:hover { color: var(--ink-2); }
#sidebar .rail-link:hover .gl { color: var(--ink-2); }
#sidebar .rail-link.active {
  color: var(--accent);
  border-left-color: var(--accent);
  background: rgba(255,207,92,.04);
}
#sidebar .rail-link.active .gl { color: var(--accent); }
#sidebar .rail-spacer { flex: 1; }
#sidebar .rail-env {
  text-align: center;
  padding: 8px 4px;
  font: 500 9px/1.4 var(--mono);
  letter-spacing: .12em;
  color: var(--pos);
  text-transform: uppercase;
  border-top: 1px solid var(--line);
}

/* ── Hero band ────────────────────────────────────────────────────────── */

.hero-band {
  display: grid;
  grid-template-columns: 200px 1fr;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.hero-photo {
  height: 100px;
  background: #000 center/140% no-repeat url('../duckwerksheader.jpeg');
  border-right: 1px solid var(--line);
}
.hero-head {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 14px 20px;
}
.hero-crumbs {
  font: 500 10px/1 var(--mono);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.hero-crumbs b { color: var(--ink); }
.hero-crumbs .sep { color: var(--ink-4); margin: 0 6px; }
.hero-title {
  font-family: var(--display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1;
  color: var(--ink);
  letter-spacing: -0.02em;
}
.hero-tools { display: flex; gap: 6px; align-items: center; }

/* ── Tool buttons ─────────────────────────────────────────────────────── */

.tool-btn {
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  color: var(--ink-2);
  padding: 6px 10px;
  font: 500 11px/1 var(--mono);
  letter-spacing: .1em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 3px;
}
.tool-btn:hover { background: #1a1a1a; color: var(--ink); }
.tool-btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }

/* ── Search bar (under hero-band, shown on demand) ────────────────────── */

.hero-search {
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.hero-search input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--ink);
  font: 500 13px/1 var(--mono);
  flex: 1;
  letter-spacing: .04em;
}
.hero-search input::placeholder { color: var(--ink-4); }
```

- [ ] **Step 2: Replace sidebar HTML in `index.html`**

Find the `<aside id="sidebar" x-data="sidebar">` block and replace its entire contents with the rail nav. The sidebar Alpine component (`x-data="sidebar"`) stays — we're only changing the markup inside it. The search bar moves to a separate `<div class="hero-search">` that appears in each view's header.

Replace everything inside `<aside id="sidebar" x-data="sidebar">...</aside>` with:

```html
<aside id="sidebar" x-data="sidebar">
  <button class="rail-link" :class="{ active: $store.dw.activeView === 'dashboard' }"
    @click="$store.dw.activeView = 'dashboard'; $store.dw.categoryFilter = null">
    <span class="gl">◉</span>Home
  </button>
  <button class="rail-link" :class="{ active: $store.dw.activeView === 'items' }"
    @click="$store.dw.activeView = 'items'; $store.dw.categoryFilter = null">
    <span class="gl">▤</span>Inv
  </button>
  <button class="rail-link" :class="{ active: $store.dw.activeView === 'lots' }"
    @click="$store.dw.activeView = 'lots'; $store.dw.categoryFilter = null">
    <span class="gl">▦</span>Lots
  </button>
  <button class="rail-link" :class="{ active: $store.dw.activeView === 'analytics' }"
    @click="$store.dw.activeView = 'analytics'; $store.dw.categoryFilter = null">
    <span class="gl">⎐</span>Anlx
  </button>
  <button class="rail-link" :class="{ active: $store.dw.activeView === 'comps' }"
    @click="$store.dw.activeView = 'comps'; $store.dw.categoryFilter = null">
    <span class="gl">⌕</span>Comp
  </button>
  <button class="rail-link" :class="{ active: $store.dw.activeView === 'catalog' }"
    @click="$store.dw.activeView = 'catalog'; $store.dw.categoryFilter = null">
    <span class="gl">⚌</span>Cat
  </button>
  <div class="rail-spacer"></div>
  <div class="rail-env" x-data x-text="$store.dw.hostname && $store.dw.hostname.includes('prod') ? '● PROD' : '● DEV'"></div>
</aside>
```

- [ ] **Step 3: Add tape strip above `#app` in `index.html`**

Find the line `<div id="app" x-data>` and insert the tape strip immediately before it:

```html
<div class="tape" x-data>
  <div class="tape-brand"><div class="mark">DW</div></div>
  <div class="tape-live">
    <div class="tape-item">cost
      <b class="dn" x-text="'$' + Alpine.store('dw').records.reduce((s,r)=>s+(r.cost||0),0).toLocaleString('en-US',{maximumFractionDigits:0})"></b>
    </div>
    <div class="tape-item">recov
      <b class="up" x-text="'$' + Alpine.store('dw').soldRecords.reduce((s,r)=>s+(r.order?.sale_price||0),0).toLocaleString('en-US',{maximumFractionDigits:0})"></b>
    </div>
    <div class="tape-item">profit
      <b class="up" x-text="(()=>{const p=Alpine.store('dw').soldRecords.reduce((s,r)=>s+(r.order?.profit||0),0);return (p>=0?'+':'-')+'$'+Math.abs(p).toLocaleString('en-US',{maximumFractionDigits:0})})()"></b>
    </div>
    <div class="tape-item">inv
      <b x-text="Alpine.store('dw').records.length"></b>
    </div>
    <div class="tape-item">listed
      <b x-text="Alpine.store('dw').listedRecords.length"></b>
    </div>
  </div>
  <div class="tape-sys">
    <span class="tape-pulse"></span>
    <span x-text="new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})"></span>
  </div>
</div>

<div id="app" x-data>
```

Note: the tape expressions are intentionally inline so the tape is self-contained with no extra Alpine component needed.

- [ ] **Step 4: Remove old `#sidebar` CSS from `main.css`**

Delete the `#sidebar`, `.sidebar-logo`, `.sidebar-logo-img`, `.sidebar-logo-name`, `.sidebar-section`, `.sidebar-section-label`, `.sidebar-search`, `.sidebar-action`, `.sidebar-spacer`, `.sidebar-version`, `.nav-pill` rules from `main.css`. The rail styles in `components.css` replace them.

Also update `#app` in `main.css` — remove `display:flex` (it's now `display:grid` in components.css):

```css
/* Remove or comment out: */
/* #app { display: flex; min-height: 100vh; } */
```

- [ ] **Step 5: Verify layout**

```bash
npm start
```
Open http://localhost:3000. Should see: amber DW mark in top-left, tape stats bar, 64px icon rail on left, main content area. No sidebar content should be visible.

- [ ] **Step 6: Commit**

```bash
git add public/v2/css/main.css public/v2/css/components.css public/v2/index.html
git commit -m "style: replace 220px sidebar with tape strip + 64px rail nav ref #N"
```

---

## Task 3: Dashboard data layer — income windows + tape stats

**Files:**
- Modify: `public/v2/js/views/dashboard.js`

The income waterfall needs rolling-window aggregates: for each of 7d, 30d, 90d, and YTD, compute gross revenue, cost basis of items sold, shipping cost, and net profit. All data is in `Alpine.store('dw').soldRecords` — each record has `r.order.date_sold`, `r.cost`, `r.shipment?.shipping_cost`, and `r.order.profit`.

Net = gross − cost − shipping − fees. Since `r.order.profit` is already `sale_price - cost - shipping - fees` (confirmed from `server/items.js` profit calculation), `windowNet = sum(r.order.profit)` for records in window.

- [ ] **Step 1: Add `soldInWindow` helper and `incomeWindows` computed**

Add after the `recentlyListed` getter in `dashboard.js`:

```js
soldInWindow(days) {
  const dw    = Alpine.store('dw');
  const cutoff = days === 'ytd'
    ? new Date(new Date().getFullYear(), 0, 1)   // Jan 1 this year
    : new Date(Date.now() - days * 86400000);
  return dw.soldRecords.filter(r => {
    if (!r.order?.date_sold) return false;
    return new Date(r.order.date_sold) >= cutoff;
  });
},

get incomeWindows() {
  const goal30 = 3000; // monthly goal
  const windows = [
    { label: '7d',  days: 7,    goalAmt: Math.round(goal30 * 7/30) },
    { label: '30d', days: 30,   goalAmt: goal30 },
    { label: '90d', days: 90,   goalAmt: goal30 * 3 },
    { label: 'YTD', days: 'ytd', goalAmt: null },
  ];

  const rows = windows.map(w => {
    const items   = this.soldInWindow(w.days);
    const gross   = items.reduce((s,r) => s + (r.order?.sale_price  || 0), 0);
    const cost    = items.reduce((s,r) => s + (r.cost               || 0), 0);
    const ship    = items.reduce((s,r) => s + (r.shipment?.shipping_cost || 0), 0);
    const net     = items.reduce((s,r) => s + (r.order?.profit      || 0), 0);
    return { ...w, gross, cost, ship, net };
  });

  // Bar widths: proportional to gross within max gross across all windows
  const maxGross = Math.max(...rows.map(r => r.gross), 1);
  return rows.map(r => {
    const scale = r.gross / maxGross;
    return {
      ...r,
      costPct:  Math.round((r.cost  / maxGross) * 100),
      shipPct:  Math.round((r.ship  / maxGross) * 100),
      netPct:   Math.round((r.net   / maxGross) * 100),
      goalPct:  r.goalAmt ? Math.round((r.goalAmt / maxGross) * 100) : null,
      overGoal: r.goalAmt ? r.net >= r.goalAmt : null,
      deltaPct: r.goalAmt && r.goalAmt > 0 ? Math.round(((r.net - r.goalAmt) / r.goalAmt) * 100) : null,
    };
  });
},
```

- [ ] **Step 2: Add `tape24h` computed**

Add after `incomeWindows`:

```js
get tape24h() {
  const items = this.soldInWindow(1);
  return items.reduce((s,r) => s + (r.order?.profit || 0), 0);
},
```

- [ ] **Step 3: Verify no console errors**

```bash
npm start
```
Open http://localhost:3000, open browser console. No errors. You can verify with `Alpine.store('dw')` in console — wait for load, then run `document.querySelector('[x-data="dashView"]').__x.$data.incomeWindows` — should return an array of 4 objects with numeric values.

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/views/dashboard.js
git commit -m "feat: add income window aggregates + 24h delta for dashboard waterfall ref #N"
```

---

## Task 4: Dashboard HTML rewrite

**Files:**
- Modify: `public/v2/index.html` (dashboard section only)
- Modify: `public/v2/css/components.css` (dashboard panel + waterfall styles)

Replace the existing dashboard view HTML (the `<div x-show="$store.dw.activeView === 'dashboard'" x-data="dashView">` block) with the new panel grid. Keep the `x-data="dashView"` binding and the `chartsSection` sub-component if still needed, but remove the old `.view-header` and replace all panel HTML.

- [ ] **Step 1: Add dashboard panel + waterfall styles to `components.css`**

Append to `components.css`:

```css
/* ── Dashboard panel grid ─────────────────────────────────────────────── */

.dw-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 1px;
  background: var(--line);
  padding: 1px;
}
.dw-cell {
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  border-bottom: 1px solid var(--line);
  font: 500 10px/1 var(--mono);
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--ink-3);
  flex-shrink: 0;
}
.cell-head .cell-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  font-weight: 500;
}
.cell-head .cell-title::before {
  content: "";
  display: block;
  width: 3px;
  height: 10px;
  background: var(--accent);
  flex-shrink: 0;
}
.cell-head .cell-meta { color: var(--ink-4); letter-spacing: .12em; }
.cell-body { padding: 14px; flex: 1; }
.cell-body-flush { flex: 1; overflow: hidden; }

/* ── KPI cells ────────────────────────────────────────────────────────── */

.kpi-val {
  font-family: var(--display);
  font-weight: 700;
  font-size: 34px;
  line-height: 1;
  color: var(--ink);
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: baseline;
  gap: 1px;
  margin: 10px 0 8px;
}
.kpi-val .kpi-curr { color: var(--ink-4); font-weight: 500; font-size: 18px; margin-right: 2px; }
.kpi-val .kpi-cents { color: var(--ink-4); font-weight: 500; font-size: 16px; }
.kpi-val.pos { color: var(--accent); }
.kpi-val.neg { color: var(--neg); }
.kpi-val.est { color: var(--ink); position: relative; }
.kpi-val.est::after {
  content: "";
  position: absolute;
  inset: auto 0 -4px 0;
  height: 2px;
  background: repeating-linear-gradient(90deg, var(--accent) 0 4px, transparent 4px 8px);
  opacity: .5;
}
.kpi-meta {
  font: 500 10px/1.5 var(--mono);
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-3);
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.kpi-meta b { color: var(--ink-2); font-weight: 500; }
.kpi-meta .pos { color: var(--accent); }
.kpi-meta .neg { color: var(--neg); }

/* ── Income waterfall ─────────────────────────────────────────────────── */

.inc { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
.inc-row { display: grid; grid-template-columns: 54px 1fr 140px; gap: 12px; align-items: center; }
.inc-lbl {
  font: 500 10px/1 var(--mono);
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--ink-2);
}
.inc-lbl span { display: block; color: var(--ink-4); font-size: 9px; margin-top: 4px; letter-spacing: .1em; }
.inc-track {
  position: relative;
  height: 30px;
  background: #080808;
  border: 1px solid var(--line);
  display: flex;
}
.inc-seg {
  display: flex;
  align-items: center;
  padding: 0 8px;
  font: 500 10px/1 var(--mono);
  letter-spacing: .04em;
  white-space: nowrap;
  overflow: hidden;
  min-width: 0;
}
.inc-seg.cost { background: #2a1e1e; color: #d69696; }
.inc-seg.ship { background: #2a2418; color: #d6b976; }
.inc-seg.net  { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
.inc-empty { flex: 1; background: repeating-linear-gradient(135deg, #0c0c0c 0 4px, #0a0a0a 4px 8px); }
.inc-goal {
  position: absolute;
  top: -3px; bottom: -3px;
  width: 2px;
  background: rgba(255,255,255,.8);
}
.inc-goal-lbl {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  font: 500 9px/1 var(--mono);
  letter-spacing: .12em;
  color: var(--ink-2);
  text-transform: uppercase;
  white-space: nowrap;
}
.inc-right { text-align: right; }
.inc-net {
  font-family: var(--display);
  font-weight: 700;
  font-size: 16px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.inc-net span { color: var(--ink-4); font-size: 10px; font-weight: 500; margin-left: 2px; }
.inc-verdict {
  font: 500 9px/1 var(--mono);
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--pos);
  margin-top: 4px;
}
.inc-verdict.under { color: var(--neg); }
.inc-verdict.future { color: var(--ink-4); }
.inc-verdict b { color: var(--ink); font-weight: 600; }
.inc-legend {
  display: flex;
  gap: 14px;
  padding: 8px 14px;
  border-top: 1px solid var(--line);
  font: 500 9px/1 var(--mono);
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.inc-legend .sw {
  display: inline-block;
  width: 10px; height: 10px;
  margin-right: 4px;
  vertical-align: middle;
  border-radius: 1px;
}

/* ── Dashboard tables ─────────────────────────────────────────────────── */

table.tb { width: 100%; border-collapse: collapse; font-size: 13px; font-family: var(--sans); }
table.tb thead th {
  font: 500 10px/1 var(--mono);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink-4);
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  background: #0a0a0a;
  white-space: nowrap;
}
table.tb td { padding: 9px 10px; border-bottom: 1px solid #141414; vertical-align: middle; }
table.tb tbody tr:hover { background: #111; }
table.tb tbody tr:last-child td { border-bottom: none; }
table.tb td.r { text-align: right; }
table.tb td.nm { color: var(--ink); font-weight: 500; }
table.tb td.date { color: var(--ink-3); font: 500 11px/1 var(--mono); white-space: nowrap; letter-spacing: .04em; }
table.tb td.num { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--ink-2); }
table.tb td.num.pos { color: var(--accent); }
table.tb td.num.neg { color: var(--neg); }
table.tb td.num.est { color: var(--ink-3); }
table.tb td.num.est::before { content: "~"; color: var(--ink-4); margin-right: 1px; }

/* ── Category tags (letter badge) ─────────────────────────────────────── */

.ctag {
  display: inline-grid;
  place-items: center;
  width: 22px; height: 22px;
  border-radius: 3px;
  font: 700 10px/1 var(--mono);
  letter-spacing: 0;
}
.ctag.music   { background: rgba(255,159,84,.15);  color: #ffa66b; }
.ctag.comp    { background: rgba(168,124,243,.15); color: #c2a5f7; }
.ctag.gaming  { background: rgba(228,139,197,.15); color: #e48bc5; }
.ctag.av      { background: rgba(229,197,89,.15);  color: #e5c559; }
.ctag.camera  { background: rgba(127,217,160,.15); color: #7fd9a0; }
.ctag.media   { background: rgba(219,142,192,.15); color: #db8ec0; }
.ctag.other   { background: rgba(160,160,160,.12); color: #a0a0a0; }

/* ── Platform mark ────────────────────────────────────────────────────── */

.pmark {
  font: 500 10px/1 var(--mono);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink-3);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.pmark::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.pmark.ebay   { color: #ff7a7e; }
.pmark.reverb { color: #f9a576; }

/* ── Status mark ──────────────────────────────────────────────────────── */

.smark {
  font: 500 10px/1 var(--mono);
  letter-spacing: .14em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.smark::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.smark.listed   { color: #a8cbff; }
.smark.sold     { color: var(--accent); }
.smark.prepping { color: #c2a5f7; }

/* ── Ship panel ───────────────────────────────────────────────────────── */

.ship-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}
.ship-row:last-child { border-bottom: none; }
.ship-nm { font-size: 13px; color: var(--ink); font-weight: 500; }
.ship-sub { font: 500 10px/1 var(--mono); letter-spacing: .08em; color: var(--ink-4); margin-top: 4px; }
.ship-r { text-align: right; }
.ship-st { font: 500 10px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); }
.ship-st.deliv { color: var(--accent); }
.ship-ar { font: 500 10px/1 var(--mono); letter-spacing: .08em; color: var(--ink-4); margin-top: 4px; }

/* ── Lot recovery mini ────────────────────────────────────────────────── */

.lot-mini {
  display: grid;
  grid-template-columns: 1fr 80px 56px;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}
.lot-mini:last-child { border-bottom: none; }
.lot-mini .nm { font-size: 13px; color: var(--ink); font-weight: 500; }
.lot-mini .sub { font: 500 10px/1 var(--mono); color: var(--ink-4); margin-top: 3px; letter-spacing: .08em; }
.lot-mini .lbar { width: 80px; height: 6px; background: #1a1a1a; position: relative; overflow: hidden; }
.lot-mini .lbar > span { display: block; height: 100%; background: var(--accent); }
.lot-mini .lbar.warn > span { background: var(--warn); }
.lot-mini .lbar.neg > span  { background: var(--neg); }
.lot-mini .lpct {
  font-family: var(--display);
  font-weight: 700;
  font-size: 14px;
  color: var(--accent);
  text-align: right;
}
.lot-mini .lpct.warn { color: var(--warn); }
.lot-mini .lpct.neg  { color: var(--neg); }
```

- [ ] **Step 2: Add JS helper to `dashboard.js` for ctag category**

Add this helper inside the `dashView` data object (after the existing helpers):

```js
ctag(r) {
  const dw  = Alpine.store('dw');
  const cat = (r.category || '').toLowerCase();
  if (cat.includes('music') || cat.includes('instrument') || cat.includes('audio') || cat.includes('synth') || cat.includes('guitar')) return 'music';
  if (cat.includes('computer') || cat.includes('laptop') || cat.includes('mac') || cat.includes('pc'))  return 'comp';
  if (cat.includes('gaming') || cat.includes('game') || cat.includes('console')) return 'gaming';
  if (cat.includes('camera') || cat.includes('photo') || cat.includes('lens'))  return 'camera';
  if (cat.includes('av') || cat.includes('receiver') || cat.includes('hifi') || cat.includes('stereo') || cat.includes('turntable')) return 'av';
  if (cat.includes('vinyl') || cat.includes('record') || cat.includes('media') || cat.includes('book')) return 'media';
  return 'other';
},
ctagLetter(r) {
  const c = this.ctag(r);
  const map = { music:'M', comp:'C', gaming:'G', camera:'C', av:'A', media:'D', other:'?' };
  return map[c] || '?';
},
platformMark(r) {
  const dw  = Alpine.store('dw');
  const lbl = dw.siteLabel(r);
  if (!lbl) return 'other';
  return lbl.toLowerCase() === 'ebay' ? 'ebay' : 'reverb';
},
platformLabel(r) {
  const dw  = Alpine.store('dw');
  const lbl = dw.siteLabel(r);
  if (!lbl) return '—';
  return lbl.toLowerCase() === 'ebay' ? 'EBY' : 'RVB';
},
fmtWnd(n) {
  if (n === 0) return '$0';
  if (Math.abs(n) >= 1000) return (n < 0 ? '-' : '') + '$' + (Math.abs(n)/1000).toFixed(1) + 'k';
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', {maximumFractionDigits:0});
},
verdictText(w) {
  if (w.goalAmt === null) return null;
  const rentTimes = (w.net / (w.goalAmt)).toFixed(2);
  if (w.label === '7d')  return w.overGoal ? `↑ ${w.deltaPct}% over weekly pace` : `↓ ${Math.abs(w.deltaPct)}% under weekly pace`;
  if (w.label === '30d') return w.overGoal ? `✓ rent covered · +$${Math.round(w.net - w.goalAmt).toLocaleString()}` : `✗ $${Math.round(w.goalAmt - w.net).toLocaleString()} short of goal`;
  return `${rentTimes}× rent · ${w.label}`;
},
```

- [ ] **Step 3: Replace dashboard view HTML in `index.html`**

Find the block starting with `<div x-show="$store.dw.activeView === 'dashboard'" x-data="dashView">` and replace its entire content with:

```html
<div x-show="$store.dw.activeView === 'dashboard'" x-data="dashView">

  <!-- Hero band -->
  <div class="hero-band">
    <div class="hero-photo"></div>
    <div class="hero-head">
      <div class="hero-crumbs">DW<span class="sep">/</span><b>dashboard</b></div>
      <div class="hero-title">Overview</div>
      <div class="hero-tools">
        <button class="tool-btn" @click="$store.dw.openModal('reverb')">⟲ Reverb</button>
        <button class="tool-btn" @click="$store.dw.openModal('ebay')">⟲ eBay</button>
        <button class="tool-btn primary" @click="$store.dw.openModal('add')">+ Add</button>
      </div>
    </div>
  </div>

  <!-- Grid -->
  <div class="dw-grid">

    <!-- KPI: Cost -->
    <div class="dw-cell" style="grid-column:span 3">
      <div class="cell-head"><span class="cell-title">Cost</span><span class="cell-meta">basis</span></div>
      <div class="cell-body">
        <div class="kpi-val neg">
          <span class="kpi-curr">$</span>
          <span x-text="Math.round(totalInvested).toLocaleString('en-US')"></span>
        </div>
        <div class="kpi-meta">
          <span x-text="$store.dw.lots.length + ' lots'"></span>
        </div>
      </div>
    </div>

    <!-- KPI: Recovered -->
    <div class="dw-cell" style="grid-column:span 3">
      <div class="cell-head"><span class="cell-title">Recovered</span><span class="cell-meta">gross</span></div>
      <div class="cell-body">
        <div class="kpi-val pos">
          <span class="kpi-curr">$</span>
          <span x-text="Math.round(revenue).toLocaleString('en-US')"></span>
        </div>
        <div class="kpi-meta">
          <span x-text="$store.dw.soldRecords.length + ' sold'"></span>
          <span class="pos" x-show="tape24h > 0" x-text="'+$' + Math.round(tape24h).toLocaleString() + ' · 24h'"></span>
        </div>
      </div>
    </div>

    <!-- KPI: Realized profit -->
    <div class="dw-cell" style="grid-column:span 3">
      <div class="cell-head"><span class="cell-title">Realized</span><span class="cell-meta">net · roi</span></div>
      <div class="cell-body">
        <div class="kpi-val pos">
          <span class="kpi-curr">$</span>
          <span x-text="Math.round(profit).toLocaleString('en-US')"></span>
        </div>
        <div class="kpi-meta">
          <span>after fees</span>
          <span class="pos" x-show="soldCost > 0" x-text="'ROI +' + Math.round((profit / soldCost) * 100) + '%'"></span>
        </div>
      </div>
    </div>

    <!-- KPI: Forecast -->
    <div class="dw-cell" style="grid-column:span 3">
      <div class="cell-head"><span class="cell-title">Forecast</span><span class="cell-meta">est</span></div>
      <div class="cell-body">
        <div class="kpi-val est">
          <span class="kpi-curr">$</span>
          <span x-text="Math.round(forecastedProfit).toLocaleString('en-US')"></span>
        </div>
        <div class="kpi-meta">
          <span>realized + pipeline</span>
          <span x-text="'+$' + $store.dw.fmtK(pipeline)"></span>
        </div>
      </div>
    </div>

    <!-- Income waterfall — 8 cols -->
    <div class="dw-cell" style="grid-column:span 8">
      <div class="cell-head">
        <span class="cell-title">Income</span>
        <span class="cell-meta">gross → cost → ship → net · goal $3k/mo</span>
      </div>
      <div class="inc" x-show="incomeWindows.length">
        <template x-for="w in incomeWindows" :key="w.label">
          <div class="inc-row">
            <div class="inc-lbl">
              <span x-text="w.label"></span>
              <span x-text="w.gross > 0 ? fmtWnd(w.gross) + ' gross' : 'no data'"></span>
            </div>
            <div class="inc-track">
              <div class="inc-seg cost" :style="'width:' + w.costPct + '%'" x-text="w.cost > 500 ? 'cost ' + fmtWnd(w.cost) : ''"></div>
              <div class="inc-seg ship" :style="'width:' + w.shipPct + '%'" x-text="w.ship > 200 ? 'ship ' + fmtWnd(w.ship) : ''"></div>
              <div class="inc-seg net"  :style="'width:' + w.netPct  + '%'" x-text="w.net  > 500 ? 'net '  + fmtWnd(w.net)  : ''"></div>
              <div class="inc-empty"></div>
              <div class="inc-goal" x-show="w.goalPct" :style="'left:' + w.goalPct + '%'">
                <span class="inc-goal-lbl" x-text="'$' + (w.goalAmt/1000).toFixed(0) + 'k · ' + w.label"></span>
              </div>
            </div>
            <div class="inc-right">
              <div class="inc-net" x-text="(w.net >= 0 ? '+' : '') + fmtWnd(w.net)"><span>net</span></div>
              <div class="inc-verdict" :class="{ under: !w.overGoal && w.goalAmt !== null, future: w.goalAmt === null }"
                x-text="verdictText(w) || '—'"></div>
            </div>
          </div>
        </template>
      </div>
      <div class="inc-legend">
        <span><span class="sw" style="background:#2a1e1e"></span>Cost basis</span>
        <span><span class="sw" style="background:#2a2418"></span>Shipping</span>
        <span><span class="sw" style="background:var(--accent)"></span>Net (post-FVF)</span>
        <span style="margin-left:auto"><span class="sw" style="background:rgba(255,255,255,.8)"></span>$3k/mo goal</span>
      </div>
    </div>

    <!-- In Transit — 4 cols -->
    <div class="dw-cell" style="grid-column:span 4">
      <div class="cell-head">
        <span class="cell-title">In Transit</span>
        <span class="cell-meta" x-text="inTransitRows.length + ' pkg'"></span>
      </div>
      <div x-show="trackingLoading" style="padding:12px 14px;color:var(--ink-4);font:500 11px/1 var(--mono)">Loading…</div>
      <div x-show="!trackingLoading && inTransitRows.length === 0" style="padding:12px 14px;color:var(--ink-4);font:500 11px/1 var(--mono)">No packages in transit</div>
      <template x-for="r in inTransitRows" :key="r.id">
        <div class="ship-row">
          <div>
            <div class="ship-nm" x-text="r.name"></div>
            <div class="ship-sub" x-text="soldDate(r) + ' · ' + (r.order?.buyer_city || '—')"></div>
          </div>
          <div class="ship-r">
            <div class="ship-st" :class="{ deliv: trackStatus(r) === 'out_for_delivery' || trackStatus(r) === 'delivered' }"
              x-text="'◉ ' + trackStatusLabel(trackStatus(r))"></div>
            <div class="ship-ar" x-text="trackCarrier(r) + ' · ' + trackEstDelivery(r)"></div>
          </div>
        </div>
      </template>
    </div>

    <!-- Recently Sold — 7 cols -->
    <div class="dw-cell" style="grid-column:span 7">
      <div class="cell-head">
        <span class="cell-title">Recently Sold</span>
        <span class="cell-meta" x-text="recentlySold.length + ' items'"></span>
      </div>
      <div class="cell-body-flush">
        <table class="tb">
          <thead>
            <tr>
              <th style="width:64px">Sold</th>
              <th>Item</th>
              <th style="width:28px"></th>
              <th style="width:58px">Site</th>
              <th class="r" style="width:78px">Sale</th>
              <th class="r" style="width:84px">Profit</th>
            </tr>
          </thead>
          <tbody>
            <template x-for="r in recentlySold.slice(0,8)" :key="r.id">
              <tr>
                <td class="date" x-text="soldDate(r)"></td>
                <td class="nm" x-text="r.name"></td>
                <td><span class="ctag" :class="ctag(r)" x-text="ctagLetter(r)"></span></td>
                <td><span class="pmark" :class="platformMark(r)" x-text="platformLabel(r)"></span></td>
                <td class="num r pos" x-text="r.order?.sale_price ? '$' + r.order.sale_price.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'"></td>
                <td class="num r" :class="{ pos: itemProfit(r) > 0, neg: itemProfit(r) < 0 }"
                  x-text="itemProfit(r) !== 0 ? (itemProfit(r) > 0 ? '+' : '−') + '$' + Math.abs(itemProfit(r)).toLocaleString('en-US',{maximumFractionDigits:0}) : '—'"></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Lot Recovery — 5 cols -->
    <div class="dw-cell" style="grid-column:span 5">
      <div class="cell-head">
        <span class="cell-title">Lot Recovery</span>
        <span class="cell-meta" x-text="lotRows.length + ' active'"></span>
      </div>
      <div class="cell-body-flush">
        <template x-for="lot in lotRows.slice(0,6)" :key="lot.name">
          <div class="lot-mini">
            <div>
              <div class="nm" x-text="lot.name"></div>
              <div class="sub" x-text="'$' + lot.cost.toLocaleString('en-US',{maximumFractionDigits:0}) + ' · ' + lot.items?.length + ' items'"></div>
            </div>
            <div class="lbar" :class="{ warn: lot.pct >= 50 && lot.pct < 100, neg: lot.pct < 50 }">
              <span :style="'width:' + Math.min(lot.pct, 100) + '%'"></span>
            </div>
            <div class="lpct" :class="{ warn: lot.pct >= 50 && lot.pct < 100, neg: lot.pct < 50 }"
              x-text="lot.pct + '%'"></div>
          </div>
        </template>
      </div>
    </div>

    <!-- Recently Listed — full width -->
    <div class="dw-cell" style="grid-column:span 12">
      <div class="cell-head">
        <span class="cell-title">Recently Listed</span>
        <span class="cell-meta" x-text="recentlyListed.length + ' items · $' + $store.dw.fmtK(pipeline) + ' pipeline'"></span>
      </div>
      <div class="cell-body-flush">
        <table class="tb">
          <thead>
            <tr>
              <th style="width:64px">Added</th>
              <th>Item</th>
              <th style="width:28px"></th>
              <th style="width:58px">Site</th>
              <th style="width:80px">Status</th>
              <th class="r" style="width:80px">List</th>
              <th class="r" style="width:100px">Est. Payout</th>
              <th class="r" style="width:100px">Est. Profit</th>
              <th class="r" style="width:54px">Days</th>
            </tr>
          </thead>
          <tbody>
            <template x-for="r in recentlyListed" :key="r.id">
              <tr>
                <td class="date" x-text="listedDate(r)"></td>
                <td class="nm" x-text="r.name"></td>
                <td><span class="ctag" :class="ctag(r)" x-text="ctagLetter(r)"></span></td>
                <td><span class="pmark" :class="platformMark(r)" x-text="platformLabel(r)"></span></td>
                <td><span class="smark listed">Listed</span></td>
                <td class="num r" x-text="$store.dw.activeListing(r)?.list_price ? '$' + $store.dw.activeListing(r).list_price.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'"></td>
                <td class="num r est" x-text="$store.dw.payout(r) > 0 ? $store.dw.payout(r).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}) : '—'"></td>
                <td class="num r est" x-text="$store.dw.estProfit(r) !== 0 ? (($store.dw.estProfit(r)>0?'+':'')+$store.dw.estProfit(r).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})) : '—'"></td>
                <td class="num r" style="color:var(--ink-4)"
                  x-text="Math.floor((Date.now()-new Date(r.created_at))/(86400000)) + 'd'"></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

  </div><!-- /dw-grid -->
</div><!-- /dashboard view -->
```

- [ ] **Step 4: Verify dashboard renders**

```bash
npm start
```
Open http://localhost:3000. The dashboard should show: 4 KPI cells, income waterfall rows (may be empty if no sold data in window), in-transit list, recently sold table, lot recovery bars, recently listed table. Check browser console for errors.

Known edge case: `lot.items?.length` — the `lotRows` getter doesn't include `items` in its return object, it only returns `{ name, cost, recovered, pct, upside }`. The sub-label should use `lot.cost` for display context instead. Adjust the `lot-mini` sub text to `x-text="'$' + lot.cost.toLocaleString('en-US',{maximumFractionDigits:0})"` if items count is missing.

- [ ] **Step 5: Commit**

```bash
git add public/v2/css/components.css public/v2/index.html public/v2/js/views/dashboard.js
git commit -m "feat: rewrite dashboard with B design — kpi grid, income waterfall, panel tables ref #N"
```

---

## Task 5: Reskin remaining views

**Files:**
- Modify: `public/v2/index.html` (items, lots, analytics, comps, catalog sections)
- Modify: `public/v2/css/components.css` (view-level tokens)

Each view gets the same hero-band header treatment and token-driven updates. No functional changes — tables, filters, modals stay the same. The goal is that `--border` → `--line`, `--surface` → `--panel`, old badge classes → new tag classes, and the old `.view-header` pattern → `.hero-band`.

- [ ] **Step 1: Add hero-band to items view**

Find `<div x-show="$store.dw.activeView === 'items'" x-data="itemsView">` and add the hero-band before the existing `.view-header`:

```html
<div class="hero-band">
  <div class="hero-photo"></div>
  <div class="hero-head">
    <div class="hero-crumbs">DW<span class="sep">/</span><b>inventory</b></div>
    <div class="hero-title">Inventory</div>
    <div class="hero-tools">
      <button class="tool-btn primary" @click="$store.dw.openModal('add')">+ Add Item</button>
    </div>
  </div>
</div>
```

Then remove (or hide) the existing `.view-header` div for items.

- [ ] **Step 2: Add hero-band to lots, analytics, comps, catalog views**

Apply the same pattern to each view section:

**Lots:**
```html
<div class="hero-band">
  <div class="hero-photo"></div>
  <div class="hero-head">
    <div class="hero-crumbs">DW<span class="sep">/</span><b>lots</b></div>
    <div class="hero-title">Lots</div>
    <div class="hero-tools"></div>
  </div>
</div>
```

**Analytics:**
```html
<div class="hero-band">
  <div class="hero-photo"></div>
  <div class="hero-head">
    <div class="hero-crumbs">DW<span class="sep">/</span><b>analytics</b></div>
    <div class="hero-title">Analytics</div>
    <div class="hero-tools"></div>
  </div>
</div>
```

**Comps:**
```html
<div class="hero-band">
  <div class="hero-photo"></div>
  <div class="hero-head">
    <div class="hero-crumbs">DW<span class="sep">/</span><b>comps</b></div>
    <div class="hero-title">Comps</div>
    <div class="hero-tools"></div>
  </div>
</div>
```

**Catalog:**
```html
<div class="hero-band">
  <div class="hero-photo"></div>
  <div class="hero-head">
    <div class="hero-crumbs">DW<span class="sep">/</span><b>catalog</b></div>
    <div class="hero-title">Catalog</div>
    <div class="hero-tools"></div>
  </div>
</div>
```

- [ ] **Step 3: Update `components.css` for old badge/table classes**

The existing views use `.badge`, `.badge-sold`, `.badge-listed`, etc. Map these to new colors so they still work without a full HTML rewrite:

```css
/* ── Legacy badge compat ──────────────────────────────────────────────── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: 500 10px/1 var(--mono);
  letter-spacing: .1em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 3px;
}
.badge-sold     { background: rgba(255,207,92,.14); color: var(--accent); }
.badge-listed   { background: rgba(123,180,255,.12); color: #a8cbff; }
.badge-prepping { background: rgba(168,124,243,.14); color: #c2a5f7; }
.badge-pending  { background: rgba(94,211,154,.12);  color: var(--pos); }
.badge-other    { background: #1a1a1a; color: var(--ink-3); }
```

Also update the existing `.tbl` table class to match the new table treatment:

```css
/* ── Main inventory table update ──────────────────────────────────────── */
table.tbl thead th {
  background: #0a0a0a;
  color: var(--ink-4);
  border-bottom-color: var(--line);
}
table.tbl td { border-bottom-color: var(--line); }
table.tbl tbody tr:hover { background: #111; }
```

- [ ] **Step 4: Verify all views render**

```bash
npm start
```
Navigate through Dashboard → Inventory → Lots → Analytics → Comps → Catalog. Each should show the hero-band header. No broken layouts. Modals (item, lot, add, label) should still open and function — they get token updates automatically via CSS vars but no markup changes.

- [ ] **Step 5: Commit**

```bash
git add public/v2/css/components.css public/v2/index.html
git commit -m "style: apply hero-band + token refresh to all views ref #N"
```

---

## Task 6: Version bump + cleanup

**Files:**
- Modify: `public/v2/js/config.js`
- Modify: `package.json`
- Modify: `docs/session-log.md`

- [ ] **Step 1: Bump patch version**

In `public/v2/js/config.js`, increment `APP_VERSION` by one patch (e.g. `1.1.38` → `1.1.39`).
In `package.json`, increment `version` to match.

- [ ] **Step 2: Update session log**

Add an entry to `docs/session-log.md` noting the design system refresh: tokens, tape, rail nav, dashboard rewrite, income waterfall data layer, hero-band across views.

- [ ] **Step 3: Final commit**

```bash
git add public/v2/js/config.js package.json docs/session-log.md
git commit -m "chore: v1.1.39 — B design system refresh"
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Design tokens (IBM Plex Mono / Space Grotesk / Azeret Mono, new ink hierarchy, amber accent) — Task 1
- ✅ Tape strip with live stats — Task 2
- ✅ 64px rail nav replacing 220px sidebar — Task 2
- ✅ Hero band per view — Tasks 2 + 5
- ✅ KPI cells (Cost, Recovered, Realized, Forecast) — Task 4
- ✅ Income waterfall with rolling windows — Tasks 3 + 4
- ✅ In Transit panel wired to real data — Task 4
- ✅ Recently Sold table — Task 4
- ✅ Lot Recovery bars — Task 4
- ✅ Recently Listed table with est. payout/profit — Task 4
- ✅ Reskin remaining views (no IA changes) — Task 5
- ✅ Version bump — Task 6
- ⚠️ `lot.items` count in lot-mini — `lotRows` getter returns `{ name, cost, recovered, pct, upside }` without `items`. The sub-label in Task 4 Step 3 notes to use `lot.cost` only. No change needed to `dashboard.js`.

**Placeholder scan:** No TBDs or "handle edge cases" patterns found.

**Type consistency:** `incomeWindows` defined in Task 3, consumed in Task 4. `fmtWnd`, `verdictText`, `ctag`, `ctagLetter`, `platformMark`, `platformLabel` defined in Task 4 Step 2, used in Task 4 Step 3. Consistent.
