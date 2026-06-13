# CLAUDE.md + Docs Review — Notes from the hunt project's Claude (Opus 4.8)

> Context: Geoff asked the apply-queue/hunt project's Claude to review this project's
> CLAUDE.md while we were working on architecture for that project. These are
> observations and options, not prescriptions — you own this codebase and you know
> the production realities I don't. Geoff mentioned he has a ticket to split the
> documentation into buildable parts; most of this feeds that. Take what's useful,
> discard what isn't, push back where I'm wrong about how this project actually runs.
>
> Written 2026-05-29.

---

## TL;DR

The CLAUDE.md is strong and visibly battle-scarred — the deploy gate, the stale-DB
warning, the `node -e` hang, the eBay metric gotcha are all lessons paid for in
broken sessions. Nothing here is "this is bad." It's "this is mature enough that the
next improvements are about *structure* and *guardrails*, not content." Three themes:

1. The doc does two jobs (operational rules + codebase map); the map half rots.
2. A couple of footguns are documented as prose to remember, not removed as hazards.
3. Some ceremonies overlap and will drift.

---

## 1. Split operational rules from the codebase map (feeds the doc-split ticket)

CLAUDE.md is ~12KB and holds both:
- **Operational rules** that change rarely and hurt a lot if wrong: deploy gate,
  NUC access, dev-vs-prod, data-op confirmation flow, gotchas, the superpowers
  decision table. **These belong in CLAUDE.md.**
- **The Key Files inventory** (lines ~67-110): a file-by-file map of `server/*.js`,
  frontend partials, etc. **This is the part that silently rots.** Every new router
  is a maintenance obligation here, and the moment one line is stale it actively
  misleads a cold session.

Rule of thumb worth considering: *CLAUDE.md should hold what changes rarely and is
expensive when wrong. A file inventory is the opposite — it changes often and a cold
session can regenerate most of it with `ls server/` + a grep.*

You've already half-applied this — full endpoint/schema/frontend docs live in
`docs/claude/api-reference.md` and `frontend-reference.md` (lines 109-110). The
suggestion is just to finish the move: push the Key Files inventory into those
reference docs too, and leave CLAUDE.md with a one-liner like "codebase map +
endpoint docs: `docs/claude/api-reference.md`." That makes CLAUDE.md the stable
operational core and the reference docs the regenerable map — which is exactly the
"buildable from parts" shape the ticket is after.

**If you want a buildable-docs structure, a clean split might be:**
- `CLAUDE.md` — operational rules, workflows, gotchas, decision table, session
  protocols. The stuff a session must internalize.
- `docs/claude/api-reference.md` — endpoints, env vars, schema. (exists)
- `docs/claude/frontend-reference.md` — Alpine architecture, modal pattern,
  component map. (exists)
- `docs/claude/codebase-map.md` — the Key Files inventory, moved out of CLAUDE.md.
  Cheap to regenerate, OK if it drifts a little because it's not load-bearing.
- A tiny build/check step (even a script) that flags when `server/*.js` files exist
  that the map doesn't mention — turns "did the map rot" into a command, not a vibe.

---

## 2. Footguns to convert from documented → unreachable

The strongest pattern from the hunt-project session today: *make the right way the
only easy way; don't document the wrong way and hope it's remembered.* Two candidates
here:

**a) `node -e` + better-sqlite3 hang (line 52).** Right now it's a prose warning:
"never `node -e` inline scripts (better-sqlite3 never calls db.close(), so the
process hangs)." That relies on every session reading and remembering it. Consider a
sanctioned wrapper so the footgun isn't reachable:
- a tiny `scripts/db.sh '<sql>'` that runs `sqlite3` against the canonical NUC DB
  path with the right flags, OR
- a documented one-line `sqlite3` pattern that is explicitly "the only blessed way to
  poke the DB ad hoc."
Either way the rule becomes "use `scripts/db.sh`" (positive, enforceable) instead of
"don't use node -e" (negative, must-remember). Same logic as extracting an audit to a
script instead of trusting inline greps.

**b) Local DB is stale and "must never be queried" (line 41).** This is currently a
warning a session has to honor by discipline. If it's genuinely never the source of
truth, consider making it *structurally* hard to hit by accident — e.g. the db helper
refusing to open the local path unless an explicit `--local` flag is set, or the
local file simply not existing in a fresh checkout (gitignored + not created by
setup). The goal: a session physically can't query stale data without opting in,
rather than relying on reading the warning first.

(Both of these are "nice to have," not urgent — they're the kind of cleanup that pays
off the next time a session forgets the prose rule.)

---

## 3. Overlapping ceremonies that will drift

**Checkpoint Protocol** (line ~173) and **Session Close** (line ~181) are nearly
identical 5-6 step lists (bump version, update session-log, commit, push, deploy).
Right now if you change the deploy step you have to remember to change it in both
places. Consider factoring the shared steps into one "Ship Procedure" block that both
Checkpoint and Session Close reference ("run the Ship Procedure, plus update
CLAUDE.md"). Minor, but it's exactly the kind of duplication that silently diverges.

Same idea, smaller: the deploy sequence (push → `deploy-nuc.sh` → confirm restart)
appears in the dev-vs-prod section, the checkpoint protocol, and session close. One
canonical "Ship Procedure" referenced from all three keeps it honest.

---

## What's genuinely excellent (keep, don't touch)

- **The deploy gate** (line 58): "A commit alone is invisible to Geoff. Do not tell
  Geoff to check anything until deploy-nuc.sh confirmed the restart." This is a hard
  gate encoding a real failure mode. It's the single best rule in the file. The
  hunt project is going to borrow the *principle* (don't claim done until the
  verifiable end-state is confirmed).
- **The "When to Use Superpowers Workflow" decision table** (line ~145). This is the
  best anti-overkill mechanism I've seen in a CLAUDE.md — it tells Claude when NOT to
  ceremony. Hunt project is lifting this table directly (credited).
- **"Working on Files"** read-discipline (line 115): "under ~150 lines read full,
  larger grep-first." This is the context-efficiency rule that keeps sessions cheap.
  Already correct.
- **NUC = single source of truth** framing. Same family as "durable state on disk,
  pass references not payloads" — you arrived at it from production pain, which is
  the more convincing direction.

---

## Meta note for whoever picks this up

This guide is *more mature* than the hunt project's, and the reason is instructive:
it's been under production pressure and the hunt one hasn't. Every scar rule here was
paid for in a broken session. So weight my structural suggestions accordingly — I'm
proposing reorganization and guardrails, but the *content* of your rules reflects
realities I haven't lived in this codebase. Where a suggestion conflicts with how
production actually behaves, production wins.
