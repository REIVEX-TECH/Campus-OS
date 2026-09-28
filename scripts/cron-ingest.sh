#!/usr/bin/env bash
# Autonomous LGU ingest for the VPS cron (see docs/DEPLOY-VPS.md). Loads Node 22 via nvm,
# then runs the full live crawl from the repo root. The adapter retries through the
# portal's flaky windows and aborts cleanly on a hard block. Portable: it locates the repo
# relative to this script, so no hardcoded paths.
#
# It does NOT source .env into the shell. The ingest script loads .env itself via
# `dotenv/config`, exactly as a manual `pnpm ingest:lgu` does, so cron and a manual run
# parse the env identically. Shell-sourcing (`set -a; . ./.env`) mis-parses any value with
# a shell-special character (a `#`, `$`, space or quote in a DB password, say), which
# would silently give cron a broken DATABASE_URL while the manual run still worked -- the
# kind of divergence that can stop the cron persisting without stopping a manual run.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export SOURCE_MODE=live

echo "[$(date -u +%FT%TZ)] campusos ingest starting"
# pnpm ingest:lgu loads .env (dotenv) and, if INGEST_HEALTHCHECK_URL is set there, pings a
# push heartbeat on success / `/fail` on failure. The pull endpoint /api/health/ingest
# checks the same freshness independently.
pnpm ingest:lgu
echo "[$(date -u +%FT%TZ)] campusos ingest done"
