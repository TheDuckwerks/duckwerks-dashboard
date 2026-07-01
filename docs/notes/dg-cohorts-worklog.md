# DG Sell-Down: Cohorts & Fixes (working doc)

> Working analysis, not load-bearing. The anchor for the "why aren't the last discs
> moving, and what do we change" pass. We gather cohorts here, then wrap around and
> decide holistically. A single listing can sit in several cohorts and need several
> edits at once, so fixes are assigned per-listing at the end, not per-cohort.
>
> Snapshot: 94 active DG eBay listings. Traffic = eBay Sell Analytics, 30-day window,
> pulled 2026-06-30. Field/comp data = SerpAPI eBay engine (active needs `LH_BIN=1`).

## The reframe (why "not selling" has two different causes)

"Not selling" wears two costumes, and price only fixes one:

1. **Which searches you appear in** (keyword capture). If the words a buyer types aren't
   in your title, you're invisible to that search regardless of price or seller rating.
2. **Where you rank within a search** (Best Match). You appear, but on page 2+, which is
   the dead zone. Driven by sales velocity and promoted-listing bids, not title text.

Traffic backs it: 94 listings drew 94,346 impressions but 479 views in 30 days. Most of
that impression volume is low-intent browse/carousel placement, not search. 24 listings
got literally zero views; the broader stalled tail (<=5 views) is 68.

## Cohorts

### C1 - Priced-out (seen, passed over)
- **Who:** listings pulling real views but no sale. Skews Innova/Discraft (mainstream,
  genuine search traffic).
- **Evidence:** buyers reach the page and leave. Avg ask on the remaining tail is $18.20;
  June actually cleared at $13.09. Real search demand, price is the friction.
- **Fix (lever: price):** targeted cut toward sold-comp, per disc. Not a blanket %.
- **Data status:** scan shows C1 is NARROWER than assumed. Only discs that get views AND
  sit above comp qualify (sample: Meteor ESP $25 vs $17, Time-Lapse $26 vs $17). Many
  tail discs are already at/below comp, so they are NOT C1. Confirm per-disc before cutting.

### C2 - Keyword-gap (invisible to parent-brand search)
- **Who:** 26 Axiom/Streamline listings. Axiom and Streamline are MVP's sub-brands.
- **Evidence:** 0 of 26 carry "MVP" in the title; 0 of all 94 carry "disc golf". Titles
  average 44 chars against eBay's 80 cap (~36 chars of unused keyword space). Manual
  search confirmed: for "axiom time lapse" the listing sits halfway down page 2, and the
  competitor directly below stuffs "MVP Disc Golf" onto an Axiom disc. Field scan shows
  competitors routinely title "MVP Axiom ... Disc golf".
- **Fix (lever: title keywords):** teach the title builder (`ebay-builders.js`) to prefix
  the parent brand for Axiom/Streamline and append "Disc Golf", then bulk-update
  regenerates all titles. Generalizes; dry-run previews before ship. Low risk (adding
  words into headroom, no price/spec change).
