# Momentum Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-chart analytics section with a single "momentum" chart showing cumulative gross and net profit across expanding time windows (3d → 90d), broken down by site.

**Architecture:** All logic lives in `charts.js` (`chartsSection` Alpine component). A new `momentumData()` helper computes windowed profit from `$store.dw.soldRecords`. A new `buildMomentumChart()` replaces the four existing build methods. HTML drops the 4-column grid and adds one full-width canvas.

**Tech Stack:** Chart.js 4 (CDN, already loaded), Alpine.js store, existing `soldRecords` getter.

---

## Chart.js Dataset Structure — Read This First

This chart uses Chart.js 4's **per-dataset `stack` property** to produce grouped stacked bars. Each time window gets one cluster of bars. Within each cluster, there are up to 4 bar positions: `hero` (all sites combined), `reverb`, `ebay`, `facebook`. Each bar position has two stacked layers: net profit (solid color, bottom) and the overage = gross − net (dim color, stacked on top). Total bar height = gross. Colored fill = net.

```
Window cluster "7d":
  [ hero bar: net(green) + overage(dim) ]
  [ reverb bar: net(orange) + overage(orange-dim) ]
  [ ebay bar: net(yellow) + overage(yellow-dim) ]
  (facebook omitted if zero sales)
```

Datasets (6 fixed + optional facebook pair):
```js
{ label: 'Net (All)',     data: [n3, n7, n14, n30, n60, n90], stack: 'hero',    backgroundColor: 'rgba(72,187,120,0.85)' }
{ label: 'Cost+Fees (All)', data: [o3,...],                   stack: 'hero',    backgroundColor: 'rgba(255,255,255,0.07)' }
{ label: 'Net (Reverb)', data: [...],                          stack: 'reverb',  backgroundColor: 'rgba(237,100,50,0.8)' }
{ label: 'Cost+Fees (Reverb)', data: [...],                    stack: 'reverb',  backgroundColor: 'rgba(237,100,50,0.2)' }
{ label: 'Net (eBay)',   data: [...],                          stack: 'ebay',    backgroundColor: 'rgba(236,201,75,0.8)' }
{ label: 'Cost+Fees (eBay)', data: [...],                      stack: 'ebay',    backgroundColor: 'rgba(236,201,75,0.2)' }
// optional:
{ label: 'Net (Facebook)', data: [...],                        stack: 'facebook',backgroundColor: 'rgba(153,153,153,0.7)' }
{ label: 'Cost+Fees (Facebook)', data: [...],                  stack: 'facebook',backgroundColor: 'rgba(153,153,153,0.2)' }
```

**Key Chart.js 4 note:** When using the `stack` dataset property, do NOT set `stacked: true` on the scale — that's the old API. The `stack` property handles grouping automatically. Set `x.grid.display: false` and `y.ticks.callback` for dollar formatting.

---

## Files

| File | Change |
|---|---|
| `public/v2/js/charts.js` | Replace 4 build methods + add `momentumData()` helper. Keep `buildCharts()` and init logic untouched. |
| `public/v2/index.html` | Replace 4-column 4-canvas grid with one full-width panel + single canvas. |

---

## Task 1: Compute windowed profit data

**File:** `public/v2/js/charts.js`

Add a `momentumData()` method to the `chartsSection` component, above `buildRevenueChart`. This method returns all the data arrays needed for the chart.

- [ ] **Step 1: Add the `momentumData()` method**

Insert this method into `chartsSection`, just before `buildRevenueChart()`:

```js
momentumData() {
  const dw = Alpine.store('dw');
  const WINDOWS = [3, 7, 14, 30, 60, 90];
  const now = new Date();

  // Per-window, per-site gross and net
  const sites = ['All', 'Reverb', 'eBay', 'Facebook'];
  const gross = {}; // gross[site][windowIdx]
  const net   = {}; // net[site][windowIdx]
  for (const s of sites) {
    gross[s] = Array(WINDOWS.length).fill(0);
    net[s]   = Array(WINDOWS.length).fill(0);
  }

  for (const r of dw.soldRecords) {
    const raw = r.order?.date_sold;
    if (!raw) continue;
    const sold     = new Date(raw + (raw.includes('T') ? '' : 'T00:00:00'));
    const ageMs    = now - sold;
    const ageDays  = ageMs / (1000 * 60 * 60 * 24);

    const saleGross = r.order?.sale_price || 0;
    const cost      = r.cost || 0;
    const shipping  = r.shipment?.shipping_cost || 0;

    // Fee: find the sold listing by presence of an order (not l.status — that's 'active'/'ended')
    // Fee base is saleGross (actual sale price), not list_price — intentional for actuals.
    const listing  = r.listings?.find(l => l.order) || r.listings?.[0];
    const site     = listing?.site;
    const siteName = site?.name || 'Other';
    let fee = 0;
    if (site) {
      fee = site.fee_on_shipping
        ? (saleGross + shipping) * site.fee_rate + site.fee_flat
        : saleGross * site.fee_rate + site.fee_flat;
    }
    const saleNet = saleGross - cost - shipping - fee;

    for (let i = 0; i < WINDOWS.length; i++) {
      if (ageDays <= WINDOWS[i]) {
        gross['All'][i] += saleGross;
        net['All'][i]   += saleNet;
        if (sites.includes(siteName)) {
          gross[siteName][i] += saleGross;
          net[siteName][i]   += saleNet;
        }
      }
    }
  }

  // overage[site][i] = gross - net (the fees+cost visual layer)
  const overage = {};
  for (const s of sites) {
    overage[s] = WINDOWS.map((_, i) => Math.max(0, gross[s][i] - net[s][i]));
  }

  return { gross, net, overage, hasFacebook: gross['Facebook'].some(v => v > 0) };
},
```

- [ ] **Step 2: Commit**

```bash
git add public/v2/js/charts.js
git commit -m "ref #48: add momentumData() — windowed gross/net by site"
```

---

## Task 2: Add `buildMomentumChart()` and wire into `buildCharts()`

**File:** `public/v2/js/charts.js`

- [ ] **Step 1: Add `buildMomentumChart()` after `momentumData()`**

```js
buildMomentumChart() {
  const dw = Alpine.store('dw');
  if (dw.soldRecords.length === 0) return;

  const { net, overage, hasFacebook } = this.momentumData();
  const labels = ['3d', '7d', '14d', '30d', '60d', '90d'];

  const datasets = [
    { label: 'Net (All)',           data: net['All'],      stack: 'hero',     backgroundColor: 'rgba(72,187,120,0.85)',  order: 1 },
    { label: 'Cost+Fees (All)',     data: overage['All'],  stack: 'hero',     backgroundColor: 'rgba(255,255,255,0.07)', order: 1 },
    { label: 'Net (Reverb)',        data: net['Reverb'],   stack: 'reverb',   backgroundColor: 'rgba(237,100,50,0.8)',   order: 1 },
    { label: 'Cost+Fees (Reverb)',  data: overage['Reverb'],stack:'reverb',   backgroundColor: 'rgba(237,100,50,0.2)',   order: 1 },
    { label: 'Net (eBay)',          data: net['eBay'],     stack: 'ebay',     backgroundColor: 'rgba(236,201,75,0.8)',   order: 1 },
    { label: 'Cost+Fees (eBay)',    data: overage['eBay'], stack: 'ebay',     backgroundColor: 'rgba(236,201,75,0.2)',   order: 1 },
  ];

  if (hasFacebook) {
    datasets.push(
      { label: 'Net (Facebook)',       data: net['Facebook'],    stack: 'facebook', backgroundColor: 'rgba(153,153,153,0.7)', order: 1 },
      { label: 'Cost+Fees (Facebook)', data: overage['Facebook'],stack: 'facebook', backgroundColor: 'rgba(153,153,153,0.2)',order: 1 }
    );
  }

  this.charts.momentum = new Chart(this.$refs.momentumCanvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10,
            padding: 8,
            filter: item => !item.text.startsWith('Cost+Fees'),
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const isOverage = ctx.dataset.label.startsWith('Cost+Fees');
              // Extract site name from label, e.g. 'Net (Reverb)' → 'Reverb'
              const site = ctx.dataset.label.replace(/^(Cost\+Fees|Net) \(/, '').replace(')', '');
              if (isOverage) {
                // Find the net dataset for this stack to compute gross = net + overage
                const netDs = ctx.chart.data.datasets.find(
                  d => d.stack === ctx.dataset.stack && !d.label.startsWith('Cost+Fees')
                );
                const gross = (netDs?.data[ctx.dataIndex] || 0) + ctx.parsed.y;
                return ` Gross (${site}): $${gross.toFixed(2)}`;
              }
              return ` Net (${site}): $${ctx.parsed.y.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { callback: v => '$' + v.toFixed(0) } },
      },
    },
  });
},
```

- [ ] **Step 2: Replace `buildCharts()` body to call only `buildMomentumChart()`**

Find the `buildCharts()` method (lines ~21–34) and replace just the inner calls:

```js
buildCharts() {
  clearTimeout(this._buildTimer);
  this._buildTimer = setTimeout(() => {
    Object.values(this.charts).forEach(c => c.destroy());
    this.charts = {};
    this.buildMomentumChart();
  }, 50);
},
```

- [ ] **Step 3: Remove the four old build methods**

Delete these methods entirely from `chartsSection`:
- `buildRevenueChart()`
- `buildPipelineChart()`
- `buildLotROIChart()`
- `buildUpsideChart()`

- [ ] **Step 4: Commit**

```bash
git add public/v2/js/charts.js
git commit -m "ref #48: add buildMomentumChart(), remove old chart methods"
```

---

## Task 3: Replace HTML analytics section

**File:** `public/v2/index.html`

- [ ] **Step 1: Find the analytics section**

Grep to confirm line numbers:
```bash
grep -n "Analytics Charts\|chartsSection\|revenueCanvas\|upsideCanvas" public/v2/index.html
```

- [ ] **Step 2: Replace the analytics section**

Find and replace the entire analytics `<section>` block (from `<!-- Analytics Charts -->` through its closing `</section>`) with:

```html
<!-- Analytics Charts -->
<section x-data="chartsSection" style="margin-top:24px">
  <div class="panel-title" style="margin-bottom:12px">MOMENTUM</div>
  <div class="panel">
    <div style="position:relative;height:300px">
      <canvas x-ref="momentumCanvas"></canvas>
      <div x-show="$store.dw.soldRecords.length === 0"
           style="padding:20px 0;color:var(--muted);font-size:12px">
        No sales data yet
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Commit**

