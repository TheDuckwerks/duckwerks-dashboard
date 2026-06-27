# Duckwerks Dashboard — Claude Code Guide

> **🚧 WIP — mid doc-split.** This CLAUDE is being refactored toward the org doc standard (`/Users/Shared/duckwerks/gator/CLAUDE.md`): **CLAUDE = how we work** · **README = what it is / tools / facts** · **GOTCHAS = footguns**. Right now it still inlines facts and gotchas that belong in the other two — that's known, not drift. The high-level first pass (from the Gator seat) set the paradigm and seeded GOTCHAS; the deep consolidation happens from dash's own seat (the `docs/claude-md-review-notes.md` notes feed it).
>
> **How we work on dash — the operating rules.** Keep this file thin; depth lives in the docs it points to. Update it when a *rule* changes.
>
> **Org place:** **Dash is a first-class singleton vertical** (no shared product/code with anything). **It IS a Duck Ops citizen** — runs on the NUC, adopts the paved road (deploy/ingress/PM2 are Duck Ops's; see `/Users/Shared/duckwerks/projects/duckwerks-ops/`). Currently gated by Cloudflare Zero Trust *because dash has no auth of its own* — the standing dependency: **dash building its own auth** unblocks the org-wide move off Cloudflare (see Duck Ops's `NUC-TOPOLOGY.md`). Org map: `/Users/Shared/duckwerks/gator/INVENTORY.md`.
>
> **Orientation — which doc holds what:**
> - **README.md** — project facts (stack, schema, commands, workflow). Read first when cold.
> - **GOTCHAS.md** — dated war-stories by subsystem. Grep mid-task; don't read cover-to-cover. *(Seeded; CLAUDE's inline Gotchas section still migrating into it.)*
> - **CLAUDE.md** (this file) — operating rules. Points to the above; doesn't restate them.
> - **`docs/`** — specs, plans, session-log, the `docs/claude/` reference pair (api-reference, frontend-reference).

## Project Overview
The CMS/analytics/comp tool for Geoff's resale business (Duckwerks Music) — the inventory, listing, order, and shipping engine behind his eBay and Reverb selling. (Who Geoff is: the global persona at `/Users/Shared/duckwerks/config/persona.md` — this file doesn't restate it.)

**What it's actually for right now:** a sell-down engine, not a collector's catalog. Geoff is windowing a long-accumulated collection down to what he throws/keeps — music gear, tech, comics, doodads already moved; the 400+ disc-golf collection now the active vertical (down to ~50 throwers + ~50 true keepers). So disc-golf intake/listing is the current focus because it's the big remaining lot — but DG is just the active *vertical*, the same way the tool handles a pedal, a comic, or a console. Build category logic to generalize, not to enshrine discs.

Built with Alpine.js, served by a local Express server, backed by SQLite.

## Stack
- **Frontend:** `public/v2/` — Alpine.js, modular JS files, no build step
- **Backend:** `server.js` — local Express server (Node 22), proxies all API calls
- **Database:** SQLite via `better-sqlite3` — `data/duckwerks.db`
- **Shipping:** EasyPost API (active); Shippo retained but inactive. Provider via `SHIPPING_PROVIDER` in `.env`
- **Config:** `.env` — never commit, never read client-side

## Running Locally
```bash
npm start   # starts Express on http://localhost:3000
```

## Specs & Plans
- `docs/superpowers/specs/` — design specs (source of truth for "why")
- `docs/superpowers/plans/` — implementation plans
- `.superpowers/` — brainstorm working files (gitignored)

## Project Skills
- `.claude/skills/list-item/SKILL.md` — eBay listing workflow (intake → comps → pricing → copy → metadata). Invoke by saying "use the list-item skill". Not registered via superpowers — read directly.
- Session files live in `docs/listing-sessions/<slug>/` (checkpoint.json, comps.txt, listing.md)

## Version Control
- GitHub: https://github.com/TheDuckwerks/duckwerksdash (private)
- Commit after any meaningful session of changes
- Never commit `.env`, `node_modules/`, `*.pdf`, `test.html`, `comic-reselling-project.md`, `data/duckwerks.db`

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
**Use `sqlite3` directly** for bulk updates, migrations, or when no route fits — never `node -e` inline scripts (better-sqlite3 never calls db.close(), so the process hangs).

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

**Server**
- `server.js` — Express entry point: mounts routers, serves static, redirects `/` → `/v2`
- `server/db.js` — opens SQLite db via better-sqlite3; shared across all routers
- `server/catalog.js` — `/api/sites`, `/api/categories`
- `server/catalog-intake.js` — `/api/catalog-intake/*` — disc intake (manufacturers, molds, plastics, disc save); DB-only, no Google Sheets
- `server/items.js` — `/api/items` CRUD
- `server/lots.js` — `/api/lots` CRUD
- `server/listings.js` — `/api/listings` CRUD
- `server/orders.js` — `/api/orders` CRUD
- `server/shipments.js` — `/api/shipments` CRUD
- `server/label.js` — provider-agnostic label routes (`/api/label/*`)
- `server/print.js` — label print (`POST /api/print/label`) → raw TCP socket to Zebra ZD420D at `ZEBRA_PRINTER_IP:9100`
- `server/comps.js` — comp research (`/api/comps/*`) — SerpAPI + Puppeteer + Claude
- `server/reverb.js` — Reverb proxy (`/api/reverb/*`)
- `server/ebay-auth.js` — eBay OAuth (one-time setup + auto-refresh)
- `server/ebay.js` — eBay Sell Fulfillment + Inventory API (`/api/ebay/*`); includes `POST /api/ebay/migrate-listing` and `GET /api/ebay/offer`
- `server/ebay-client.js` — shared eBay API plumbing (headers, policies, EPS upload, inventory item PUT/GET, offer upsert/update/publish)
- `server/ebay-builders.js` — disc payload builder (`buildDiscPayload`), description renderers; add new category builders here
- `server/ebay-listings.js` — eBay listing routes (`/api/ebay/bulk-list`, `bulk-update`, `bulk-preview`, `bulk-photos`, `list-item`, `update-item`); thin handlers only
- `server/inventory.js` — local inventory CRUD (`GET /api/inventory`, `GET /api/inventory/:sku`, `PATCH /api/inventory/:sku`); `GET /api/inventory` LEFT JOINs items+listings to return `ebay_listing_id` per row
- `scripts/deploy-nuc.sh` — pull + PM2 restart on the NUC; run after every push. SSH: `ssh geoff@fedora.local`, project at `/home/geoff/projects/duckwerksdash`
- `scripts/bulk-list-discs.js` — bulk eBay lister; idempotent (safe to re-run)
- `scripts/README.md` — index of all active scripts with usage examples
- `data/ebay-tokens.json` — eBay OAuth tokens (never commit)