- **Data status:** high confidence. OPEN DECISION: title format/word order (Geoff's call).

### C3 - Rank-buried (page 2+ on their own molds)
- **Who:** listings that appear in the right search but below the page-1 fold.
- **Evidence:** the Time-Lapse manual search (present, but page 2 = ~0 real views).
- **Fix (lever: promote/velocity):** promoted-listing bid to buy page-1 placement, or
  earn velocity. Costs money or momentum. Partially helped by C2 (better keyword
  relevance can lift rank), but rank is its own battle.
- **Data status:** lower certainty. Sponsored density not measurable via SerpAPI; needs
  manual spot-checks per mold.

### C4 - Duplicates self-competing
- **Who:** same mold listed multiple times. Confirmed within MVP-family: Time-Lapse x3,
  Pixel x3, views split near-zero across each group.
- **Evidence:** eBay demotes duplicate listings; the copies compete with each other.
- **Fix (lever: consolidate):** collapse to one listing (quantity N) or bundle/lot the
  copies; end the extras.
- **Data status:** full-set duplicate scan still pending (only MVP-family checked so far).

### C5 - Buried in a crowded field (NOT thin demand - corrected by scan)
- **Who:** plain MVP-family molds (Wave, Relay, Range, plain Neutron/Proton colorways).
  MVP-family = 39 of 94 listings, 3.5 views/listing vs Innova's 5.6; holds 14 of 24
  zero-view discs.
- **Evidence + correction:** the original "thin demand / low search volume" label was
  wrong for the plain molds. The scan shows these fields are CROWDED and ACTIVE: Wave 58
  active / 63 sold, Range 60 / 72, Time-Lapse 166 / 51. Demand exists; Geoff is invisible
  in it, priced at/below comp with zero views. So this is a discovery/crowding problem,
  which collapses C5 toward C2 (keywords) + C3 (rank), not a price or demand problem.
  A genuinely-thin subset may still exist for the rare protos (first-run, dye-blank
  variants few people search), but the plain molds are not it.
- **Fix (levers, in order):** (1) keyword capture (C2) so you appear in the field's
  searches at all; (2) rank (C3) via promote/velocity; (3) OR sidestep the crowded single
  market entirely by lotting plain leftovers into a searchable "MVP disc lot" / leaning on
  the buy-2-get-15% for the MVP loyalist already in the store. Price is not a C5 lever.
- **Data status:** confirmed by the 8-mold scan. Rare-proto thin subset still unverified.

## Field scan findings - 8-mold sample (2026-06-30)

SerpAPI active (`LH_BIN=1`) + sold, lots/bundles filtered, single-disc price band $3-200.

| Mold | My $ | Views | Active n/med | Sold med | Read |
|---|---|---|---|---|---|
| Innova TeeBird Champion | 18 | 7 | 60 / 20 | 20 | in-band, crowded |
| Discraft Zone ESP | 18 | 23 | 59 / 19 | 20 | priced right, real interest |
| Discraft Meteor ESP | 25 | 15 | 60 / 17 | 18 | **overpriced -> real cut** |
| Innova TeeBird Halo | 18 | 10 | (no active parse) | 22 | *under* market |
| Axiom Time-Lapse Neutron | 26 | 3 | (no active parse) | 17 | **overpriced -> real cut** |
| MVP Wave Proton | 19 | 0 | 58 / 22 | 21 | at/below comp, invisible |
| Streamline Range Neutron | 19 | 0 | 60 / 18 | 24 | at/below comp, invisible |
| MVP Relay Neutron | 18 | 0 | (no active parse) | 17 | priced right, invisible |

**Premise flip:** the zero-view MVP discs (Wave, Range, Relay) are priced at or below
market median and still pull zero views. Price is NOT their problem; cutting donates
margin to an empty room. Their lever is keywords/rank (C2/C3), not price. The genuine
price cuts are only 2 of 8 (Meteor $25 vs $17 comp; Time-Lapse $26 vs $17), both of which
get views AND sit above comp.

**Structural:** every mold's active field is maxed (58-60, SerpAPI's page cap). Deep,
saturated commodity fields for everything. Supports the "crowded out by other stores"
read. Winning here is keyword match + rank + velocity, not just price.

**Data gap:** 3 molds returned no active parse (query-wording sensitivity: "Axiom
Time-Lapse Neutron" whiffed, "MVP Time-Lapse" pulled 166). Re-query those with cleaner
brand-family terms before finalizing.

## Overlap is the point (per-listing union of fixes)

Cohorts are diagnostic buckets, not assignments. One listing stacks fixes. Example:
**Axiom Time-Lapse Neutron** = C2 (no "MVP" in title) + C3 (page 2) + C4 (3 copies) +
C5 (proto/jargon). Its union-of-fixes: consolidate the 3 copies -> one clean listing with
MVP + Disc Golf keywords -> then decide promote vs bundle. That is four cohorts, one disc,
one consolidated edit.

## Data still to gather

- [ ] Sold comps per C1 disc (set price-cut targets)
- [ ] Field scan across a sample per cohort: competition depth + price position (C1/C5)
- [ ] Full-set duplicate scan (C4, beyond MVP-family)
- [ ] Manual sponsored-density spot-checks on a few molds (C3)

## Open decisions (Geoff's calls, deferred to the holistic wrap)

- Title format/word order for the C2 keyword fix
- How aggressive on C1 price cuts (toward comp vs toward June's $13 clear)
- Bundle/lot vs let-it-ride for the C5 niche tail
- Whether to consolidate C4 duplicates to quantity or lot them