```bash
git add public/v2/index.html
git commit -m "ref #48: replace 4-chart grid with single momentum chart canvas"
```

---

## Task 4: Browser validation

No automated tests — verify manually.

- [ ] Hard refresh the dashboard (Cmd+Shift+R)
- [ ] Confirm the ANALYTICS section is gone, MOMENTUM section appears with a single chart
- [ ] Confirm 6 window clusters render left-to-right: 3d, 7d, 14d, 30d, 60d, 90d
- [ ] Confirm the hero bar (All) appears with a green fill (net) and dim overage layer
- [ ] Confirm per-site bars render in orange (Reverb) and yellow (eBay)
- [ ] Confirm legend shows Net (All), Net (Reverb), Net (eBay) — no Cost+Fees entries
- [ ] Confirm tooltips show dollar values correctly
- [ ] Confirm no JS errors in console
- [ ] Confirm chart rebuilds cleanly after opening/closing a sync modal (no flicker, no destroyed chart errors)

- [ ] **Commit session wrap**

```bash
git add -A
git commit -m "ref #49: momentum chart — complete"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- ✓ Time windows 3d/7d/14d/30d/60d/90d — covered in `momentumData()` WINDOWS array
- ✓ Left-to-right shortest→longest — labels order is `['3d','7d','14d','30d','60d','90d']`
- ✓ Hero bar (all-sites gross/net) — `stack: 'hero'` datasets using `net['All']` / `overage['All']`
- ✓ Per-site sub-bars (Reverb, eBay, Facebook) — separate stack groups per site
- ✓ Gross/net fill — net on bottom, overage (gross−net) stacked on top = total bar height = gross
- ✓ Facebook omitted if no data — `hasFacebook` guard
- ✓ Old charts removed — `buildCharts()` updated, old methods deleted, HTML replaced
- ✓ Legend hides Cost+Fees entries — `filter` callback in legend labels

**Placeholder scan:** No TBDs, no "similar to above," all code shown in full.

**Type consistency:** `momentumData()` returns `{ gross, net, overage, hasFacebook }`. `buildMomentumChart()` destructures exactly `{ net, overage, hasFacebook }` — consistent. `$refs.momentumCanvas` matches the `x-ref="momentumCanvas"` in HTML.
