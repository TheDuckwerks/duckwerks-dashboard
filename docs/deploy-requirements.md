# Dash Deploy Requirements (consumer brief for the paved-road standard)

> What dash, the biggest and oldest consumer of the NUC, needs the org deploy standard to deliver. This is a requirements brief, not an implementation: Duck Ops owns the design (issues #3 deploy template, #4 migration spec, #5 secrets, #6 PM2 ecosystem). This doc is the input that turns "decide details when we start" into concrete acceptance criteria.

## Where dash is today

- Deploy is `scripts/deploy-nuc.sh`: SSH to the NUC, `git pull`, `pm2 restart`. The standard retires this (no git checkouts of Duckwerks code on the NUC).
- Runs as PM2 process `duckwerks` on `:3000`. NUC path: `/home/geoff/projects/duckwerksdash`.
- Reached via Cloudflare Tunnel + Zero Trust (dash stays on ZT; see the topology decision in CLAUDE).

## App shape that drives packaging

- **No build step.** Alpine.js + static assets under `public/v2/`, server-assembled HTML. Nothing to compile on the frontend.
- **Node 22 + Express.** Server is plain JS, no transpile.
- **`better-sqlite3` is a native module.** This is the load-bearing catch (see Requirement 1).

## Requirements (acceptance criteria)

**1. The artifact must handle the native module correctly.**
`better-sqlite3` compiles a platform-specific `.node` binary. A node_modules built on the Mac (arm64 / macOS) **will not run** on the NUC (x64 / Linux). So "build on Mac, rsync node_modules" is broken for dash as-stated. The standard must do one of: (a) rsync source only, run `npm ci --omit=dev` on the NUC (a package install, not a git checkout, so it respects the no-git rule), or (b) ship a Linux-x64 prebuilt/rebuilt module in the artifact. Pick one and make it the convention. Any project with a native dep hits this, so dash is a good forcing case.

**2. Stateful data must live OUTSIDE the swappable artifact.**
If artifacts land in an immutable `/srv/duckwerks/dash/<release>/` and get swapped on deploy, these must NOT be inside that tree, and a deploy must NEVER touch them:
- `data/duckwerks.db` (plus `-wal`/`-shm`): the production SQLite, the source of truth. Overwriting it means data loss.
- `data/ebay-tokens.json`: eBay OAuth tokens, **rewritten at runtime** on token refresh. Must persist across deploys or eBay auth breaks.
- any uploaded/generated assets the app writes at runtime (photos, label scratch). Confirm the set during migration.
Convention needed: a persistent per-app data dir (e.g. `/srv/duckwerks/dash/data/`) symlinked into the release, so releases swap and state stays put.

**3. Secrets/env land out of band.**
dash has a fat `.env` (EasyPost, eBay OAuth client + refresh, SerpAPI, Anthropic, `FROM_*` address, `ZEBRA_PRINTER_IP`, `SHIPPING_PROVIDER`). It is never committed. The standard (#5) needs a convention for how `.env` gets onto the NUC and is referenced by the release without living in the artifact or git.

**4. PM2 registration + restart is defined, not improvised.**
What replaces `pm2 restart duckwerks`: how a new release is pointed at, restarted, and confirmed up. Ties to the #6 ecosystem file (declarative process definition for `duckwerks` on `:3000`).

**5. Rollback is a pointer swap.**
Keep N previous releases; rollback = repoint the `current` symlink and restart. Cheap and instant, no rebuild.

## Open questions for Ops

- Artifact root and release layout: is it `/srv/duckwerks/dash/releases/<ts>/` + a `current` symlink? (dash assumes yes; confirm.)
- Native-module convention: NUC `npm ci` vs. prebuilt (Requirement 1). Ops's call, dash just needs it decided.
- Who runs the deploy: a script on the Mac that rsyncs + triggers the remote restart, or a pull-style trigger on the NUC?

## What dash does on its side once the standard lands

- Externalize `data/` and `ebay-tokens.json` to the persistent dir; remove the assumption that they sit inside the app checkout.
- Replace `scripts/deploy-nuc.sh` with the standard's deploy entrypoint.
- Provide the declarative PM2 entry for `duckwerks`.