> `scripts/archive-grabber/` was extracted out of dashboard per issue #118; it now lives under `/Users/Shared/duckwerks/projects/duckwerks-media/archive-grabber/`.

**Frontend**
- `public/v2/index.html` — app shell with `<!-- partial: views/foo -->` and `<!-- partial: modals/foo -->` comment placeholders; server assembles the final HTML at request time by inlining partials (see `server.js` `assembleHTML()`)
- `public/v2/partials/views/` — view HTML partials (dashboard, items, lots, analytics, comps, catalog, sites)
- `public/v2/partials/modals/` — modal HTML partials (item, add, lot, label, shipping)
- `public/v2/js/config.js` — constants: `CAT_BADGE`, `CAT_COLOR`, `SITE_FEES`, `APP_VERSION`
- `public/v2/js/notifications.js` — browser push notification module: permission, 5-min order poller, delta tracking; test page at `/push-test`
- `public/v2/js/store.js` — `Alpine.store('dw')` — all data, helpers, modal state; includes `trafficMap: {}` (session cache of `{ [legacyListingId]: { views, impressions, ctr } }`) and `trafficLoading: bool` — populated by whichever view loads first (analytics or catalog)
- `public/v2/js/sidebar.js` — search + nav state
- `public/v2/js/views/` — Alpine component definitions for each view
  - `analytics.js` — fetches eBay traffic via `POST /api/ebay/traffic`; uses `TOTAL_IMPRESSION_TOTAL` (includes promoted); writes result into `$store.dw.trafficMap` for sharing
  - `catalog.js` — DG intake form + inventory list; `loadTraffic()` reads `trafficMap` if already populated, otherwise fetches and writes it; `sortedInventory` getter sorts by any column incl. traffic metrics
- `public/v2/js/modals/` — Alpine component definitions for each modal (item, add, lot, label, shipping)

> Full endpoint docs + env vars + schema: `docs/claude/api-reference.md`
> Alpine architecture, modal patterns, component details: `docs/claude/frontend-reference.md`

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

## Gotchas

**eBay traffic API metric** — use `TOTAL_IMPRESSION_TOTAL` (includes promoted listing impressions), not `LISTING_IMPRESSION_TOTAL` (organic only). The Seller Hub UI shows the total; the API will mislead you with the organic-only metric if you pick the wrong key.

**Alpine modal pattern** — every modal overlay needs three things on its root div or it will be permanently visible and break the entire UI:
```html
<div x-show="$store.dw.activeModal === 'modal-name'" x-data="modalComponent" class="modal-overlay" x-cloak>
```
And the JS component needs an `init()` that `$watch`es `activeModal` to call `reset()` on open:
```js
init() {
  this.$watch('$store.dw.activeModal', val => { if (val === 'modal-name') this.reset(); });
},
```

---

## When to Use Superpowers Workflow

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

**"Brainstorm → spec → build"** means: align on design, write the spec, then implement directly in-session without a written task plan. The spec is the artifact; the plan is overhead unless the work spans sessions or has tricky sequencing.

---

## Versioning
- `public/v2/js/config.js` → `APP_VERSION` constant (shown in sidebar)
- `package.json` → `version` field
- Bump patch at end of every session that ships something.
- Tag minor/major versions only — no tags per patch.

---

## Session Start
1. Read `CLAUDE.md` (this file)
2. React to Geoff's opening prompt — don't pre-fetch issues or run diagnostics unless asked

## Checkpoint Protocol
Any time Geoff says "checkpoint":
1. Bump patch version in `config.js` + `package.json`
2. Update `docs/session-log.md`
3. Commit with ticket refs
4. Push to origin
5. Run `bash scripts/deploy-nuc.sh` to deploy to production

## Session Close
At the end of every session:
1. Bump patch version in `config.js` + `package.json` (if anything shipped)
2. Update `CLAUDE.md` with any structural changes made this session
3. Update `docs/session-log.md`
4. Commit all changes including docs with ticket refs
5. Push to origin
6. Run `bash scripts/deploy-nuc.sh`

**Where knowledge goes (four surfaces — memory is sunset).** Don't use memory; it's dead org-wide (see global `/Users/Shared/duckwerks/config/CLAUDE.md`). Durable knowledge lives in one of: **README** (project facts — stack, schema, file roles, workflows), **GOTCHAS.md** (dated war-stories by subsystem), this **CLAUDE.md** (how we work — operating rules only), or the **tracker** (GH Issues — backlog). Keep this CLAUDE thin: it points to the others, it doesn't restate them. Cross-project behavioral preferences and who-Geoff-is live in the global layer, not here.

Tell Geoff what was updated in CLAUDE.md and session-log.md — one line each.

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