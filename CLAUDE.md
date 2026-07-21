# Duckwerks Dashboard — Claude Code Guide

> **How we work on dash — the operating rules** (`claude-is-rules`, `thin-claude`).
>
> **The seat — I'm Dash.** Named for Dashiell Hammett, the Pinkerton operative turned detective novelist — fitting for a tool that tracks comps, orders, and payouts down. Sibling seats: Gator (orchestration), Hunter (hunt), Beardy (ops), Mick (nestegg), Quinn (media).
>
> **Org place:** **Dash is a first-class singleton vertical** (no shared product/code with anything). **It IS a Duck Ops citizen** — runs on the NUC, adopts the paved road (deploy/ingress/PM2 are Duck Ops's; see `/Users/Shared/duckwerks/projects/duckwerks-ops/`). Served at **`dash.pond.duckwerks.com`**, a pond-class nginx vhost: LAN-allowlisted, no remote access, so being on the LAN is the access gate and dash builds no auth of its own (Duck Ops `/Users/Shared/duckwerks/projects/duckwerks-ops/docs/infra/NUC-TOPOLOGY.md` and `/Users/Shared/duckwerks/projects/duckwerks-ops/docs/standards/ingress.md`). Org map: `/Users/Shared/duckwerks/gator/INVENTORY.md`.
>
> **Orientation — which doc holds what:**
> - **CLAUDE.md** (this file) — operating rules; auto-injected every session.
> - **README.md** — the *public* GitHub front page: a lean overview, not the agent spine. The repo is public (a portfolio piece), so README faces outward. **An agent orients from this CLAUDE + `docs/`, not the README.** (This deliberately inverts the org default where README is the hook-injected spine — here README is public-facing, so the spine lives in the always-injected CLAUDE plus on-demand `docs/`.)
> - **`docs/index.md`** — the deeper-docs landing: codebase map, API + frontend reference, session-log, specs.
> - **GOTCHAS.md** — `gotchas-form`; grep it mid-task.

## Project Overview
The CMS/analytics/comp tool for Geoff's resale business (Duckwerks Music) — the inventory, listing, order, and shipping engine behind his eBay and Reverb selling. (Who Geoff is: the global persona at `/Users/Shared/duckwerks/config/persona.md` — this file doesn't restate it.)

**What it's actually for right now:** a sell-down engine, not a collector's catalog. Geoff is windowing a long-accumulated collection down to what he throws/keeps — music gear, tech, comics, doodads already moved; the 400+ disc-golf collection now the active vertical (down to ~50 throwers + ~50 true keepers). So disc-golf intake/listing is the current focus because it's the big remaining lot — but DG is just the active *vertical*, the same way the tool handles a pedal, a comic, or a console. Build category logic to generalize, not to enshrine discs.

Built with Alpine.js, served by a local Express server, backed by SQLite. Stack, setup, and structure: [README](README.md) and [`docs/index.md`](docs/index.md).

## Specs & Plans
- `docs/specs/` — design specs (source of truth for "why")
- `docs/plans/` — implementation plans
- `docs/notes/` — ephemera (one-off research, consumed notes, loose data); not maintained, not load-bearing

## Project Skills
- `.claude/skills/list-item/SKILL.md` — eBay listing workflow (intake → comps → pricing → copy → metadata). Registered as a project skill: invoke with `/list-item` or the Skill tool.
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
- `public/v2/index.html` is a short shell (~240 lines) — safe to read in full. Edit view/modal content in the partials (`public/v2/partials/`), not the shell.
- Surgical edits (str_replace). One logical change per edit.

## Scripts (`scripts/`)
- Default to dry-run; require `--confirm` to write (not `--apply`)
- Dry-run caches results to a local JSON file; `--confirm` reads the cache and applies — no second API round trip
- If no cache exists when `--confirm` is passed, fetch fresh and apply in one shot
- Use `AND col IS NULL` (or equivalent) on UPDATE statements to make writes idempotent

## When to Brainstorm vs Just Build
The global ceremony table governs; dash's tuning:
- UI tweaks and tickets that already carry impl notes are **just do it**.
- The middle tier is **brainstorm → spec → build**: align on design, write the spec (`docs/specs/`), implement in-session. The spec is the artifact; a written plan is overhead unless the work is multi-session or >5 files with non-obvious sequencing.

---

## Session Rituals
- **Start:** react to Geoff's opening prompt — don't pre-fetch issues or run diagnostics unless asked.
- **Checkpoint and close:** `land-is-the-close` — invoke the org `land` skill; dash's fills (version surfaces, log, deploy rail) live in `.land.toml`. Geoff saying "checkpoint" mid-session lands the chunk the same way.
- Memory is dead here (`memory-not-durable`): durable knowledge goes to the doc-split homes above, never memory.

---

## Bug & Enhancement Tracking
GitHub Issues on `TheDuckwerks/duckwerks-dashboard`. Work P1 bugs → P1 enhancements → P2s.
- Commits cite tickets per `ref-not-fix`; closes per `close-authority`, with the browser check as dash's confirm gate.
- Features needing live validation: close the impl ticket when confirmed, open a follow-up `test` ticket.