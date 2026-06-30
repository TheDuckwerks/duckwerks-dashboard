# Duckwerks Dashboard — Claude Code Guide

> **How we work on dash — the operating rules.** Keep this file thin; depth lives in the docs it points to. Update it when a *rule* changes.
>
> **Org place:** **Dash is a first-class singleton vertical** (no shared product/code with anything). **It IS a Duck Ops citizen** — runs on the NUC, adopts the paved road (deploy/ingress/PM2 are Duck Ops's; see `/Users/Shared/duckwerks/projects/duckwerks-ops/`). Currently gated by Cloudflare Zero Trust *because dash has no auth of its own* — the standing dependency: **dash building its own auth** unblocks the org-wide move off Cloudflare (see Duck Ops's `NUC-TOPOLOGY.md`). Org map: `/Users/Shared/duckwerks/gator/INVENTORY.md`.
>
> **Orientation — which doc holds what:**
> - **CLAUDE.md** (this file) — operating rules. Auto-injected every session. Points to the docs below; doesn't restate them.
> - **README.md** — the *public* GitHub front page: a lean overview, not the agent spine. The repo is public (a portfolio piece), so README faces outward. **An agent orients from this CLAUDE + `docs/`, not the README.** (This deliberately inverts the org default where README is the hook-injected spine — here README is public-facing, so the spine lives in the always-injected CLAUDE plus on-demand `docs/`.)
> - **`docs/index.md`** — the deeper-docs landing: codebase map, API + frontend reference, session-log, specs.
> - **GOTCHAS.md** — dated war-stories by subsystem. Grep mid-task; don't read cover-to-cover.

## Project Overview
The CMS/analytics/comp tool for Geoff's resale business (Duckwerks Music) — the inventory, listing, order, and shipping engine behind his eBay and Reverb selling. (Who Geoff is: the global persona at `/Users/Shared/duckwerks/config/persona.md` — this file doesn't restate it.)

**What it's actually for right now:** a sell-down engine, not a collector's catalog. Geoff is windowing a long-accumulated collection down to what he throws/keeps — music gear, tech, comics, doodads already moved; the 400+ disc-golf collection now the active vertical (down to ~50 throwers + ~50 true keepers). So disc-golf intake/listing is the current focus because it's the big remaining lot — but DG is just the active *vertical*, the same way the tool handles a pedal, a comic, or a console. Build category logic to generalize, not to enshrine discs.

Built with Alpine.js, served by a local Express server, backed by SQLite. Stack, setup, and structure: [README](README.md) and [`docs/index.md`](docs/index.md).

## Specs & Plans
- `docs/specs/` — design specs (source of truth for "why")
- `docs/plans/` — implementation plans
- `docs/notes/` — ephemera (one-off research, consumed notes, loose data); not maintained, not load-bearing

## Project Skills
- `.claude/skills/list-item/SKILL.md` — eBay listing workflow (intake → comps → pricing → copy → metadata). Invoke by saying "use the list-item skill". Not registered via superpowers — read directly.
- Session files live in `docs/listing-sessions/<slug>/` (checkpoint.json, comps.txt, listing.md)

## The NUC

The production server is an Intel NUC at `fedora.local`. Claude has SSH access and should use it directly.

- **SSH:** `ssh geoff@fedora.local`
- **Project path:** `/home/geoff/projects/duckwerksdash`
- **Database:** `/home/geoff/projects/duckwerksdash/data/duckwerks.db` — this is the source of truth. The local `data/duckwerks.db` is stale and useless. Never query it.
- **Scripts that touch the DB must run on the NUC**, not locally. SSH in and run them there.

## Direct Data Operations

When making data changes — bulk or otherwise — the default flow is:
1. Show the rows that will be affected (SELECT first)
2. State what the UPDATE will do and wait for confirmation
3. Execute, then verify

**Use the API routes** when a route exists and the change is small (one or a few records).  
**Use `scripts/db.sh "<sql>"`** for bulk updates, migrations, or when no route fits — it runs the sqlite3 CLI against the NUC db (the source of truth). Never `node -e` (better-sqlite3 never closes the handle, so the process hangs — see GOTCHAS).

If the right approach isn't clear, sort it out before running anything. This applies even when bypass permissions are on — production data changes always get a confirmation step.

## Dev vs Production

> **⚠️ DEPLOY IS IN TRANSITION (org reorg).** The git-pull-based `deploy-nuc.sh` flow below is the **current** mechanism but it's being **retired** — Duck Ops is building the org-wide rsync-artifact deploy standard (build on Mac → rsync immutable artifact → PM2; no git on the NUC). Dash will get a migration spec from Duck Ops when the standard is ready (Duck Ops `duckwerks-ops` issues #3/#4). **Until then:** the old flow still works, keep using it for now — but do NOT entrench it / build new tooling around `deploy-nuc.sh`, and expect it to change. (Dash's next real deploy change = the Duck Ops reconcile + re-release.)

