# Dashboard Charts — Design Spec
_Date: 2026-03-17_

## Overview

Add a 4-chart analytics section to the bottom of the Dashboard view. Charts are purely additive — no existing panels are modified. Uses Chart.js via CDN, consistent with the no-build Alpine.js stack.

## Goals

- At-a-glance business pulse: are revenue and profit trending up?
- Active inventory visibility: what's in flight, what's stuck, what's the near-term value?
- Lot ROI: which lots are recovered vs underwater?
- No fluff — functional over fancy

## Charts

### 1. Monthly Revenue + Profit
- **Type:** Bar + Line combo (Chart.js type: `bar` with a `line` dataset overlay)
- **X-axis:** Last 12 months (or all months with data if < 12), formatted as `Mon YYYY`
- **Data:** `soldRecords` grouped by `dateSold` month
  - Bar dataset: sum of `F.sale` per month (revenue)
  - Line dataset: sum of `F.sale - F.cost - F.shipping` per month (profit)
- **Colors:** Bar = `--blue`, Line = `--green`

### 2. Inventory Pipeline
- **Type:** Horizontal stacked bar
- **Data:** Count of all records by status bucket. Compute fresh in `chartsSection` — do not reuse `notListed` from `dashView` (that getter excludes only Listed+Sold, not Pending):
  - Unlisted: `records` where status is not Listed, Sold, or Pending
  - Listed: `listedRecords.length`
  - Pending: `pendingRecords.length`
  - Sold: `soldRecords.length` (shown dimmed as trailing context)
- **Labels:** Each segment labeled with count + total EAF value for Listed, total cost for Unlisted
- **Colors:** Unlisted = `--muted`, Listed = `--yellow`, Pending = `--blue`, Sold = `--green`

### 3. Lot ROI
- **Type:** Horizontal bar chart, one bar per lot
- **Data:** Recompute lot rows in `chartsSection` — do not reference `dashView.lotRows` (cross-component getter access is not supported in Alpine). Use the same formula as `dashView`:
  ```js
  const rows = Alpine.store('dw').lots.map(lot => {
    const cost      = lot.items.reduce((s, r) => s + dw.num(r, F.cost), 0);
    const recovered = lot.items.filter(r => dw.str(r, F.status) === 'Sold')
                               .reduce((s, r) => s + dw.num(r, F.sale), 0);
    const pct = cost > 0 ? Math.min(100, Math.round((recovered / cost) * 100)) : 0;
    return { name: lot.name, pct };
  }).sort((a, b) => b.pct - a.pct);
  ```
- **Bar value:** `pct` — the cap of 100 is applied in the data computation above, not via Chart.js axis config
- **Color per bar:** `--green` if pct ≥ 100, `--yellow` if pct ≥ 50, `--red` if pct < 50
- **Sorted:** Descending by pct for the chart (most recovered first)

### 4. Near-term Upside by Category
- **Type:** Vertical bar chart
- **Data:** `listedRecords` grouped by `F.category`, summing `estProfit(r)` per group
- **Categories:** Music, Computer, Gaming (plus "Other" if uncategorized items exist)
- **Colors:** Match existing `CAT_COLOR` map (`--blue`, `--purple`, `--orange`). Use `--muted` for the "Other" bucket.
- **Purpose:** Shows where the near-term money is coming from

## Layout

New `<section>` at the bottom of the Dashboard view (below Recently Listed panel):

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Monthly Rev  │  Inventory   │   Lot ROI    │  Near-term   │
│ + Profit     │  Pipeline    │              │  Upside      │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

- CSS grid: `grid-template-columns: repeat(4, 1fr)`, `gap: 16px`
- Each chart in a card matching existing `--surface` / `--border` styling
- Section header: `ANALYTICS` in the same uppercase muted label style as other dashboard sections
- Charts sized at a fixed canvas height (~220px) for consistency

## Files

### New: `public/v2/js/charts.js`
Registers `Alpine.data('chartsSection', ...)`. Responsibilities:
- `init()`: watches `$store.dw.loading` — calls `buildCharts()` when loading transitions to false
- `buildCharts()`: destroys any existing Chart instances, then creates all 4
- Helper methods per chart: `buildRevenueChart()`, `buildPipelineChart()`, `buildLotROIChart()`, `buildUpsideChart()`
- `charts: {}` — stores Chart.js instances keyed by name for cleanup

### Modified: `public/v2/index.html`
1. Add CDN script tag: `<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>` — place this in the same `<script>` block as the other local JS files, **before** the deferred Alpine CDN tag. Alpine loads with `defer`; Chart.js and `charts.js` must be registered before Alpine initializes.
2. Add `<script src="/v2/js/charts.js"></script>` after `store.js` in load order (alongside other view scripts)
3. Add charts section markup inside the dashboard `x-show` block, below recently-listed panel

## Alpine Integration Notes

- `chartsSection` reads from `$store.dw` (same pattern as all other views — no direct Airtable calls)
- **Dual-path init:** `loading` starts as `false` in the store, so a `$watch` alone won't fire on first mount if data is already loaded. `init()` must both set the watch AND immediately call `buildCharts()` if `!$store.dw.loading && $store.dw.records.length > 0`. Pattern:
  ```js
  init() {
    this.$watch('$store.dw.loading', (val) => { if (!val) this.buildCharts(); });
    if (!Alpine.store('dw').loading && Alpine.store('dw').records.length > 0) {
      this.buildCharts();
    }
  }
  ```
- **Chart destruction:** `buildCharts()` must call `.destroy()` on each existing Chart.js instance before recreating. Chart.js throws if you re-use a canvas that already has a registered chart. Store instances in `this.charts = {}` and destroy all before rebuild.
- Guard against empty data: if `soldRecords.length === 0`, show a "no data yet" placeholder per chart
- Canvas elements referenced via `$refs`: `$refs.revenueCanvas`, `$refs.pipelineCanvas`, etc.
- Chart.js global defaults set once in `init()`: `Chart.defaults.color = '#999'`, `Chart.defaults.borderColor = 'rgba(255,255,255,0.08)'` to match dark theme

## Data Notes

- **Profit formula:** Charts use `F.sale - F.cost - F.shipping` (same as `dashView.profit`). This is raw sale price minus costs — for Reverb sales, `F.sale` already stores the post-fee payout, so this is correct. No `eaf()` applied to sold items.

## Chart.js Configuration Notes

- **Dark theme:** Set `Chart.defaults.color = '#999'` and `Chart.defaults.borderColor = 'rgba(255,255,255,0.08)'`
- **No legend** on Pipeline and Upside charts (self-labeling); legend on Revenue chart for Revenue/Profit lines
- **Tooltips:** Default Chart.js tooltips are fine — no custom formatting needed
- **Responsive:** `responsive: true`, `maintainAspectRatio: false` on all charts so they fill their card

## Out of Scope

- No date range picker / filtering — charts always show all available data
- No click-through from charts to filtered views (potential future enhancement)
- No animation tuning — Chart.js defaults are fine
- The existing KPI cards, lot recovery table, recently sold, and recently listed panels are untouched
