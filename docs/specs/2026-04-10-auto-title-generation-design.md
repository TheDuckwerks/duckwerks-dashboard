# Auto-Generate eBay Listing Title — Design Spec
**Issue:** ringleader3/duckwerksdash#94
**Date:** 2026-04-10

## Problem

Listing titles are written manually in the Google Sheet. They follow a consistent format that is fully derivable from structured catalogue fields. Manual entry is error-prone and slow when cataloguing at volume.

## Title Format

```
{Manufacturer} {Mold} {Plastic} {Run/Edition} {Weight}g {Color} {Condition}
```

- **Run/Edition** is optional — omitted (with its trailing space) if blank
- **80 character hard limit** — eBay's constraint; truncate to last full word at or under 80 chars
- All fields are already captured by the catalogue form

### Examples

| Fields | Generated Title |
|---|---|
| Axiom, Pixel, Electron Soft, —, 173, Yellow, Unthrown | `Axiom Pixel Electron Soft 173g Yellow Unthrown` |
| Innova, Roc, Star, 2020 Oakland City Championships Full Color Dye, 180, —, Unthrown | `Innova Roc Star 2020 Oakland City Championships Full Color Dye 180g Unthrown` → truncated if >80 |
| Discraft, Hades, ESP, Leopard Print Foil Stamp, 174, Pink, Unthrown | `Discraft Hades ESP Leopard Print Foil Stamp 174g Pink Unthrown` |

### Truncation Rule

Assemble the full string, then if over 80 chars: trim to the last space at or before position 80. No mid-word cuts.

```
"Innova Roc Star 2020 Oakland City Championships Full Color Dye 180g Unthrown" → 77 chars → fine
"Innova Eagle Color Glow Lake Chabot New Years Classic 2025 175g Pink Unthrown" → 79 chars → fine
```

Most titles will be well under 80 chars. Run/Edition is where overruns happen.

## Implementation

### Server-side only — `server/catalog-intake.js`

Add a `generateTitle(disc)` helper function:

```js
function generateTitle({ manufacturer, mold, plastic, run, weight, color, condition }) {
  const parts = [manufacturer, mold, plastic];
  if (run) parts.push(run);
  parts.push(`${weight}g`, color, condition);
  const title = parts.join(' ');
  if (title.length <= 80) return title;
  // Truncate to last full word at or under 80 chars
  return title.slice(0, 81).replace(/\s+\S*$/, '');
}
```

Call it in `POST /disc` before the sheet append. Write the result to column C (List Title).

### No frontend changes

Title is derived, not entered. The form doesn't change. The POST response should include the generated title so it's visible in the browser console for spot-checking during rollout.

## What This Is Not

- No title editing UI — titles are written once at catalogue time; edits go directly in the sheet
- No backfill of existing 167 titles — those were written manually and are already good; this is forward-only
- No Claude-assisted title generation — the format is deterministic, no LLM needed
