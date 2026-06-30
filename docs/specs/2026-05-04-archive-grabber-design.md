# Archive Grabber — Design

**Date:** 2026-05-04
**Status:** Approved

## Overview

A standalone Python script that downloads high-quality live concert recordings from archive.org to the NUC's local RAID storage, organized for Plex. Runs non-interactively, suitable for cron. Lives in `scripts/archive-grabber/` within the duckwerks-dashboard repo and deploys via the existing `deploy-nuc.sh` path.

---

## Config (`config.yaml`)

Each artist entry defines what to search, what sources to accept, and optionally what date range to constrain to. `name` controls the output folder — all matched collections land under that name regardless of their archive.org identifiers.

```yaml
output_dir: /mnt/BRData/plex/music

artists:
  - name: Grateful Dead
    collections:
      - GratefulDead
      - GratefulDeadFamily
    sources: [SBD, FM]
    # no date_range = grab everything

  - name: Jerry Garcia Band
    collections:
      - JerryGarciaBand
    sources: [SBD, FM]
    date_range: ["1975-01-01", "1995-12-31"]

  - name: RatDog
    collections:
      - RatDog
    sources: [SBD, FM]

  - name: Steve Kimock
    collections:
      - SteveKimock
    sources: [SBD, FM, AUD]

  - name: Medeski Martin & Wood
    collections:
      - MedeskiMartinWood
    sources: [SBD, FM, AUD]
    date_range: ["1992-01-01", "2002-12-31"]

  - name: Galactic
    collections:
      - Galactic
    sources: [SBD, FM, AUD]
    date_range: ["1996-01-01", "2004-12-31"]
```

**Fields:**
- `name` — display name; used as the top-level folder under `output_dir`
- `collections` — one or more archive.org collection identifiers to search
- `sources` — allowed source types in priority order; values are `SBD`, `FM`, `AUD`
- `date_range` — optional `[start, end]` ISO dates; filters by show date (archive.org `date` metadata field). Omit to grab all dates.
- `output_dir` — top-level path on disk; defined once at the top of the config

---

## Candidate Selection

For each artist:

1. Query the archive.org API for all items in each configured collection, filtered to the date range if set
2. Group results by show date (`date` metadata field, normalized to `YYYY-MM-DD`)
3. For each date, filter candidates to allowed source types
4. Score each candidate:
   - **Source rank:** SBD=3, FM=2, AUD=1
   - **Tiebreaker:** `avg_rating × log(review_count + 1)` (both from archive.org metadata)
   - Final score: `source_rank * 10 + tiebreaker` (source type is always the primary sort)
5. Select the highest-scoring candidate per date
6. Compare against state: if already downloaded at equal or higher score, skip. If new score is higher, overwrite.

---

## File Handling

- Download all FLAC files from the selected item directly via the `internetarchive` Python library
- Download SHN files and convert to FLAC post-download using `ffmpeg`
- Skip MP3, OGG, and any other lossy formats even if present in the item
- Remove SHN originals after successful FLAC conversion

---

## Output Structure

```
/mnt/BRData/plex/music/
  {Artist Name}/
    {YYYY-MM-DD} {Venue}, {City}/
      *.flac
```

Venue and city are parsed from archive.org item metadata (`coverage` and `title` fields). If metadata is sparse or unparseable, fall back to the archive.org identifier as the folder name.

---

## State Tracking

A `state.json` file in the script directory records each downloaded show:

```json
{
  "Grateful Dead": {
    "1977-05-08": {
      "identifier": "gd1977-05-08.sbd.miller.29303.sbeok.shnf",
      "score": 32.4,
      "path": "/mnt/BRData/plex/music/Grateful Dead/1977-05-08 Barton Hall, Ithaca"
    }
  }
}
```

On each run, state is loaded first. Items already present at equal or better score are skipped without hitting the archive.org API again (beyond the initial search).

---

## Logging

- Logs to stdout by default
- Optional `--log-file path` argument to also write to a file
- Log lines: artist, date, action (skipped / downloading / converting / overwriting), score
- No interactive prompts; all decisions are automatic

---

## Dependencies

**Python packages** (`requirements.txt`):
- `internetarchive` — archive.org API + download
- `PyYAML` — config parsing

**System dependency:**
- `ffmpeg` — SHN → FLAC conversion; must be installed on the NUC (`apt install ffmpeg`)

---

## Invocation

```bash
# Run for all artists
python grabber.py --config config.yaml

# Run for a single artist (useful for testing)
python grabber.py --config config.yaml --artist "Grateful Dead"

# Dry run — log what would be downloaded without writing anything
python grabber.py --config config.yaml --dry-run
```

---

## File Layout

```
scripts/archive-grabber/
  grabber.py          # main script
  config.yaml         # artist config (committed)
  requirements.txt    # Python deps
  state.json          # download state (gitignored)
```

---

## Deployment

- Lives in `scripts/archive-grabber/` in the duckwerks-dashboard repo
- Deployed to the NUC via existing `bash scripts/deploy-nuc.sh`
- Run manually or add to crontab on the NUC:
  ```
  0 3 * * * cd /path/to/duckwerks-dashboard && python scripts/archive-grabber/grabber.py --config scripts/archive-grabber/config.yaml --log-file /var/log/archive-grabber.log
  ```
