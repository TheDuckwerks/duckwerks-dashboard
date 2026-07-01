# Web Bulk List — Photo Upload + List from the Catalog UI

**Issue:** #139
**Date:** 2026-07-01
**Status:** Approved — ready to build

---

## For the cold session reading this

The goal is to **get listing off the CLI entirely.** Today, listing a batch of discs means: rename photos with `scripts/rename-disc-photos.js`, point `scripts/bulk-list-discs.js` at a photo dir, and run it. This spec replaces that with a web flow: drag a photo pile into the catalog, eyeball an auto-computed photo↔disc mapping, confirm, and the discs go live on eBay.

Depends on the #134 lifecycle refactor (done): every disc has an `items` row with `item_status`, so the catalog already knows which discs are `Prepping` (intake, not yet listed).

Read first (per the read-enough-to-act rule):
- This spec.
- `server/ebay-listings.js` — `bulk-list` route (the proven mint path: `savePhotos` → `putInventoryItem` → `upsertOffer` → `publishOffer` → `dbWriteDiscListing`), `buildInventoryItemBody`, `buildOfferBody`, `savePhotos`.
- `server/ebay-client.js` — `uploadToEPS(buffer, filename)` (photo → eBay Picture Services URL), the offer/publish helpers.
- `scripts/bulk-list-discs.js` — the CLI being retired (its `--list` path); note how it globs `^DWG-{id}-.*\.jpe?g$` and multipart-uploads.
- `scripts/rename-disc-photos.js` — the chunk-by-N / map-to-sequential-disc logic to port.
- `public/v2/js/views/catalog.js` + `partials/views/catalog.html` — the catalog view, the `ebayQueue`/batch-update pattern to mirror.

---

## The end-state flow (zero CLI)

