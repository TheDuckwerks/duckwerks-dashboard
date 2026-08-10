# CLAUDE.md constitution alignment + NUC→MCA doc drift

ref #169

Two independent drifts, bundled because both are doc-only, bounded, and touch overlapping files.

## 1. Constitution alignment (#169)

The org constitution collapsed 77→55 rules on 2026-08-02; dash's CLAUDE.md wasn't touched since 2026-07-27 and cites four now-retired slugs:

- `claude-is-rules` → `four-surfaces` (CLAUDE.md line 8)
- `governing-pointer` → `thin-claude` (line 17)
- `gotchas-form` → `bank-the-gotcha` (line 18)
- `memory-not-durable` → `four-surfaces` (line 63)

Checked against #169's own list and against how ops/hunt already cite these post-collapse — matches. Also checked: CLAUDE.md doesn't restate any of the 17 register/tone rules (now `density`, delivered per-turn) or the 7 build convictions (now `config/HOW-WE-BUILD.md`) — clean, nothing to strip there.

## 2. NUC → MCA (discovered during the printer diagnostic, not ticketed separately — small enough to fold in)

Production substrate moved from the NUC (`fedora.local`, retired 2026-07-30) to MCA (`mca.lan`), per `duckwerks-ops` `SUBSTRATE-TOPOLOGY.md`. Grepped the whole tree: `docs/plans/*` and `docs/specs/*` are dated design records describing what was true when written — **not touched**, rewriting them would be revisionist. Live docs only:

- `CLAUDE.md` — 3 mentions
- `docs/index.md` — the `## The NUC` section: SSH target, hostname, box facts. Drop the `/home/geoff/projects/duckwerksdash` fallback note entirely (the NUC is off; nothing to fall back to anymore).
- `docs/deploy.md`
- `.claude/skills/list-item/SKILL.md`
- `docs/claude/codebase-map.md` — also fix: it still lists `scripts/deploy.sh` as live; that script was retired in `00818dd`. Doesn't exist on disk.
- `docs/claude/api-reference.md`
- `scripts/README.md` — also fix: example SSH command uses `geoff@`, but index.md's own NUC section already establishes `duckops@` as the actual ops rail principal (`geoff@` is rescue-only). Wrong on both host and principal, independent of the rename.

## Verification

- `gander --doc projects/duckwerks-dashboard/CLAUDE.md` stays clean (0 errors).
- No remaining `NUC` / `fedora.local` hits in the live-doc set above (plans/specs excluded on purpose).
- No dangling reference to `scripts/deploy.sh`.
- Geoff reads the reworked CLAUDE.md + docs/index.md and confirms it reads as current, not patched.
- #169 closes on his confirmation.

## Ledger

- 2026-08-10 checkpoint: fixed all 4 retired-slug citations in CLAUDE.md; `gander --doc projects/duckwerks-dashboard/CLAUDE.md` clean (0 errors, 1078 words, was 1079).
- 2026-08-10 checkpoint: rewrote docs/index.md's `## The NUC` → `## The box` section for MCA; dropped the dead `/home/geoff/projects/duckwerksdash` fallback note.
- 2026-08-10 checkpoint: swept remaining live-doc NUC/fedora.local mentions (docs/deploy.md, .claude/skills/list-item/SKILL.md, docs/claude/codebase-map.md, docs/claude/api-reference.md, scripts/README.md). Confirmed docs/plans/* and docs/specs/* left untouched (historical).
- 2026-08-10 discovery: `scripts/deploy.sh` and `scripts/deploy-nuc.sh` were both retired and don't exist on disk, but codebase-map.md and scripts/README.md still documented them as live. Removed the dead entries; codebase-map now points at the Ops `ship` rail directly.
- 2026-08-10 discovery: scripts/README.md's refresh-disc-titles.js example used `ssh geoff@fedora.local`, wrong on both host and principal (index.md's own NUC section already established `duckops@` as the ops rail account). Fixed to `duckops@mca.lan`.
