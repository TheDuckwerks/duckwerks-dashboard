# Dashboard Charts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4-chart analytics section to the bottom of the Dashboard view using Chart.js CDN.

**Architecture:** New `charts.js` registers `Alpine.data('chartsSection')` that reads from `$store.dw` and builds 4 Chart.js instances when data loads. A new `<section>` in `index.html` holds the canvas elements. Chart.js CDN loaded before Alpine.

**Tech Stack:** Chart.js 4 (CDN), Alpine.js 3, existing Space Mono / dark-theme CSS vars.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `public/v2/index.html` | Modify | Add Chart.js CDN script tag + `charts.js` script tag; add charts section HTML at line ~218 |
| `public/v2/js/charts.js` | Create | `Alpine.data('chartsSection')` — init, buildCharts, 4 chart builders |

---

### Task 1: Add Chart.js CDN + scaffold `charts.js`

**Files:**
- Modify: `public/v2/index.html` (script block, ~lines 1058–1075)
- Create: `public/v2/js/charts.js`

- [ ] **Step 1: Add Chart.js CDN and charts.js to index.html**

In `index.html`, find the script block near line 1072 (after `reverb-modal.js`, before the Alpine `defer` line). Add two lines — **Chart.js CDN must come before `charts.js`** because `charts.js` references the global `Chart` object at runtime:

```html
<!-- Chart.js — non-deferred, before charts.js and before Alpine -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="js/charts.js"></script>

<!-- Alpine last -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
```

Final order in that block:
```
config.js
store.js
sidebar.js
views/dashboard.js ... views/lots.js
modals/item-modal.js ... modals/reverb-modal.js
chart.js CDN (non-deferred)   ← Chart global must exist before charts.js runs
charts.js                     ← registers Alpine.data('chartsSection')
alpinejs CDN (deferred)       ← Alpine initializes last, fires alpine:init
```

- [ ] **Step 2: Create `public/v2/js/charts.js` scaffold**

```js
// ── Dashboard Charts — Chart.js ────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('chartsSection', () => ({
    charts: {},

    init() {
      // Set Chart.js dark theme defaults once
      Chart.defaults.color = '#999';
      Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';

      // Dual-path: watch for data load, and handle already-loaded case
      this.$watch('$store.dw.loading', (val) => {
        if (!val) this.buildCharts();
      });
      const dw = Alpine.store('dw');
      if (!dw.loading && dw.records.length > 0) {
        this.buildCharts();
      }
    },

    buildCharts() {
      // Destroy any existing instances before recreating
      Object.values(this.charts).forEach(c => c.destroy());
      this.charts = {};
      this.buildRevenueChart();
      this.buildPipelineChart();
      this.buildLotROIChart();
      this.buildUpsideChart();
    },

    buildRevenueChart()  { /* Task 3 */ },
    buildPipelineChart() { /* Task 4 */ },
    buildLotROIChart()   { /* Task 5 */ },
    buildUpsideChart()   { /* Task 6 */ },

  }));
});
```

- [ ] **Step 3: Verify no errors**

Run `npm start`, open `http://localhost:3000`, open browser console.
Expected: no errors. `Alpine.store('dw')` should still load normally.

- [ ] **Step 4: Commit**

```bash
git add public/v2/index.html public/v2/js/charts.js
git commit -m "feat: scaffold Chart.js chartsSection ref #4"
```

---

### Task 2: Add charts section HTML to the dashboard

**Files:**
- Modify: `public/v2/index.html` (~line 218, inside the dashboard `x-show` block)

- [ ] **Step 1: Add charts section HTML**

In `index.html`, use grep to find the exact insertion point:
```
grep -n "Recently Listed\|<!-- Items -->" public/v2/index.html
```
You'll see `<!-- Recently Listed -->` around line 188 and `<!-- Items -->` around line 221. The dashboard `x-show` block ends with a `</div>` just before `<!-- Items -->`. Insert the charts section **between the closing `</div>` of the recently-listed panel and the closing `</div>` of the dashboard block** — i.e. right before the `</div>` that sits immediately before `<!-- Items -->`.

