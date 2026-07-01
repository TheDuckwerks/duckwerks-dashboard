# dash deploy — the new release procedure (post Duck Ops migration)

> Close-out for dash's migration onto the Duck Ops rsync-artifact standard (2026-06-29). dash no longer deploys via `git pull && pm2 restart` on the NUC. The old requirements brief (`deploy-requirements.md`) was the input; this is how it actually works now. Standard: `duckwerks-ops/docs/standards/deploy.md`.

## How dash runs now

- Production is an **immutable artifact** under `/srv/duckwerks/dash/releases/<timestamp>/`, with `current` a symlink pointing at the live release. PM2 runs it (`duckwerks`, fork mode, port 3000) from `/srv/duckwerks/dash/current`.
- Ingress is unchanged: ZT / Cloudflare Tunnel still points at `localhost:3000`, so the move was transparent to `dash.duckwerks.com`.
- The old checkout at `/home/geoff/projects/duckwerksdash` is kept as a fallback. Retire it once you are confident (it is not running anything).

## Releasing a new version

From the dash repo on the Mac:

```
./scripts/deploy.sh
```

That rsyncs the working tree to a new release dir, runs `npm ci --omit=dev` on the NUC, symlinks the persistent state in, swaps `current`, reloads PM2, and health-checks port 3000. Notes:

- **rsync ships the working tree, not a commit.** It honors `.gitignore` (node_modules/.env/data/ excluded) and ships whatever is in the working dir — uncommitted edits included. So deploy freely to test; commit + push are how a verified change gets recorded, not a deploy prerequisite.
- **No git on the NUC.** Never edit code on the box; edit on the Mac and redeploy.
- **Rollback** is a pointer swap: repoint `current` at a prior release dir and `pm2 reload duckwerks`. Five releases are retained.

## The model dash must respect: code swaps, state persists

The release dir is replaced every deploy. Anything the app writes at runtime must live in a **persistent** dir outside the release, symlinked in. dash's current set:

```
/srv/duckwerks/dash/data        SQLite DB (+wal/shm) + ebay-tokens.json
/srv/duckwerks/dash/dg-photos    runtime-written listing photos
/srv/duckwerks/dash/.env         secrets (dotenv reads it from cwd via a symlink)
```

These work because the code resolves them `__dirname`-relative (`server/db.js`, `ebay-auth.js`, `ebay-listings.js`). **If dash ever adds a new runtime write path, it needs a new persistent dir + symlink**, or it will vanish on the next deploy. That is the one rule to internalize.

## Check on dash's side

- [ ] **`.env` is authoritative at `/srv/duckwerks/dash/.env`.** It was copied from the old checkout during cutover, with `CHROME_PATH` repointed to `/usr/bin/google-chrome-stable`. From now on, edit secrets in that file, not the old checkout's.
- [ ] **eBay token refresh writes through.** Tokens are runtime-rewritten to `data/ebay-tokens.json`; confirm the next refresh cycle persists (the symlink means it should land in `/srv`).
- [ ] **No missed write paths.** The state set was declared complete (data/ + dg-photos/). Worth one scan for anything else the app writes: label scratch, temp files, a puppeteer user-data-dir.
- [ ] **gitignore the artifact noise.** `csvs/`, `tmp/`, `.claude/`, `.vscode/` are not ignored, so they currently ship into the artifact. Harmless, but add them to `.gitignore` to keep releases clean.
- [ ] **Keep `package-lock.json` current.** `npm ci` installs it exactly; the lock is the source of truth for what runs.

## Worth knowing (gotchas)

- **better-sqlite3 is native.** Deploys `npm ci` on the NUC, which fetches a prebuilt binary for the box's Node version. A Node bump with no matching prebuilt falls back to compiling; the build toolchain is installed on the NUC as insurance, so that degrades to a slower deploy, not a broken one.
- **The scraper depends on `CHROME_PATH`** (`/usr/bin/google-chrome-stable`, swapped from chromium). If chrome moves or updates break it, that env var is the lever.
- **`npm ci` is a deploy-time network dependency.** It runs into the new release dir, so a registry hiccup fails the deploy without touching what is running.

## Who owns what

- **dash owns:** the app, `scripts/deploy.sh` + `ecosystem.config.js` (in this repo), declaring its state dirs + system binaries, the `.env` contents.
- **Duck Ops owns:** `/srv` provisioning, the deploy standard, the NUC surface (PM2, ingress, OS).
