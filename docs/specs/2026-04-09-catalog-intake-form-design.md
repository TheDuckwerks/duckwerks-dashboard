# Catalog Intake Form — Design Spec
Date: 2026-04-09

## Overview
A hidden dashboard view for quickly cataloging new disc golf discs into the Google Sheet. Replaces manual spreadsheet data entry with a tab-friendly form that auto-increments Disc #, persists Box across entries, and resets cleanly after each submit.

## Access
Small "Catalog" link in the sidebar footer (next to version/env info). Sets `$store.dw.activeView = 'catalog'` — same nav pattern as all other views. Not shown in the main nav pills.

## Server
New file `server/catalog-intake.js`, mounted at `/api/catalog` in `server.js`.

Two endpoints:
- `GET /api/catalog/next-disc-num` — reads the last row of the sheet, returns `{ nextDiscNum: N }`
- `POST /api/catalog/disc` — appends a new row to the sheet, returns `{ discNum: N }`

Both use the Google service account at `docs/handicaps-244e5d936e6c.json` via the `googleapis` npm package. Sheet ID is the DG catalog sheet (`1Gmdw2qcHRA_9wz29CXul3pTCT92pX56V4FPLkrhNnHE`), sheet name `duckwerks-dg-catalog`.

The POST writes these columns in order (A–R):
- A: Disc #
- B: Box
- C: List Title — blank
- D: Description — blank
- E: Sold — `FALSE`
- F: Manufacturer
- G: Mold
- H: Type
- I: Plastic
- J: Run/Edition
- K: Notes
- L: Condition
- M: Weight (g)
- N: Color
- O: Est. Value — blank
- P: List Price
- Q: Platform — hardcoded `"Ebay"`
- R: Status — blank

## Frontend
New file `public/v2/js/views/catalog.js` — `Alpine.data('catalogView', ...)`.

### Fields (tab order)
| # | Field | Input type | Default | Notes |
|---|---|---|---|---|
| 1 | Disc # | read-only display | auto from server | fetched on view init and after each submit |
| 2 | Box | text | last value from `localStorage` | persists across submits and page reloads |
| 3 | Manufacturer | select | — | seeded from sheet on view init |
| 4 | Mold | text | — | free text |
| 5 | Type | select | — | Distance Driver, Fairway Driver, Midrange, Putter |
| 6 | Plastic | text | — | free text |
| 7 | Run/Edition | text | — | free text |
| 8 | Notes | text | — | free text |
| 9 | Condition | toggle button | Unthrown | Unthrown / Used |
| 10 | Weight | number | 175 | integer grams |
| 11 | Color | select | — | eBay color enum |
| 12 | List Price | number | 25 | dollars |

### Manufacturer Seeding
On view `init()`, fetch `GET /api/catalog/manufacturers` which reads column F of the sheet and returns a deduplicated sorted list. Cached in component state for the session.

### Submit Behavior
1. POST to `/api/catalog/disc`
2. On success: show green toast `"Disc #N saved"` for 2 seconds
3. Reset form: clear Mold, Type, Plastic, Run/Edition, Notes, Weight→175, Color, List Price→25, Condition→Unthrown
4. Keep: Box (unchanged), Disc # (incremented to N+1)
5. Focus first editable field (Box or Manufacturer)

### Error Handling
If POST fails: show red toast with error message. Form state preserved so nothing is lost.

## CSS / Design
Uses existing dashboard design tokens and component styles. No new CSS needed beyond minor layout for the form grid. Follows dark theme, Space Mono font.

## Dependencies
- `googleapis` npm package (add to package.json if not present)
- Service account JSON already at `docs/handicaps-244e5d936e6c.json`
- No new env vars needed
