# Multi-Unit Listings — Design Spec
_2026-05-02_

## Problem

The dashboard assumes one item = one unit. When selling identical items (e.g. 18 event towels from the same listing), there's no way to track quantity, partial sales, or per-order shipment status without minting N duplicate item rows or managing everything manually outside the dashboard.

## Scope

Add `quantity` support to items so that a single item row can represent N identical units sold through one eBay listing. Order sync decrements the count automatically. The inventory and tracking views surface the right information without cluttering the UI.

This does not change anything for single-unit items (`quantity = 1`), which is the default and covers ~99% of inventory.

---

## Data Model

### Schema changes

Add two columns to the `items` table:

```sql
ALTER TABLE items ADD COLUMN quantity      INTEGER NOT NULL DEFAULT 1;
ALTER TABLE items ADD COLUMN quantity_sold INTEGER NOT NULL DEFAULT 0;
```

- `quantity` — total units available at time of listing. Set manually when creating the item.
- `quantity_sold` — incremented by order sync as orders come in. Never decremented.
- Items with `quantity = 1` are treated as single-unit and behave exactly as today.

### Status logic

- While `quantity_sold < quantity`: status = `Listed`
- When `quantity_sold >= quantity`: status flips to `Sold`
- If an incoming order would push `quantity_sold > quantity`: cap at `quantity`, flip to `Sold`, set an `oversold` flag (see below)

### Oversold flag

Add a boolean `oversold` column (default false) to items. Set to true if order sync ever tries to decrement past zero. Surfaced as a visible warning in the item detail modal header. No automated resolution — Geoff handles it manually.

```sql
ALTER TABLE items ADD COLUMN oversold INTEGER NOT NULL DEFAULT 0;
```

---

## Order Sync Changes

When processing an incoming eBay order:

1. Find the listing referenced by the order's line item
2. Look up the item attached to that listing
3. If `item.quantity > 1`:
   - Increment `quantity_sold` by the order's line item quantity
   - If `quantity_sold >= quantity`: set `status = 'Sold'`
   - If new `quantity_sold > quantity`: cap at `quantity`, set `oversold = 1`, set `status = 'Sold'`
4. If `item.quantity = 1`: existing behavior unchanged (flip item to Sold)

The order and shipment records are created as normal regardless — each order is its own row, each shipment is its own row. No changes to orders or shipments tables.

---

## Setting Quantity — Import vs. Manual

### Listing sync (going forward)
When the listing sync imports an eBay listing, check for a quantity field on the listing object (`availableQuantity` in the Inventory API, or `quantityAvailable` in the Trading API). If > 1, set `quantity` on the created item automatically.

### Already-imported listings
For items already in the DB (like the towel), add an editable `Quantity` field to the item edit modal. Geoff sets it manually after the fact. This field is always visible on multi-unit items and hidden (or locked to 1) on single-unit items.

---

## API Changes

### `GET /api/items` and `GET /api/items/:id`

Include `quantity` and `quantity_sold` in the response. Existing consumers see no breaking change (new fields only).

### `POST /api/items` and `PATCH /api/items/:id`

Accept optional `quantity` field. Validated as a positive integer. Defaults to 1 if omitted.

---

## Inventory View (INV)

Single-unit items: no change.

Multi-unit items (`quantity > 1`):
- Status pill replaced with a quantity badge: **"14 / 18"** — green while units remain, amber when low (<=20% remaining), flipping to the sold color at zero
- Clicking the row opens the multi-unit detail modal instead of the standard item modal
- The item still appears as a single row — no explosion into N rows

---

## Multi-Unit Detail Modal

Reuses the lot detail modal layout and CSS wholesale. No new design patterns.

**Header stats (four cards):**
- Total Cost — `quantity × cost`
- Recovered — sum of sale prices across all orders
- Realized Profit — recovered minus fees minus shipping costs, for completed orders
- Forecasted Profit — realized + projected profit on remaining units at list price

**Progress bar:**
- `quantity_sold / quantity` — same recovery progress bar as lot detail
- Label: "X sold · Y remaining"

**Oversold warning** (if `oversold = true`):
- Red banner at top of modal: "Warning: more units were sold than inventory tracked. Review orders manually."

**Sold units table:**
One row per order. Columns:
- Order # (eBay order ID)
- Date sold
- Sale price
- Shipment status (Pending / Shipped / Delivered)

**Remaining units:**
A single summary row at the bottom of the table: "X units remaining · Listed at $Y"

---

## Tracking View

Multi-unit items appear as one row per sold unit (one per order), not one row for the item.

Row label: `"[Item Name] · Order #[eBay order ID]"`

All other columns (carrier, tracking number, status) work the same as any other shipment row. No special treatment needed beyond the label format.

---

## What Doesn't Change

- Single-unit items: zero behavior change
- Lots: unchanged
- Orders table: unchanged
- Shipments table: unchanged
- Listing workflow (list-item skill): quantity is set manually in Seller Hub; the skill stays single-unit focused

---

## Out of Scope

- Restocking (incrementing quantity after initial set)
- Per-unit notes or condition tracking
- Multi-unit support in the list-item skill / eBay API posting
- Reverb multi-quantity listings