```html
        <!-- Analytics Charts -->
        <section x-data="chartsSection" style="margin-top:24px">
          <div class="panel-title" style="margin-bottom:12px">ANALYTICS</div>
          <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px">

            <!-- Chart 1: Monthly Revenue + Profit -->
            <div class="panel">
              <div class="panel-title" style="font-size:10px;margin-bottom:8px">REVENUE & PROFIT</div>
              <div style="position:relative;height:220px">
                <canvas x-ref="revenueCanvas"></canvas>
              </div>
            </div>

            <!-- Chart 2: Inventory Pipeline -->
            <div class="panel">
              <div class="panel-title" style="font-size:10px;margin-bottom:8px">INVENTORY PIPELINE</div>
              <div style="position:relative;height:220px">
                <canvas x-ref="pipelineCanvas"></canvas>
              </div>
            </div>

            <!-- Chart 3: Lot ROI -->
            <div class="panel">
              <div class="panel-title" style="font-size:10px;margin-bottom:8px">LOT ROI</div>
              <div style="position:relative;height:220px">
                <canvas x-ref="lotCanvas"></canvas>
              </div>
            </div>

            <!-- Chart 4: Near-term Upside -->
            <div class="panel">
              <div class="panel-title" style="font-size:10px;margin-bottom:8px">NEAR-TERM UPSIDE</div>
              <div style="position:relative;height:220px">
                <canvas x-ref="upsideCanvas"></canvas>
              </div>
            </div>

          </div>
        </section>
```

- [ ] **Step 2: Verify layout renders**

Reload `http://localhost:3000`. Switch to Dashboard view.
Expected: 4 empty chart cards visible below the Recently Listed table, in a 4-column row. No console errors.

- [ ] **Step 3: Commit**

```bash
git add public/v2/index.html
git commit -m "feat: add charts section HTML to dashboard ref #4"
```

---

### Task 3: Build Chart 1 — Monthly Revenue + Profit

**Files:**
- Modify: `public/v2/js/charts.js` — implement `buildRevenueChart()`

- [ ] **Step 1: Implement `buildRevenueChart()`**

Replace the `buildRevenueChart() { /* Task 3 */ }` stub:

```js
buildRevenueChart() {
  const dw = Alpine.store('dw');
  if (dw.soldRecords.length === 0) return;

  // Group sold records by month.
  // Use YYYY-MM as the sort key (parseable by Date), store display label separately.
  const byMonth = {};
  dw.soldRecords.forEach(r => {
    const raw = dw.str(r, F.dateSold);
    if (!raw) return;
    const d    = new Date(raw);
    const sortKey    = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const displayKey = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    if (!byMonth[sortKey]) byMonth[sortKey] = { display: displayKey, revenue: 0, profit: 0 };
    const sale     = dw.num(r, F.sale);
    const cost     = dw.num(r, F.cost);
    const shipping = dw.num(r, F.shipping);
    byMonth[sortKey].revenue += sale;
    byMonth[sortKey].profit  += sale - cost - shipping;
  });

  // Sort chronologically by YYYY-MM key, then use display labels for the chart
  const sortedKeys = Object.keys(byMonth).sort();
  const labels  = sortedKeys.map(k => byMonth[k].display);
  const revenue = sortedKeys.map(k => byMonth[k].revenue);
  const profit  = sortedKeys.map(k => byMonth[k].profit);

  this.charts.revenue = new Chart(this.$refs.revenueCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: revenue,
          backgroundColor: 'rgba(66,153,225,0.6)',  // --blue
          order: 2,
        },
        {
          label: 'Profit',
          data: profit,
          type: 'line',
          borderColor: 'rgba(72,187,120,0.9)',       // --green
          backgroundColor: 'transparent',
          pointRadius: 3,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } },
        tooltip: {
          callbacks: {
            label: ctx => ` $${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        y: { ticks: { callback: v => '$' + v.toFixed(0) } },
      },
    },
  });
},
```

- [ ] **Step 2: Verify in browser**

Reload and go to Dashboard.
Expected: Chart 1 shows bars for each month with a profit line overlay. If you only have a few months of data that's fine — bars should match roughly what the KPI cards show.

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/charts.js
git commit -m "feat: monthly revenue+profit chart ref #4"
```

