#!/usr/bin/env bash
# Autonomous LGU ingest for the VPS cron (see docs/DEPLOY-VPS.md). Loads Node 22
# via nvm and the repo-root .env, then runs the full live crawl. The adapter
# retries through the portal's flaky windows and aborts cleanly on a hard block.
# Portable: it locates the repo relative to this script, so no hardcoded paths.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a
[ -f .env ] && . ./.env
set +a
export SOURCE_MODE=live

echo "[$(date -u +%FT%TZ)] campusos ingest starting"
pnpm ingest:lgu
echo "[$(date -u +%FT%TZ)] campusos ingest done"