1. **Intake batch (web)** → a set of `Prepping` discs with staged price + specs. *(exists, #134)*
2. **Shoot photos in DWG order** (meatspace): disc 293's shots, then 294's, etc. Offload to a folder as JPEGs, ordered by filename (`IMG_001.jpg`, `IMG_002.jpg`, …). JPEG conversion happens on offload (Mac Shortcut/import) — no rename, no CLI.
3. **Catalog → BULK LIST:** pick the target `Prepping` discs (a DWG range or select-all-ready), drag the photo pile onto the dropzone, set **photos-per-disc N**.
4. **Preview the mapping:** the server sorts by filename, chunks by N, maps chunk-*i* → the *i*-th selected disc (ascending SKU), and shows disc ↔ its photos ↔ specs ↔ price. Nudge a chunk boundary where a disc has a different count.
5. **Confirm** → photos land in `public/dg-photos/` as `DWG-{id}-{n}.jpeg`, offers are created + published, per-disc success/fail reported (like the batch-update run). Discs flip `Prepping` → `Listed`.

On a local-LAN vhost the upload is effectively instant.

---

## Resolved design decisions

1. **Transport = browser bulk upload, not rsync.** The browser pushes photos to the NUC over the channel that already works (browser→app); no reverse NUC→Mac SSH (fragile: needs the Mac awake, `sshd`, a stable reverse route). rsync stays a documented power-user fallback, not the path.
2. **Associate at the listing stage, not intake.** Intake is pure data entry and happens before the photo session; photos and discs only meet when assembling the list bundle, which is inherently bulk. So the upload/map/preview lives in the BULK LIST flow.
3. **The upload does convert(optional) + chunk + map + rename.** No prep scripts. Port `rename-disc-photos.js`'s chunking: sort by filename, group by N, map to sequential discs. Server writes the final `DWG-{id}-{n}.jpeg` names.
4. **Preview is the load-bearing HITL gate.** Pure "N-per-listing" is brittle the instant one disc breaks the count; the preview auto-chunks by N as the default and lets the human correct a boundary — and it's the review-before-30-listings-go-live checkpoint. Never list without the confirmed mapping.
5. **Reuse the proven mint path.** The eBay create+publish mechanism (`bulk-list`) is already validated via the CLI. The web flow is a re-skin: the only new backend is a **disk-read photo mode** (read `dg-photos` by SKU instead of multipart upload) + the upload/map/preview endpoints. (CLI-first-then-absorb: the mechanism is proven; we're changing the human-interaction surface.)
6. **Immediate publish** (offer → publish → live), same as the CLI does today — not draft-then-review.
7. **JPEG-in is the baseline.** No image lib is installed (only `multer`). HEIC→JPEG server-side would need `sharp` built with libheif — optional nicety, out of scope for v1 since offload converts.

---

## Naming — the one sharp edge

- **Photos** are keyed by **unpadded** disc id: `DWG-10-1.jpeg`, `DWG-100-1.jpeg` (matches the 651 files already on the NUC and the existing glob `^DWG-{id}-.*\.jpe?g$`).
- **eBay SKU** is **padded**: `DWG-010` (`DWG-${String(id).padStart(3,'0')}`).
- The readiness glob and the disk-read list mode key on the **unpadded** id; the offer/inventory mint keys on the **padded** SKU. Don't conflate them.
- Extension: write `.jpeg` (the established convention); the glob accepts `.jpe?g`.

---

## Backend

### 1. Disk-read photo mode on the mint path
`bulk-list` currently gets photos via multipart (`savePhotos(req.files)`). Add a mode that reads them from `public/dg-photos/` by unpadded id when no files are uploaded:
- `photosFromDisk(id)` → glob `DWG-{id}-*.{jpeg,jpg}`, sort by the `-{n}` suffix numerically, return `[{buffer, filename}]`.
- Feed those through the existing `uploadToEPS(buffer, filename)` → `imageUrls`, then the unchanged `buildInventoryItemBody`/`buildOfferBody`/publish/`dbWriteDiscListing` path.
- Keep the multipart path intact (the CLI and `bulk-photos` still use it).

### 2. Photo upload + map endpoint
`POST /api/ebay/bulk-list-photos` (multipart): body = photo files + `perDisc` (N) + `discIds[]` (the selected `Prepping` ids, the mapping target order).
- Sort files by filename, chunk by N, map chunk-*i* → `discIds[i]` (caller sends them ascending).
- Write each chunk to `public/dg-photos/` as `DWG-{id}-{n}.jpeg`.
- Return the mapping `{ discId: [ "/dg-photos/DWG-{id}-1.jpeg", … ] }` for the preview.
- **Staging vs direct:** simplest is to write straight into `dg-photos` (the destination) and let the preview be the check — a wrong mapping is overwritten on re-run, and listing only happens on explicit confirm. If orphan-file risk matters, stage in a `dg-photos/.staging/<batch>/` subdir and finalize on confirm (no new persistent dir needed — it's under the existing symlinked `dg-photos`). Cold session's call; default to direct + preview.
- Optional adjust: the UI can re-POST with a corrected `perDisc` or an explicit per-disc count array if a boundary is off.

### 3. Readiness endpoint
`GET /api/ebay/photo-status?ids=<range>` → `{ "DWG-293": 2, "DWG-294": 0, … }` by globbing `dg-photos`. Drives the per-disc readiness badge (has-photos + count).

### 4. Persistence
`public/dg-photos/` is already a persistent symlinked dir (survives deploys) — no new dir needed. If a `.staging/` subdir is used, it lives under the same symlink, so it's covered.

---

## Frontend (catalog view)

- **BULK LIST section** (near the intake form / inventory list): lists `Prepping` discs with a readiness badge (photo count from the readiness endpoint, staged price present, required specs present). A disc is **list-ready** when it has ≥1 photo + a price + the required specs.
- **Batch selection:** DWG range input or select-all-ready, producing the ascending `discIds[]`.
- **Dropzone + N:** drag the photo pile, set photos-per-disc.
- **Mapping preview:** a table/grid — each disc row with its mapped thumbnails, resolved title (`items.name`), price, and a ready/not-ready flag. Boundary-nudge control for off-count discs.
- **BULK LIST ALL:** on confirm, POST `bulk-list` (disk-read mode) per disc, mirroring `ebayBatchUpdate`'s progress/results loop (per-disc OK/fail, links to live listings). Reuse the queue visual language (`QUEUED`/`LISTED` badges, progress bar).
- The existing per-row **UPDATE EBAY** stays for `Listed` discs; **LIST** (this flow) is the `Prepping` counterpart the #134 badge/gating already anticipates.

---

## Phased build plan

Each phase deploys and is verifiable. Photo-heavy — verify in the browser at each step.

### Phase 1 — Disk-read mint path
- `photosFromDisk(id)` + disk-read mode in `bulk-list`.
- Manually place a couple `DWG-{id}-{n}.jpeg` files on the NUC, call `bulk-list` with no upload, confirm the listing mints with those photos.
- **Checkpoint:** the mint path can list from NUC-resident photos. (The CLI can now be pointed away from upload, proving the mechanism.)

### Phase 2 — Upload + map + readiness endpoints
- `bulk-list-photos` (upload → chunk → map → write) and `photo-status` (readiness).
- Verify: POST a pile with N, confirm files land correctly named and the mapping returns right.
- **Checkpoint:** photos get from browser to `dg-photos` correctly mapped, server-side.

### Phase 3 — BULK LIST UI
- Dropzone, batch selection, mapping preview with boundary-nudge, readiness badges, BULK LIST ALL wired to the disk-read mint per disc.
- Verify: full flow on a small real batch (2–3 discs) end to end → live on eBay.
- **Checkpoint:** zero-CLI listing works for a small batch.

### Phase 4 — Cutover + retire CLI
- Retire `scripts/bulk-list-discs.js` (`--list`/`--photos` paths), `rename-disc-photos.js`, `convert-photos.js` once the web flow covers them. (Keep `--photos-only`/`bulk-photos` if still used for re-photographing.)
- GOTCHAS + `scripts/README` + `docs/claude/*` updates.
- **Checkpoint:** #139 closed; the CLI listing path is gone.

---

## Verification (manual, browser + eBay)

- A `Prepping` disc with no photos shows not-ready; after upload, shows its photo count and becomes list-ready.
- Drop a pile of N×M photos for M discs → preview maps them correctly in DWG order; an off-count disc is correctable via the boundary nudge.
- Confirm → offers create + publish; discs flip to `Listed`; the live eBay listings show the right photos, title (`items.name`), and price (staged → listing).
- A partial failure (one disc missing a spec) reports per-disc without sinking the batch.

---

## Out of scope

- **HEIC decode on the NUC** (JPEG-in baseline; add `sharp`+libheif later if offload conversion becomes a burden).
- **rsync transport** (documented fallback only).
- **Per-disc drag upload** (rejected — bulk is the point).
- **Draft-then-review** offers (immediate publish, as today).
- Reverb listing (this is the eBay/disc path).

## Retires once shipped
`scripts/bulk-list-discs.js` (list/photos paths), `scripts/rename-disc-photos.js`, `scripts/convert-photos.js`.