---

### Task 4: Build Chart 2 — Inventory Pipeline

**Files:**
- Modify: `public/v2/js/charts.js` — implement `buildPipelineChart()`

- [ ] **Step 1: Implement `buildPipelineChart()`**

Replace the `buildPipelineChart() { /* Task 4 */ }` stub:

```js
buildPipelineChart() {
  const dw = Alpine.store('dw');

  // Compute status counts and values fresh (do not reuse notListed getter — it doesn't exclude Pending)
  const listedRecs   = dw.listedRecords;
  const pendingRecs  = dw.pendingRecords;
  const soldRecs     = dw.soldRecords;
  const unlistedRecs = dw.records.filter(r => {
    const s = dw.str(r, F.status);
    return s !== 'Listed' && s !== 'Sold' && s !== 'Pending';
  });

  // Value annotations: EAF total for Listed, cost total for Unlisted
  const listedEAF     = listedRecs.reduce((s, r) => s + dw.eaf(dw.num(r, F.listPrice)), 0);
  const unlistedCost  = unlistedRecs.reduce((s, r) => s + dw.num(r, F.cost), 0);
  const fmt = n => '$' + n.toFixed(0);

  this.charts.pipeline = new Chart(this.$refs.pipelineCanvas, {
    type: 'bar',
    data: {
      labels: ['Inventory'],
      datasets: [
        {
          label: `Unlisted (${unlistedRecs.length} · ${fmt(unlistedCost)} cost)`,
          data: [unlistedRecs.length],
          backgroundColor: 'rgba(153,153,153,0.5)',  // --muted
        },
        {
          label: `Listed (${listedRecs.length} · ${fmt(listedEAF)} EAF)`,
          data: [listedRecs.length],
          backgroundColor: 'rgba(236,201,75,0.7)',   // --yellow
        },
        {
          label: `Pending (${pendingRecs.length})`,
          data: [pendingRecs.length],
          backgroundColor: 'rgba(66,153,225,0.7)',   // --blue
        },
        {
          label: `Sold (${soldRecs.length})`,
          data: [soldRecs.length],
          backgroundColor: 'rgba(72,187,120,0.4)',   // --green dimmed
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}` } },
      },
      scales: {
        x: { stacked: true, ticks: { display: false }, grid: { display: false } },
        y: { stacked: true, ticks: { display: false } },
      },
    },
  });
},
```

- [ ] **Step 2: Verify in browser**

Reload Dashboard.
Expected: Chart 2 shows a single horizontal stacked bar with 4 color-coded segments and a legend showing counts. The total width represents all inventory.

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/charts.js
git commit -m "feat: inventory pipeline chart ref #4"
```

---

### Task 5: Build Chart 3 — Lot ROI

**Files:**
- Modify: `public/v2/js/charts.js` — implement `buildLotROIChart()`

- [ ] **Step 1: Implement `buildLotROIChart()`**

Replace the `buildLotROIChart() { /* Task 5 */ }` stub:

```js
buildLotROIChart() {
  const dw = Alpine.store('dw');
  if (dw.lots.length === 0) return;

  // Recompute lot rows (can't access dashView.lotRows from here)
  const rows = dw.lots.map(lot => {
    const cost      = lot.items.reduce((s, r) => s + dw.num(r, F.cost), 0);
    const recovered = lot.items
      .filter(r => dw.str(r, F.status) === 'Sold')
      .reduce((s, r) => s + dw.num(r, F.sale), 0);
    const pct = cost > 0 ? Math.min(100, Math.round((recovered / cost) * 100)) : 0;
    return { name: lot.name, pct };
  }).sort((a, b) => b.pct - a.pct);

  const labels = rows.map(r => r.name);
  const data   = rows.map(r => r.pct);
  const colors = rows.map(r =>
    r.pct >= 100 ? 'rgba(72,187,120,0.7)'   :  // --green
    r.pct >= 50  ? 'rgba(236,201,75,0.7)'   :  // --yellow
                   'rgba(245,101,101,0.7)'     // --red
  );

  this.charts.lot = new Chart(this.$refs.lotCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Recovery %',
        data,
        backgroundColor: colors,
        borderRadius: 2,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x}% recovered` } },
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: { callback: v => v + '%' },
        },
      },
    },
  });
},
```

- [ ] **Step 2: Verify in browser**

Reload Dashboard.
Expected: Chart 3 shows one horizontal bar per lot, color-coded green/yellow/red by recovery %, sorted best-first. Hovering shows "X% recovered".

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/charts.js
git commit -m "feat: lot ROI chart ref #4"
```

