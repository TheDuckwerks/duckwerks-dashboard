# Duckwerks Dashboard — the spine

The read-first orientation doc for anyone working on dash, the SessionStart hook points a cold session at (declared as `spine` in `.land.toml`). The [README](../README.md) is the public GitHub front page and faces outward; this faces the work. Rules for how we work here live in [AGENTS.md](../AGENTS.md); this holds the facts.

## What it is

The CMS/analytics/comp tool behind Duckwerks Music — the inventory, listing, order, and shipping engine for Geoff's eBay and Reverb selling. Alpine.js frontend, Express server, SQLite.

**What it's for right now:** a sell-down engine, not a collector's catalog. Geoff is windowing a long-accumulated collection down to what he keeps — music gear, tech, comics, doodads already moved; the 400+ disc-golf collection is the active vertical (down to ~50 throwers + ~50 true keepers). Disc golf is the current *focus*, not the shape of the tool: it handles a pedal, a comic, or a console the same way. Build category logic to generalize, never to enshrine discs.

## Stack

**Alpine.js** frontend (a ~240-line shell plus partials), **Express** server, **SQLite** via
`better-sqlite3`, Node 22. Production is **MCA** at `mca.lan` under **PM2**, shipped on Duck
Ops's node-app rail. eBay and Reverb are the external surfaces.

## Commands

```sh
/Users/Shared/duckwerks/projects/duckwerks-ops/infra-scripts/ship duckwerks   # the default
npm start                       # local dev on :3000 -- big projects only
scripts/db.sh "<sql>"           # the box's db; never node -e, it hangs
pm2 reload duckwerks            # after a rollback pointer swap
```

**Default is ship to production**: fix, commit, ship, then tell Geoff to refresh
`dash.pond.duckwerks.com`. The rail refuses a dirty tree, so a deploy always reflects a
commit. Don't tell him to look until the health check passes.

## Where to look

- **File-by-file roles:** [`claude/codebase-map.md`](claude/codebase-map.md) ·
  **endpoints, env, schema:** [`claude/api-reference.md`](claude/api-reference.md) ·
  **Alpine architecture:** [`claude/frontend-reference.md`](claude/frontend-reference.md)
- [**GOTCHAS**](../GOTCHAS.md) — dated war-stories; grep mid-task.
- [**Deploy**](deploy.md) — the full release procedure. [**Session log**](session-log.md) ·
  [**Specs**](specs/) · [**Plans**](plans/).

## Where the code is

- **File-by-file roles** (server + frontend): [`claude/codebase-map.md`](claude/codebase-map.md)
- **Endpoints, env vars, schema:** [`claude/api-reference.md`](claude/api-reference.md)
- **Alpine architecture, store, modal patterns:** [`claude/frontend-reference.md`](claude/frontend-reference.md)

**eBay logic is split across `ebay.js` / `ebay-client.js` / `ebay-listings.js` / `ebay-builders.js` — grepping one file misses the rest.** The full mint-and-edit path (price/title/description write) is `bulk-update` + `update-item` in `ebay-listings.js`, via `updateOffer` / `upsertOffer` / `publishOffer` in `ebay-client.js`.

`public/v2/index.html` is a short shell (~240 lines). View and modal content lives in the partials (`public/v2/partials/`), not the shell.

## The box

Production is MCA at `mca.lan`, the org's substrate host. Agents have SSH access and use it directly.

- **SSH:** `ssh duckops@mca.lan` — duckops is the box's operating principal (owns `/srv`, pm2, the db); `geoff@` is the human's rescue account, not the ops rail.
- **App (live):** `/srv/duckwerks/dash/current` — the active release (PM2 `duckwerks`, fork, `:3000`). Releases live under `/srv/duckwerks/dash/releases/<ts>/`; `current` symlinks the live one.
- **Database:** `/srv/duckwerks/dash/data/duckwerks.db` is the source of truth (persistent dir, symlinked into each release). The local `data/duckwerks.db` is stale and useless — never query it. Use `scripts/db.sh`, which targets the real one.

Served at **`dash.pond.duckwerks.com`**, a pond-class nginx vhost: LAN-allowlisted, no remote access. Being on the LAN is the access gate, so dash builds no auth of its own. Ops owns the box and the paved road: [substrate topology](/Users/Shared/duckwerks/projects/duckwerks-ops/docs/infra/SUBSTRATE-TOPOLOGY.md), [ingress](/Users/Shared/duckwerks/projects/duckwerks-ops/docs/standards/ingress.md).

## Deploy

The Duck Ops node-app rail: `/Users/Shared/duckwerks/projects/duckwerks-ops/infra-scripts/ship duckwerks` — gitignore-filtered rsync to a timestamped release, `npm ci --omit=dev` on the box, write-roots symlinked in, atomic swap, PM2 reload, health check. Ops owns the rail; dash owns `ecosystem.config.js` (which process, which script, which env). Full procedure: [`deploy.md`](deploy.md).

**The rail refuses a dirty tree (no override), so the flow is commit → ship.** A deploy always reflects a commit; there is no ship-the-working-tree-to-test path. `npm ci` on the box rebuilds node_modules from the lockfile, which is why the native `better-sqlite3` binary comes out correct and why node_modules is never shipped. Push is history and GitHub backup; it never touches the deploy.

**Code swaps, state persists.** Each deploy replaces the release dir, so runtime writes must land in a declared write-root or they vanish on the next one. Dash's write-roots are declared in Ops's `substrate.ini` (`roots = data public/dg-photos`, plus `.env`): the model links them into each release and the backup guard covers them. A new runtime write path means a new `roots` entry in the model — an ask to Duck Ops, not a script edit. Undeclared means unlinked and unbacked.

**Rollback** is a pointer swap: repoint `current` at a prior release, `pm2 reload duckwerks` (5 releases kept).

## Running it

- **Default is ship to production.** Fix → commit → `ship duckwerks` → tell Geoff to refresh `dash.pond.duckwerks.com` and verify. Commits stay small and honest since each deploy rides one, and the health check gates the "go look" every time. Don't tell Geoff to check anything until it passes.
- **Local dev is for huge projects only** — multi-session rewrites, schema migrations, new API integrations. `npm start` on `localhost:3000`, holding deploys until a milestone.
- **Never tell Geoff to refresh `localhost:3000`** unless you're explicitly in a local dev session together.

## Scripts (`scripts/`)

- Default to dry-run; require `--confirm` to write (not `--apply`).
- Dry-run caches results to a local JSON file; `--confirm` reads the cache and applies — no second API round trip. If no cache exists when `--confirm` is passed, fetch fresh and apply in one shot.
- Use `AND col IS NULL` (or equivalent) on UPDATE statements to make writes idempotent.
- `scripts/db.sh "<sql>"` is the db door; the `node -e` hang is in GOTCHAS.

## The rest of the docs

- [**GOTCHAS**](../GOTCHAS.md) — dated war-stories by subsystem; grep it mid-task, don't read it through.
- [**Deploy**](deploy.md) · [**Deploy requirements**](deploy-requirements.md) — the release procedure, and the consumer brief that fed the migration.
- [**Session log**](session-log.md) — what changed and why, newest first.
- [**Specs**](specs/) — design records, the "why" behind big features. [**Plans**](plans/) — implementation plans for multi-session work. [**Notes**](notes/) — ephemera, not maintained.
- **Listing workflow:** `.claude/skills/list-item/SKILL.md`, with session state in `listing-sessions/<slug>/`.

For the story — what it is, why it exists, the build timeline — the case study at [duckwerks.com/work/duckwerks-dashboard](https://duckwerks.com/work/duckwerks-dashboard/).
