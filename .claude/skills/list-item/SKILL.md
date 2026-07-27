---
name: list-item
description: Use when listing a single item for sale on eBay — walks through intake, gap analysis, comp search terms, comp analysis, pricing, listing copy, and metadata in a linear phase-gated flow with checkpoint files for resuming sessions.
---

# list-item

A linear workflow for taking a single item from "I have this thing" to a ready-to-post eBay listing. One invocation = one item. Checkpoint files allow resuming mid-session.

## Philosophy

This skill is a guide and workflow assistant, not a bulletproof automation pipeline. One-off listings are expected to have rough edges. **Manual steps in Seller Hub are a valid and acceptable outcome** — if the API won't cooperate, say so clearly and tell Geoff what to do manually rather than retrying.

**When you hit an unknown API error, missing category ID, unfamiliar scope, or any case where the right answer requires docs or external lookup: stop after the first failed attempt and ask.** Geoff can Google, paste docs, or grab a category ID from a live eBay listing URL in under a minute. Do not chain speculative API calls — one failed attempt is the signal to ask, not to retry variations.

**When posting multiple listings in a batch: fix → test on one item → confirm it works → then run the rest.** Never apply an untested fix across all items at once — a failure on item 1 means waiting through all N API calls to learn nothing new.

## Style and Pricing Rules

Load these two files at the start of every session — they govern all copy and pricing decisions:

- `docs/listing-style.md` — title format, description structure, free shipping paragraph (verbatim), "Sold As Is." rule, no em-dashes, round numbers
- `docs/gear-comp-research.md` — comp analysis rules, category-specific pricing notes (comics, music gear, disc golf, electronics)

**Read both files before Phase 1.**

## Session Folders

**Location:** `docs/listing-sessions/<slug>/`
**Slug:** kebab-case item name (e.g. `elfquest-hidden-years`)

Each session folder contains:
- `checkpoint.json` — phase state, written after each completed phase
- `comps.txt` — comp data file, written automatically by the skill after API fetch
- `listing.md` — final ready-to-post output, written at Phase 8
- `photos/` — drop item photos here (jpg/png) before Phase 8; skill reads and uploads to eBay EPS at post time

On invocation: check `docs/listing-sessions/` for a folder matching the item. If `checkpoint.json` exists, skip to the first phase where `done: false`. If not found, create the folder and start at Phase 1.

You can hand-craft a checkpoint to jump ahead — populate earlier phases as `done: true` with their data and the skill picks up from the first incomplete phase.

```json
{
  "item_name": "",
  "slug": "",
  "created": "",
  "phases": {
    "intake":       { "done": false, "data": null },
    "gap_analysis": { "done": false, "data": null },
    "comp_terms":   { "done": false, "data": null },
    "comp_data":    { "done": false, "data": null },
    "pricing":      { "done": false, "data": null },
    "copy":         { "done": false, "data": null },
    "metadata":     { "done": false, "data": null },
    "listing":      { "done": false, "data": null }
  }
}
```

Write `checkpoint.json` after each completed phase.

## Phase Flow

### Phase 1 — Intake
Ask: what are you selling? Collect:
- Item name / description (what it is, condition, known details)
- Category (infer if obvious, ask if not)
- Quantity / lot size if applicable
- Anything already known about price

Create checkpoint. Proceed.

### Phase 2 — Gap Analysis
Based on intake + category, assess what you know vs. what you need:
- Shipping method norms for the category
- Typical eBay item specifics / aspects required
- Any category-specific pricing factors from `gear-comp-research.md`

**Lot assignment:** Call `GET https://dash.pond.duckwerks.com/api/lots` to get the lot list. Present the names and ask which lot this item belongs to. Save `lot_id` and `lot_name` to gap_analysis data. If the API is unreachable, ask the user directly.

If other gaps exist, ask 1-2 targeted questions. Do NOT open-ended web search.

Output a brief "here's what I know, here's what I'm assuming" summary and confirm before proceeding.

> **TODO:** call `GET https://dash.pond.duckwerks.com/api/ebay/aspects?category=X` to pull required item specifics automatically.

### Phase 3 — Comp Search Terms
Propose 2-3 eBay search term variants. Explain the tradeoffs (broad vs. specific). User confirms or edits.

Output: the exact search string(s) to use. Save to checkpoint. Then immediately proceed to Phase 4 — no manual step needed.

### Phase 4 — Comp Data

**Sold comps are a manual pull by Geoff.** eBay serves sold listings only to a logged-in browser session, so every automated path — `/api/comps/search`, SerpAPI, the COMP tab — returns a clean, successful, empty result. It is not a bug in dash, an API key, or a search term. GOTCHAS carries the diagnosis under Comp research and #168 tracks the reopen; do not spend a session rediscovering it.

The pull, per confirmed search term:

1. Geoff runs the term on eBay, filters to **Sold**, sorts by **Ended Recently**.
2. Cmd+A, Cmd+C, paste into `docs/listing-sessions/<slug>/comps.txt`. Raw page text, no cleanup — the page carries date, title, price, and shipping in a consistent pattern.
3. All terms go into the one file; separate them at parse time.

