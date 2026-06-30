#!/usr/bin/env bash
# Sanctioned SQLite access for dash.
#
# Runs the sqlite3 CLI — never `node -e` with better-sqlite3, which never closes
# the db handle, so the node process hangs and you have to kill it. Defaults to
# the NUC database (the source of truth); the local data/duckwerks.db is a stale
# copy. Use --local only when you deliberately want that stale copy.
#
# Usage:
#   scripts/db.sh "SELECT * FROM items LIMIT 5;"
#   scripts/db.sh --local "SELECT count(*) FROM items;"
#   echo "SELECT ..." | scripts/db.sh
#
# Writes still follow the data-ops protocol in CLAUDE.md: SELECT first, state the
# change, get confirmation, then run the UPDATE. This wrapper is the how, not a
# bypass of the confirm step.
set -euo pipefail

NUC_HOST="geoff@fedora.local"
NUC_DB="/home/geoff/projects/duckwerksdash/data/duckwerks.db"
LOCAL_DB="$(cd "$(dirname "$0")/.." && pwd)/data/duckwerks.db"

USE_LOCAL=0
if [[ "${1:-}" == "--local" ]]; then
  USE_LOCAL=1
  shift
fi

# SQL comes from args, or from stdin if no args were given.
if [[ $# -gt 0 ]]; then
  SQL="$*"
else
  SQL="$(cat)"
fi

if [[ -z "${SQL//[[:space:]]/}" ]]; then
  echo "db.sh: no SQL provided" >&2
  exit 1
fi

if [[ "$USE_LOCAL" == "1" ]]; then
  printf '%s\n' "$SQL" | sqlite3 "$LOCAL_DB"
else
  printf '%s\n' "$SQL" | ssh "$NUC_HOST" sqlite3 "$NUC_DB"
fi
