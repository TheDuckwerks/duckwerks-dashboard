# Reverb Sync Details — Design Spec
**Issue:** #14
**Date:** 2026-03-17
**Status:** Approved

---

## Overview

When Geoff updates listing prices or titles on Reverb while browsing, he wants those changes reflected in Airtable without manually editing each record. The Reverb Sync modal becomes the single place to review and apply all pending Reverb → Airtable updates.

---

## Goals

- Pull updated `title` (→ `F.name`) and `price` (→ `F.listPrice`) from Reverb listings into Airtable
- Show diffs before writing — user confirms, then applies
- Zero extra API calls at modal open; diffs computed from already-fetched listings data
- Consistent UX with the existing "Save Matches" pattern in the modal

---

## Out of Scope

- Syncing other Reverb fields (condition, description, photos, etc.)
- Pushing changes from Airtable → Reverb
- Per-item granular sync (all-or-nothing on the diff set)
- Auto-saving without user confirmation

---

## Architecture

### Pagination Fix (prerequisite)

`/api/reverb/my/listings` is paginated. With 20–30 listings, results likely span 1–2 pages. The modal's `run()` method must fetch all pages before processing.

The Reverb API returns a `_links.next.href` in the response when more pages exist. The fix: loop `fetch` calls following `_links.next.href` until no next link, then merge all `listings` arrays.

This is a fix to the existing fetch, not a new API call type. All downstream logic continues to use the unified `this.listings` array.

Reset `detailDiffs = []`, `detailsMsg = ''`, `syncingDetails = false` at the top of `run()` alongside the existing state resets (e.g. `matchesMsg`, `linksMsg`, `orders`, `listings`).

### Diff Computation (in `_process()`)

After the existing match/link logic, compute `detailDiffs`:

```
detailDiffs = for each Airtable record with a reverbListingId:
  find the matching listing where String(listing.id) === dw.str(r, F.reverbListingId)
  if found and (listing.title !== dw.str(r, F.name) OR parseFloat(listing.price.amount) !== parseFloat(rec.fields[F.listPrice])):
    push { rec, listing, newName: listing.title, newPrice: parseFloat(listing.price.amount), oldName: dw.str(r, F.name), oldPrice: rec.fields[F.listPrice] }
```

Only records with at least one changed field appear in the diff list. Records without a `reverbListingId`, or whose listing wasn't returned by the API, are silently skipped.

### Sync Write (`syncDetails()`)

Mirrors `saveMatches()`:
- Iterates `detailDiffs`
- For each diff: `updateRecord(rec.id, { [F.name]: newName, [F.listPrice]: newPrice })`
- Tracks saved/error counts
- Sets `detailsMsg` with result (e.g. `✓ 3 synced` or `2 synced, 1 failed`)
- After 800ms delay, re-runs `_process()` to clear resolved diffs

---

## UI — New Section in Reverb Sync Modal

Placed below the existing "Link Listings" section.

**Section header:** `LISTING DETAILS`

**States:**

| State | Display |
|---|---|
| No diffs | `✓ All listing details match` (muted text) |
| Diffs found | Table showing changed records |
| After sync | `✓ N synced` confirmation message |

**Diff table columns:** Item Name (old → new), Price (old → new)

- Old values shown in muted text, new values shown in default color
- If only one field changed, the unchanged field still shows for context (no arrow needed)
- "SYNC DETAILS" button below the table — disabled if no diffs, shows spinner while saving

**No new section if `detailDiffs` is empty** — section still renders but shows the "all match" state so Geoff knows it ran.

---

## Data Mapping

| Reverb field | Airtable field |
|---|---|
| `listing.title` | `F.name` |
| `listing.price.amount` | `F.listPrice` |

Price comparison is handled in the pseudocode above via `parseFloat` on both sides.

---

## Error Handling

- If pagination fetch fails mid-sequence, surface error in existing `errMsg` display
- Per-record save failures reported in `detailsMsg` count (same as `matchesMsg` pattern)
- Listings not found in the fetched set (e.g. draft listings) are silently skipped — no error

---

## Files Changed

| File | Change |
|---|---|
| `public/v2/js/modals/reverb-modal.js` | Add `detailDiffs`, `detailsMsg`, `syncingDetails` state; update `run()` for pagination; update `_process()` for diff computation; add `syncDetails()` method |
| `public/v2/index.html` | Add "Listing Details" section to `reverbModal` template |

No changes to `server/reverb.js` — the generic GET proxy already handles paginated listing fetches.
