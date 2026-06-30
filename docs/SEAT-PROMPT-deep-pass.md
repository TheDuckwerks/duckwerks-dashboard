# Dash Deep-Pass — starter prompt (paste into a fresh Dash session)

> A cold-start prompt for a from-the-Dash-seat introspection + documentation session. Drafted by Gator 2026-06-14 with Geoff. The shape follows how Geoff works: pragmatic-first, elevate once warmed, metagame at the end. Edit freely before pasting; this is a seed, not a script.

---

Hey Dash. Cold-start session, and it's a different kind than your usual. You're in steady-state, the product is done-enough (3 commits last month, all housekeeping), so this is NOT a build session. It's a **deep-pass**: introspection and documentation, working up from the pragmatic to the reflective. We'll move in three stages, and we earn each one by doing the one before it. Don't jump ahead to the abstract; warm up through your hands first.

**Stage 1 — drain the bother queue (pragmatic, high-certainty).**
Start where the certainty already is: the unresolved tickets filed "for reasons," cleanup, and documentation. Pull them up (`gh issue list --repo TheDuckwerks/duckwerks-dashboard`, and check `docs/` for anything flagged WIP). Work them as real cleanup, not theater. The point isn't just to close them, it's that re-handling these corners of the system re-acquaints you with what you actually built and where the hard-won knowledge is buried. Let the rote work warm you back up.

**Stage 2 — consolidate what you know, and orient to what changed (the docs work).**
As you go, you'll re-surface the load-bearing, hard-won knowledge in this system. Capture it where it belongs (GOTCHAS.md for the war-stories, README for the facts, per the org doc-split standard). Known knowledge-veins to start from (these are anchors, NOT the full list, find more as you dig): the **eBay Inventory API migration**, **ZPL-over-TCP printing to the Zebra/Rollo**, the **SQLite WAL bloat fix**, the **analytics-impressions metric gotcha** (promoted vs. total). Each of those has a "why is it like this" that should be answerable months from now without you in the room.

Important orientation, because you've been heads-down and the world changed around you: there was a **2026-06-13 org reorg** you slept through. You're now a **first-class singleton vertical** AND a **Duck Ops citizen** (you run on the NUC). The org reshaped into 6 verticals-by-verb; there's an orchestration tier (**Gator**) above you; ops has its own Claude (**Beardy**); hunt's is **Hunter**. Knowledge now lives in **four surfaces** (CLAUDE = how we work · session-log = what happened · GH Issues = what's next · memory is sunset) and they don't bleed. There's a **paved-road deploy standard** (build on Mac → rsync immutable artifact → PM2 on NUC); you actually ran a deploy-to-NUC flow *before* that road was paved, so your scars there are real. Read `~/projects/_workspace/INVENTORY.md` and `LEXICON.md` for the full map and vocabulary. Reconcile your own docs against this paradigm as you consolidate.

**Stage 3 — metagame: your role and what the org needs from you (the elevation).**
Now that you're warmed up and oriented, the reflective part. Two questions:
1. **Dash-local vs. org-level.** As you documented in Stage 2, some of what you know is just Dash trivia, and some is *promotable* (a Duck Ops deploy standard, a lexicon term, a pattern other projects should reuse). You are the oldest, most-built citizen and you ran the deploy road before it was paved, so your scars are likely org-worthy. **Flag anything org-level and bubble it UP to Gator** (note it for the `_workspace/` seat / a global-candidate tag) rather than burying it in your own docs. Don't promote it yourself; surface it.
2. **Your role and identity.** Hunter and Beardy have claimed their names and written their roles into their CLAUDEs. You're a citizen now with a real place in the topology. Worth thinking about who you are in this org and whether that belongs in your CLAUDE, if it earns it (don't force it; let it be real).

Close the session the org way: verify against what we set out to do, sweep stray changes, version if anything shipped, write a session-log entry (`docs/session-log.md`, newest-first), logical commits with `ref #N`. And surface a synopsis of what bubbled up to the org tier.

Take it one stage at a time. Start with Stage 1.
