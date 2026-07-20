# dash deploy — the Duck Ops node-app rail

> Dash deploys via Ops's `ship` verb; there is no deploy script in this repo. The rail is defined by `[app:duckwerks]` in `duckwerks-ops/substrate.ini` and documented in `duckwerks-ops/docs/standards/deploy.md`. Dash owns `ecosystem.config.js` (which process, which script, which env); the model owns where releases land and who ships them.

## Releasing

From anywhere on the Mac:

```
/Users/Shared/duckwerks/projects/duckwerks-ops/infra-scripts/ship duckwerks
```

(`--plan` prints exactly what would run, running nothing.)

What it does: gitignore-filtered rsync of the tracked tree to `/srv/duckwerks/dash/releases/<ts>/`, `npm ci --omit=dev` on the NUC, write-roots symlinked in, atomic `current` swap, `pm2 startOrReload` against dash's `ecosystem.config.js`, keep five releases, health check on `:3000`, watcher rebaseline (so a deploy reload doesn't read as a crash).

- **The rail refuses a dirty source tree, no override.** Commit first; every deploy reflects a commit.
- **No git on the NUC.** Edit on the Mac, commit, ship.
- **Rollback** is a pointer swap: repoint `current` at a prior release + `pm2 reload duckwerks` (5 kept).

## Code swaps, state persists

The release dir is replaced every deploy. Runtime writes must land in a **declared write-root**, symlinked into each release from the app root:

```
/srv/duckwerks/dash/data               SQLite DB (+wal/shm) + ebay-tokens.json
/srv/duckwerks/dash/public/dg-photos   runtime-written listing photos
/srv/duckwerks/dash/.env               secrets (dotenv reads it from cwd via the symlink)
```

`data` and `public/dg-photos` are the `roots =` entries on `[app:duckwerks]` in `substrate.ini`; `.env` is linked by the rail. A write-root holds the same relative path under the app root that it holds in the release. **A new runtime write path is a new `roots` entry in the model — an ask to Duck Ops, not a script edit.** Undeclared paths don't get linked and the backup guard doesn't know they exist.

## Worth knowing (gotchas)

- **better-sqlite3 is native.** `npm ci` on the NUC fetches a prebuilt binary for the box's Node version. A Node bump with no matching prebuilt falls back to compiling; the build toolchain is installed on the NUC as insurance, so that degrades to a slower deploy, not a broken one.
- **The scraper depends on `CHROME_PATH`** (`/usr/bin/google-chrome-stable`). If chrome moves or updates break it, that env var is the lever.
- **`npm ci` is a deploy-time network dependency.** It runs into the new release dir, so a registry hiccup fails the deploy without touching what is running.

## Ops surfaces around the deploy

- Ingress: `dash.pond.duckwerks.com` nginx vhost → `localhost:3000` (LAN-allowlisted, `client_max_body_size 512M` for photo uploads); deploys never touch it.
- PM2 runs `duckwerks` (fork, `:3000`) as the `duckops` user from `/srv/duckwerks/dash/current`.
- The db is reachable from the Mac via `scripts/db.sh` (rides `duckops@fedora.local`).

## Who owns what

- **dash owns:** the app, `ecosystem.config.js`, the `.env` contents, declaring its write-roots + system binaries.
- **Duck Ops owns:** `/srv` provisioning, the deploy rail (`ship`), the NUC surface (PM2, ingress, OS).
