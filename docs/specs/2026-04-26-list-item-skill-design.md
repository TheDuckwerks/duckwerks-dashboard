# list-item Skill — Design Spec
**Date:** 2026-04-26

---

## Overview

A CLI skill (`list-item`) that walks through listing a single item on eBay in a linear, phase-gated flow. Each phase writes a checkpoint file so the session can be resumed or fast-forwarded by hand-crafting the checkpoint. Start dumb, wire in automation later.

---

## Scope

- One invocation = one item
- Linear flow with a fast-forward: if a checkpoint exists and phases are already complete, skip ahead
- Category-agnostic (comics, music gear, disc golf, electronics, etc.)
- All API calls go to `http://fedora.local:3000` (live NUC server, local network only)
- No web searches — gap analysis is handled by targeted questions, not open-ended research

---

## Checkpoint Files

**Location:** `tmp/listing-sessions/<slug>.json`  
**Slug:** derived from item name at session start (e.g., `elfquest-hidden-years.json`)  
**Lifecycle:** created at phase 1, updated after each completed phase, left in place until item is listed. Manual cleanup after listing.

**Shape:**
```json
{
  "item_name": "ElfQuest Hidden Years lot",
  "slug": "elfquest-hidden-years",
  "created": "2026-04-26",
  "phases": {
    "intake": { "done": true, "data": { ... } },
    "gap_analysis": { "done": true, "data": { ... } },
    "comp_terms": { "done": true, "data": { ... } },
    "comp_data": { "done": false, "data": null },
    "pricing": { "done": false, "data": null },
    "copy": { "done": false, "data": null },
    "metadata": { "done": false, "data": null },
    "listing": { "done": false, "data": null }
  }
}
```

To jump ahead: create or edit the JSON manually, mark earlier phases as `done: true` with their data populated, and invoke the skill. It will pick up from the first incomplete phase.

---

## Phase Gates

### Phase 1 — Intake
Skill asks: what are you selling? Collects:
- Item name / description (what it is, condition, any known details)
- Category (skill infers if obvious, asks if not)
- Quantity / lot size if applicable
- Anything you already know about price or condition

Writes checkpoint with intake data. Proceeds to gap analysis.

### Phase 2 — Gap Analysis
Skill assesses what it knows vs. what it needs based on intake + category:
- Known norms for the category? (shipping method, packaging, typical eBay item specifics) → proceed
- Unknown? → ask targeted questions (1-2 max, not open-ended research)
- Produces a brief "here's what I know, here's what I'm assuming" summary for confirmation

**TODO (future):** hit `GET /api/ebay/aspects?category=X` to pull required item specifics for the eBay category programmatically.

### Phase 3 — Comp Search Terms
Skill proposes 2-3 eBay search term variants based on item name + category knowledge. You confirm or edit. Output is the exact search string(s) to enter in the dashboard COMP tab.

**TODO (future):** call `POST /api/comps/search` directly and skip the manual dashboard step entirely.

### Phase 4 — Comp Data
Skill pauses and tells you exactly what to do:
> "Go to http://fedora.local:3000 → COMP tab → search for [terms] → download CSV → paste it here."

You paste the raw CSV. Skill saves it to the checkpoint and proceeds.

**TODO (future):** after Phase 3 is automated, this phase collapses — comp data arrives automatically.

### Phase 5 — Pricing
Skill analyzes the comp CSV using the rules in `docs/gear-comp-research.md` (category-specific pricing notes apply). Outputs:
- Comp range (floor / midpoint / ceiling)
- Recommended list price with rationale
- Confidence level (thin pool, stale comps, etc.)

You confirm the price or override. Confirmed price saved to checkpoint.

### Phase 6 — Listing Copy
Skill writes:
- eBay title (80-char max, searchable specs first)
- Description (story intro → specs → free shipping paragraph → "Sold As Is.")
- Condition field copy

Style rules loaded from `docs/listing-style.md` — same pattern as `docs/gear-comp-research.md`. Edit that file between sessions to iterate on copy results without touching the skill.

You review. Edit requests loop back within this phase before proceeding.

### Phase 7 — Metadata
Skill produces the full eBay listing metadata block:
- Category ID
- Condition (eBay condition value)
- Item specifics / aspects (key-value pairs relevant to the category)
- Shipping: Media Mail for comics/books, calculated or free for others
- Return policy
- Duration (GTC)
- Min offer % (default 75%)

**TODO (future):** validate required aspects against live eBay category data via the server.

### Phase 8 — Listing
Skill presents a final review summary: title, price, condition, key metadata, description preview. You approve.

**TODO (future):** on approval, call `POST http://fedora.local:3000/api/ebay/bulk-list` (or a new general-purpose listing endpoint) to post directly to eBay. For now, skill outputs a "ready to list" block you can use for manual entry.

---

## Implementation Prerequisites

Before the skill can be built, these artifacts need to exist:

- **`docs/listing-style.md`** — listing copy rules extracted from desktop memories and committed to the repo. Covers: title format, description structure, free shipping paragraph (verbatim), "Sold As Is." rule, no em-dashes, round numbers only, local pickup variant. This is created as part of implementation, not a blocker.

---

## What's Intentionally Deferred

- Direct comp pull via API (Phase 3/4 TODO)
- eBay aspects lookup via API (Phase 2/7 TODO)
- Actual eBay posting via API (Phase 8 TODO) — the bulk-list route is disc-specific; a general endpoint needs to be built before this can be wired in
- Dashboard item creation after listing (the dashboard's existing eBay sync handles this automatically)
- Multi-item batching (out of scope for v1 — run the skill once per item)

---

## Skill Location

`~/.claude/plugins/cache/claude-plugins-official/` is for official plugins only. This is a project-specific skill:

**Path:** `.claude/skills/list-item.md` (project-level, checked into the repo)

Or if Geoff prefers it available across all projects: `~/.claude/skills/list-item.md` (user-level).

Recommendation: project-level for now since it references project-specific paths and `fedora.local`.

---

## Success Criteria

- Skill can walk a new item from zero to a ready-to-post listing block without confusion
- Checkpoint file allows resuming a half-done session
- Hand-crafted checkpoint (e.g., paste in existing comp data) correctly skips completed phases
- Style rules are applied consistently without reminders (loaded from `docs/listing-style.md`)
- Easy to add API automation to any phase later without restructuring the flow