**Then read the file. All of it, top to bottom, before parsing or computing anything.** That read is the phase — a parser converts the page into rows, and the rows are not the comps. What matters lives in the title text: a "New Batt" or "new screen" marks a different product at a different tier, "for parts" and "cracked" mark the floor rather than the market, and eBay's own structured year/spec fields are frequently wrong (2013 chips tagged 2015, a 13" machine listed as 14.5"). A statistic computed before that read is a number about the wrong set.

Write the parsed rows alongside the raw paste, and report to Geoff how many entries parsed out of how many the page held. A parse that silently drops rows is the failure mode to catch here.

Save file reference to checkpoint. Proceed to Phase 5.

### Phase 5 — Pricing
Price off the rows read in Phase 4, using `docs/gear-comp-research.md` rules.

Build the comparison set by title, not by field. Drop what does not comp — wrong year, parts-only, damaged, lots — and separate the tiers before taking any range: a refurbished or repaired unit sits above the market, a broken one below, and a median across all three describes nothing. Name the rows you excluded and why, so Geoff can see what left the set. A filter that reads a structured field instead of the title will drop the closest match in the file without saying so.

Output:
- Comp range: floor / midpoint / ceiling, each traceable to named rows
- The nearest-config sales, quoted by title and landed price — these carry more weight than the range
- Recommended list price, with the rationale stated against those rows
- Confidence level (thin pool, stale comps, etc.)

Sanity-check the recommendation against the item's own flaws before presenting it. If the number lands near the top of the range while the item carries the defects the top-of-range sellers fixed, the set is wrong, not the market.

User confirms or overrides. Save confirmed price to checkpoint.

### Phase 6 — Copy
Write using `docs/listing-style.md` rules:
- eBay title (80-char max)
- Description (story intro → specs → free shipping paragraph → "Sold As Is.")
- Condition field

Present for review. Loop on edit requests within this phase before proceeding.

### Phase 7 — Metadata
Produce the full eBay listing metadata block.

**Resolve eBay IDs from `docs/ebay-category-map.json`:**
- Read the map file
- Match the category label from intake (e.g. `"Comics > Comic Books"`) to get `ebay_category_id`
- Match the condition string (e.g. `"Very Good"`) to get the numeric condition ID from that category's `conditions` map
- If the category label isn't in the map, **ask Geoff to look up the correct eBay category ID** by finding any live listing in that category on eBay and reading the category ID from the URL (e.g. `ebay.com/b/Sports-Trading-Card-Lots/261329/...`). Do NOT attempt to discover category IDs via API calls — that path is unreliable and wastes context. Once Geoff provides the ID, add it to the map and proceed.

**Save to checkpoint `metadata.data`:**
- `category` — human-readable label (e.g. `"Comics > Comic Books"`)
- `ebay_category_id` — string ID from map (e.g. `"259104"`)
- `ebay_condition_id` — string condition ID from map (e.g. `"4000"`)
- `condition` — human-readable condition label
- `price` — confirmed price (number)
- `min_offer` — floor at 75% default, round down to whole dollar
- `format` — `"Fixed Price"`
- `duration` — `"GTC"`
- `shipping` — shipping method description
- `returns` — return policy description
- `item_specifics` — key/value aspects object

**Also carry forward from gap_analysis:**
- `lot_id` — from gap_analysis data
- `lot_name` — human-readable, for display only

**Also derive the SKU at this phase:**
- Use the slug to build a human-readable SKU: `DW-<slug>` truncated to 50 chars
- Save as `sku` in `metadata.data`

> **TODO:** validate required aspects against live eBay category data via `GET https://dash.pond.duckwerks.com/api/ebay/aspects`.

### Phase 8 — Listing
Present final review: title, price, condition, key metadata, description preview.

User approves.

**Check for photos before posting:**
- Look for files in `docs/listing-sessions/<slug>/photos/` (jpg, jpeg, png)
- If the folder is empty or missing: tell the user, ask them to drop photos there and confirm before continuing. Do not post without at least one photo.
- If photos are present: read each file, base64-encode the contents, include in the payload as `{ filename, base64 }`

Write `docs/listing-sessions/<slug>/listing.md` — clean, sectioned, copy-paste ready. One fenced block per field (title, price, min offer, category, condition, duration, shipping, returns, item specifics, description, condition field).

**Then POST to `https://dash.pond.duckwerks.com/api/ebay/list-item`:**

Assemble payload from checkpoint phases `copy` + `metadata`:
```json
{
  "sku":             "<metadata.sku>",
  "title":           "<copy.title>",
  "description":     "<copy.description>",
  "conditionNotes":  "<copy.condition_field>",
  "price":           "<metadata.price>",
  "minOffer":        "<metadata.min_offer>",
  "ebayCategoryId":  "<metadata.ebay_category_id>",
  "ebayConditionId": "<metadata.ebay_condition_id>",
  "categoryLabel":   "<metadata.category>",
  "aspects":         "<metadata.item_specifics>",
  "lot_id":          "<metadata.lot_id>",
  "photos":          [{ "filename": "front.jpg", "base64": "<encoded>" }, ...]
}
```

On success: report the returned `listingId` and `url`. Update checkpoint `listing.data` with `{ file, listingId, url }`.

On error: show the error message and tell the user what to fix. Do not mark listing phase done until the POST succeeds.

## All API Calls Use

```
https://dash.pond.duckwerks.com
```

Local network only. NUC must be reachable. Use `https://dash.pond.duckwerks.com` — port 3000 is firewalled off-box, so the nginx vhost is the only path.