---

### Task 6: Build Chart 4 — Near-term Upside by Category

**Files:**
- Modify: `public/v2/js/charts.js` — implement `buildUpsideChart()`

- [ ] **Step 1: Implement `buildUpsideChart()`**

Replace the `buildUpsideChart() { /* Task 6 */ }` stub:

```js
buildUpsideChart() {
  const dw = Alpine.store('dw');
  if (dw.listedRecords.length === 0) return;

  const colorMap = {
    Music:    'rgba(66,153,225,0.7)',    // --blue
    Computer: 'rgba(159,122,234,0.7)',   // --purple
    Gaming:   'rgba(237,137,54,0.7)',    // --orange
    Other:    'rgba(153,153,153,0.5)',   // --muted
  };

  const byCategory = {};
  dw.listedRecords.forEach(r => {
    const cat = dw.str(r, F.category) || 'Other';
    const key = colorMap[cat] ? cat : 'Other';
    byCategory[key] = (byCategory[key] || 0) + dw.estProfit(r);
  });

  const labels = Object.keys(byCategory);
  const data   = labels.map(l => byCategory[l]);
  const colors = labels.map(l => colorMap[l] || colorMap.Other);

  this.charts.upside = new Chart(this.$refs.upsideCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Est. Profit',
        data,
        backgroundColor: colors,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` $${ctx.parsed.y.toFixed(2)} est. profit`,
          },
        },
      },
      scales: {
        y: { ticks: { callback: v => '$' + v.toFixed(0) } },
      },
    },
  });
},
```

- [ ] **Step 2: Verify in browser**

Reload Dashboard.
Expected: Chart 4 shows vertical bars for each category with estimated profit. Colors match the category badge colors used elsewhere in the app. Hovering shows dollar amount.

- [ ] **Step 3: Commit**

```bash
git add public/v2/js/charts.js
git commit -m "feat: near-term upside by category chart ref #4"
```

---

### Task 7: Polish + final verification

**Files:**
- Modify: `public/v2/js/charts.js` — add "no data" guards
- Modify: `public/v2/index.html` — verify panel styling fits

- [ ] **Step 1: Add "no data" placeholders via HTML overlays**

The canvas approach for empty state is unreliable because canvas dimensions are unset before Chart.js runs. Use HTML overlays instead — Alpine already manages these elements.

In `index.html`, update each chart card's inner div to include an overlay div. Example for Chart 1 (repeat the pattern for all 4):

```html
<div style="position:relative;height:220px">
  <canvas x-ref="revenueCanvas"></canvas>
  <div x-show="$store.dw.soldRecords.length === 0"
       style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px">
    No sales data yet
  </div>
</div>
```

Empty conditions per chart:
- Chart 1 (Revenue): `$store.dw.soldRecords.length === 0`
- Chart 2 (Pipeline): `$store.dw.records.length === 0`
- Chart 3 (Lot ROI): `$store.dw.lots.length === 0`
- Chart 4 (Upside): `$store.dw.listedRecords.length === 0`

The early `return` guards in each `buildXChart()` method remain as-is (they prevent Chart.js from running on empty data). The overlay handles the visual message.

- [ ] **Step 2: Full dashboard visual check**

Reload, verify:
- All 4 charts render on wide viewport in a single row
- KPI cards and tables above are unchanged
- No console errors
- Hovering charts shows tooltips with dollar amounts
- Charts update after triggering a data refresh (open/close the Reverb sync modal which calls `fetchAll`)

- [ ] **Step 3: Final commit**

```bash
git add public/v2/js/charts.js
git commit -m "feat: dashboard analytics charts complete ref #4"
```
