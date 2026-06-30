# Inventory Workbench Design Spec
**Date:** 2026-04-20
**Issues:** #102 (inventory redesign), #110 (date range filter)
**Status:** Approved — ready for implementation plan

---

## Goal

Turn the inventory table from a generic ledger into a mode-aware workbench. The two real working modes are **Listed** (what's live, how's it doing) and **Sold** (what sold, what's the profit). Columns, data, and filters adapt to the active mode.

---

## 1. View Modes

The status filter drives the mode. Three modes:

| Mode | Status pill | Column set |
|---|---|---|
| **Listed** | Listed | Dedicated listed columns (see §2) |
| **Sold** | Sold | Dedicated sold columns (see §3) |
| **All / Prepping** | All, Prepping | Current unified table (no change) |

Implementation: `statusFilter` drives an `x-if` or conditional in the `<thead>` and `<tbody>` template. The `rows` getter already handles filtering — column rendering is the only change.

---

## 2. Listed Mode Columns

| Column | Data source | Notes |
|---|---|---|
| Added | `created_at` | Short date format (Apr 20) |
| Name | `r.name` | Left-aligned, font-weight 500 |
| Cat | `r.category` | Badge |
| Site | listing site | Badge |
| Status | `r.status` | Inline change menu (existing) |
| List Price | `activeListing.list_price` | `—` if none |
| Est Payout | `dw.payout(r)` | `~` prefix, ink-3 color |
| **Est Profit** | `dw.estProfit(r)` | **Accent color, bold — decision column** |
| Days Listed | `(now - created_at) / 86400000` | Muted; ⚑ flag at 20d+ |

Sorted by: `createdTime desc` default (most recently added first).

---

## 3. Sold Mode Columns

| Column | Data source | Notes |
|---|---|---|
| Date Sold | `order.date_sold` | Short date format |
| Name | `r.name` | Left-aligned, font-weight 500 |
| Cat | `r.category` | Badge |
| Site | listing site | Badge |
| Sale Price | `order.sale_price` | Actual, no `~` |
| **Actual Profit** | `order.profit` | **Accent color, bold — decision column** |
| Shipping | `shipment.shipping_cost` | Actual cost, `—` if none |
| Tracking | `shipment.tracking_id` | Existing badge (In Transit / Delivered etc.) |

Sorted by: `soldDate desc` default (most recently sold first).

No estimated values in Sold mode. No `~$7` shipping estimates.

---

## 4. All / Prepping Mode

Current unified table unchanged. No column redesign — this mode is rarely used and functions as a safety net. Keep existing show/hide logic for Date Sold and Tracking columns.

---

## 5. Date Range Filter

Appears in the controls row for **Listed and Sold modes only** (not All or Prepping).

**Presets:** All · 24h · 7d · 30d

**Date field by mode:**
- Listed → filters `created_at`
- Sold → filters `order.date_sold`

**State:** `dateRange: 'all'` (string, one of `'all' | '24h' | '7d' | '30d'`). Persisted to localStorage alongside status/site filters. Default: `'all'`.

**No custom range in this iteration** — follow-up ticket if needed.

---

## 6. Site Filter — Multi-Select

`siteFilter: 'All'` (string) → `siteFilters: []` (array of site name strings).

- Empty array = All sites (same as current "All" behavior)
- "All" pill: active when array is empty; clicking it clears the array
- Site pills: toggle site in/out of array; active when site is in array
- Filtering in `rows` getter: record must have at least one listing matching any site in `siteFilters`
- Persisted to localStorage as array

Touch points: `items.js` (state, rows getter, saveFilters, pushFilteredKpis), HTML pills template.

---

## 7. Search Expansion

Same input, same UX. Searches across: `name`, `sku`, `lot.name`, `notes` (if field exists on record — check with optional chaining, no error if absent).

Placeholder: `"search name, SKU, lot…"`

---

## 8. Tape — Add Forecast

Add one more `tape-item` to the global tape strip (after "listed"):

```
forecast  +$X,XXX
```

Value: sum of `dw.estProfit(r)` for all records where `r.status === 'Listed'`. This is the same calculation as `dashView.pipeline` — move it to `store.js` as a computed getter (`get pipeline()`) so both dashboard and tape can use it without duplication.

Store getter:
```js
get pipeline() {
  return this.records
    .filter(r => r.status === 'Listed')
    .reduce((s, r) => s + this.estProfit(r), 0);
}
```

---

## 9. Visual

- Listed and Sold mode tables adopt **`tb` class** (already defined in `components.css` from dashboard work). Remove `data-table` class from those two mode templates.
- All/Prepping mode keeps `data-table` class — no change.
- Est Profit (listed) and Actual Profit (sold) columns: rendered with `class="num r"` plus accent color inline or via a `.profit-col` modifier. Should visually read as heavier than List Price or Payout.
- No other visual changes to modals, sidebar, or other views.

---

## 10. Files Changed

| File | Change |
|---|---|
| `public/v2/js/views/items.js` | `siteFilters[]`, `dateRange`, search expansion, rows getter updates, saveFilters, pushFilteredKpis |
| `public/v2/js/store.js` | Add `get pipeline()` getter |
| `public/v2/index.html` | Listed thead/tbody, Sold thead/tbody, date range pills, site multi-select pills, tape forecast item |
| `public/v2/css/components.css` | Optional: `.profit-col` accent modifier if not already handled by inline styles |

---

## Out of Scope

- Bulk row selection / bulk actions (deferred, no ticket)
- Custom date range picker (follow-up if needed)
- All/Prepping column redesign
- KPI strip on the page (tape already shows filtered KPIs; Forecast added to tape addresses the gap)
- Any modal or backend changes
