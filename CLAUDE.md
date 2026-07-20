# Duckwerks Dashboard — Claude Code Guide

> **How we work on dash — the operating rules.** Keep this file thin; depth lives in the docs it points to. Update it when a *rule* changes.
>
> **The seat — I'm Dash.** Named for Dashiell Hammett, the Pinkerton operative turned detective novelist — fitting for a tool that tracks comps, orders, and payouts down. Sibling seats: Gator (orchestration), Hunter (hunt), Beardy (ops).
>
> **Org place:** **Dash is a first-class singleton vertical** (no shared product/code with anything). **It IS a Duck Ops citizen** — runs on the NUC, adopts the paved road (deploy/ingress/PM2 are Duck Ops's; see `/Users/Shared/duckwerks/projects/duckwerks-ops/`). Served at **`dash.pond.duckwerks.com`**, a pond-class nginx vhost: LAN-allowlisted, no remote access, so being on the LAN is the access gate and dash builds no auth of its own (Duck Ops `NUC-TOPOLOGY.md` / `standards/ingress.md`). Org map: `/Users/Shared/duckwerks/gator/INVENTORY.md`.
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

- **SSH:** `ssh duckops@fedora.local` — duckops is the NUC's operating principal (owns `/srv`, pm2, the db); `geoff@` is the human's rescue account, not the ops rail.
- **App (live):** `/srv/duckwerks/dash/current` — the active release (PM2 `duckwerks`, fork, `:3000`). Releases live under `/srv/duckwerks/dash/releases/<ts>/`; `current` symlinks the live one.
- **Database:** `/srv/duckwerks/dash/data/duckwerks.db` — the source of truth (persistent dir, symlinked into each release). The local `data/duckwerks.db` is stale and useless. Never query it. Use `scripts/db.sh`, which targets it.
- The old checkout `/home/geoff/projects/duckwerksdash` is a **retired fallback** — runs nothing; don't deploy or query there.

## Direct Data Operations

When making data changes — bulk or otherwise — the default flow is:
1. Show the rows that will be affected (SELECT first)
2. State what the UPDATE will do and wait for confirmation
3. Execute, then verify

**Use the API routes** when a route exists and the change is small (one or a few records).  
**Use `scripts/db.sh "<sql>"`** for bulk updates, migrations, or when no route fits — it runs the sqlite3 CLI against the NUC db (the source of truth). Never `node -e` (better-sqlite3 never closes the handle, so the process hangs — see GOTCHAS).

If the right approach isn't clear, sort it out before running anything. This applies even when bypass permissions are on — production data changes always get a confirmation step.

## Dev vs Production

Deploy is the Duck Ops node-app rail: `/Users/Shared/duckwerks/projects/duckwerks-ops/infra-scripts/ship duckwerks` — gitignore-filtered rsync to a timestamped release, `npm ci --omit=dev` on the NUC, write-roots symlinked in, atomic swap, PM2 reload, health check. Ops owns the rail; dash owns `ecosystem.config.js` (which process, which script, which env). Details: [`docs/deploy.md`](docs/deploy.md).

> **The rail refuses a dirty tree (no override), so the flow is commit → ship.** A deploy always reflects a commit; there is no ship-the-working-tree-to-test path. `npm ci` on the NUC rebuilds node_modules from the lockfile (that target-build is why the native `better-sqlite3` binary is correct, and why node_modules is never shipped). Push is history + GitHub backup and never touches the deploy. Don't tell Geoff to check anything until the health check passes.

> **Code swaps, state persists.** Each deploy replaces the release dir; runtime writes must land in a declared write-root or they vanish on the next deploy. Dash's write-roots are declared in Ops's `substrate.ini` (`roots = data public/dg-photos`, plus `.env`): the model links them into each release, and the backup guard covers them. **Adding a new runtime write path means a new `roots` entry in the model** — an ask to Duck Ops, not a script edit. Undeclared = unlinked and unbacked.

- **Default: ship to production.** Fix it → commit → `ship duckwerks` → tell Geoff to refresh `dash.pond.duckwerks.com` and verify. Commits stay small and honest since each deploy rides one; the health check gates the "go look" every time.
- **Local dev only for huge projects** — multi-session rewrites, schema migrations, new API integrations. Use `localhost:3000` (`npm start`), hold deploys until a milestone.
- **Never tell Geoff to refresh `localhost:3000`** unless you're explicitly in a local dev session together.
- **Rollback** is a pointer swap: repoint `current` at a prior release + `pm2 reload duckwerks` (5 releases kept). See deploy.md.

---

## Key Files
- File-by-file roles (server + frontend): [`docs/claude/codebase-map.md`](docs/claude/codebase-map.md) — **eBay logic is split across `ebay.js` / `ebay-client.js` / `ebay-listings.js` / `ebay-builders.js`; grepping one file misses the rest. The full mint-and-edit path (price/title/description write) is `bulk-update` + `update-item` in `ebay-listings.js`, via `updateOffer`/`upsertOffer`/`publishOffer` in `ebay-client.js`.**
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
The **finalize** sequence, referenced by both checkpoint and close.
1. Bump patch version in `config.js` + `package.json` (if something shipped)
2. Update `docs/session-log.md`
3. Commit with ticket refs (`ref #N`)
4. `git push origin main`
5. `ship duckwerks` (Ops rail; see `docs/deploy.md`) — deploy to production

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