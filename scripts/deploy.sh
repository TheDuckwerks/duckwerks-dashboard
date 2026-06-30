#!/usr/bin/env bash
#
# dash deploy — Duck Ops rsync-artifact standard (ops #3).
# Steady-state tool: build/ship the committed tree -> npm ci on the NUC ->
# symlink persistent state -> atomic swap -> PM2 reload. No git on the NUC.
#
# One-time state migration (moving the live DB/photos/.env into /srv) is NOT
# here — it's the cutover runbook, run once. This assumes state already lives
# in /srv/duckwerks/dash/{data,dg-photos,.env}.
#
set -euo pipefail

APP="dash"
NUC="geoff@fedora.local"
APP_ROOT="/srv/duckwerks/${APP}"
KEEP=5
TS="$(date +%Y%m%d-%H%M%S)"
REL="${APP_ROOT}/releases/${TS}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Deploying ${APP} -> ${REL}"

# Ship the tracked tree: honor .gitignore (drops node_modules, .env, *.log,
# *.csv, data/, public/dg-photos/ ...), always drop .git. node_modules is built
# on the target, never shipped.
rsync -az --delete --filter=':- .gitignore' --exclude='.git' \
  "${SRC}/" "${NUC}:${REL}/"

ssh "${NUC}" bash -euo pipefail <<REMOTE
  cd "${REL}"
  echo "==> npm ci on the NUC"
  npm ci --omit=dev

  echo "==> symlink persistent state into the release"
  ln -sfn "${APP_ROOT}/data"      "${REL}/data"
  ln -sfn "${APP_ROOT}/dg-photos" "${REL}/public/dg-photos"
  ln -sfn "${APP_ROOT}/.env"      "${REL}/.env"

  echo "==> swap current -> ${TS}"
  ln -sfn "${REL}" "${APP_ROOT}/current"

  echo "==> PM2 startOrReload"
  pm2 startOrReload "${APP_ROOT}/current/ecosystem.config.js"
  pm2 save

  echo "==> prune old releases (keep ${KEEP})"
  cd "${APP_ROOT}/releases"
  ls -1dt */ | tail -n +\$((${KEEP} + 1)) | xargs -r rm -rf

  echo "==> health check"
  sleep 1
  curl -fsS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/ || {
    echo "HEALTH CHECK FAILED"; exit 1; }
REMOTE

echo "==> ${APP} deployed: ${TS}"