> **Every commit must be followed immediately by `git push origin main` and `bash scripts/deploy-nuc.sh`. A commit alone is invisible to Geoff. Do not tell Geoff to check anything until deploy-nuc.sh has confirmed the restart.**

- **Default: ship to production.** Fix it, commit, push, deploy, tell Geoff to refresh `dash.duckwerks.com`. That is the normal flow for every bug fix, tweak, and feature.
- **Local dev only for huge projects** — multi-session rewrites, schema migrations, new API integrations. In those cases: use `localhost:3000` (`npm start`), commit less, hold pushes until a natural milestone.
- **Never tell Geoff to refresh `localhost:3000`** unless you're explicitly in a local dev session together.
- **Deploying:** push to origin, then `bash scripts/deploy-nuc.sh`.

---

## Key Files
- File-by-file roles (server + frontend): [`docs/claude/codebase-map.md`](docs/claude/codebase-map.md)
- Endpoints + env vars + schema: [`docs/claude/api-reference.md`](docs/claude/api-reference.md)
- Alpine architecture + modal patterns: [`docs/claude/frontend-reference.md`](docs/claude/frontend-reference.md)

---

## Working on Files
- JS files under ~150 lines: read in full. Larger: grep first, targeted read only.
- `index.html` is a short shell (~235 lines) — safe to read in full. Edit view/modal content in the partials, not the shell.
- Surgical edits (str_replace). One logical change per edit.
- Never guess at API shapes — ask for the spec or docs before writing any call.

## Scripts (`scripts/`)
- Default to dry-run; require `--confirm` to write (not `--apply`)
- Dry-run caches results to a local JSON file; `--confirm` reads the cache and applies — no second API round trip
- If no cache exists when `--confirm` is passed, fetch fresh and apply in one shot
- Use `AND col IS NULL` (or equivalent) on UPDATE statements to make writes idempotent

## When to Brainstorm vs Just Build

| Signal | Approach |
|---|---|
| Single file, obvious change | Just do it |
| Known bug, root cause clear | Just do it |
| UI tweak (font, color, layout) | Just do it |
| Clear requirements, 2–3 files | Just do it |
| Ticket already has impl notes | Just do it |
| New data flow or API integration | Brainstorm → spec → build |
| Multiple files with shared state | Brainstorm → spec → build |
| Requirements fuzzy or design unclear | Brainstorm → spec → build |
| Multi-session work, or >5 files with non-obvious sequencing | Brainstorm → spec → written plan → build |

**"Brainstorm → spec → build"** means: align on design, write the spec (`docs/specs/`), then implement directly in-session without a written task plan. The spec is the artifact; the plan is overhead unless the work spans sessions or has tricky sequencing.

---

## Versioning
- `public/v2/js/config.js` → `APP_VERSION` constant (shown in sidebar)
- `package.json` → `version` field
- Bump patch at end of every session that ships something.
- Tag minor/major versions only — no tags per patch.

---

## Ship Procedure
The deploy sequence, referenced by both checkpoint and close:
1. Bump patch version in `config.js` + `package.json` (if something shipped)
2. Update `docs/session-log.md`
3. Commit with ticket refs (`ref #N`)
4. `git push origin main`
5. `bash scripts/deploy-nuc.sh` — deploy to production

## Session Start
1. Read this CLAUDE.md
2. React to Geoff's opening prompt — don't pre-fetch issues or run diagnostics unless asked

## Checkpoint
Geoff says "checkpoint" → run the **Ship Procedure**.

## Session Close
Run the **Ship Procedure**, plus: update this CLAUDE.md if a *rule* changed, and tell Geoff what changed in CLAUDE.md + session-log.md (one line each).

**Where knowledge goes (four surfaces — memory is sunset).** Don't use memory; it's dead org-wide (see global `/Users/Shared/duckwerks/config/CLAUDE.md`). Durable knowledge lives in one of: **README** (lean public overview), **`docs/`** (technical facts — stack, schema, file roles, reference), **GOTCHAS.md** (dated war-stories by subsystem), this **CLAUDE.md** (how we work — operating rules only), or the **tracker** (GH Issues — backlog). Keep this CLAUDE thin: it points to the others, it doesn't restate them. Cross-project behavioral preferences and who-Geoff-is live in the global layer, not here.

---

## Bug & Enhancement Tracking
GitHub Issues on `TheDuckwerks/duckwerksdash`.
- **Reference issues in commits** with `ref #N` — never `fix #N` or `closes #N` (auto-closes)
- **Never close issues** — only Geoff closes after confirming in browser
- Work P1 bugs → P1 enhancements → P2s
- For features needing live validation: close impl ticket when confirmed, open follow-up `test` ticket

---

## Session Log
Full log: [`docs/session-log.md`](docs/session-log.md) — update at end of every session.