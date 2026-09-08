#!/usr/bin/env bash
# Fail loudly if the most recent database dump is missing or too old.
#
# Pairs with the nightly scripts/backup.sh described in docs/runbooks/backup.md:
# that cron writes campusos-<UTC stamp>.dump.gpg into $BACKUP_DIR at 03:30. A
# backup you do not watch is a backup you do not have, and "backup ok" not showing
# up in a log is easy to miss. Run this from its own cron a few hours after the
# dump (or hourly) so a night with no fresh dump exits non-zero and pages someone.
#
# The window is 26h by default: the 24h dump cadence plus a 2h grace for a slow
# dump, so a single missed night trips it while an on-time dump never does. It
# checks the LOCAL $BACKUP_DIR the nightly script writes and prunes; the off-box
# copy is the remote target's own concern to alarm on.
#
#   BACKUP_DIR=/srv/campusos-backups ./scripts/backup-check.sh
#   0 8 * * * cd /srv/campusos && ./scripts/backup-check.sh >> /var/log/campusos/backup-check.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:?set BACKUP_DIR to the directory scripts/backup.sh writes to}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"

fail() {
  echo "[$(date -u +%FT%TZ)] backup-check FAILED: $*" >&2
  exit 1
}

[ -d "$BACKUP_DIR" ] || fail "backup dir does not exist: $BACKUP_DIR"

# The newest encrypted dump by modification time. stat is -c on GNU, -f on BSD.
newest=""
newest_mtime=0
while IFS= read -r -d '' f; do
  m="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")"
  if [ "$m" -gt "$newest_mtime" ]; then
    newest_mtime="$m"
    newest="$f"
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'campusos-*.dump.gpg' -print0)

[ -n "$newest" ] || fail "no campusos-*.dump.gpg in $BACKUP_DIR (the nightly backup never ran, or writes elsewhere)"

now="$(date -u +%s)"
age_s=$(( now - newest_mtime ))
max_age_s=$(( MAX_AGE_HOURS * 3600 ))
age_h=$(( age_s / 3600 ))

if [ "$age_s" -ge "$max_age_s" ]; then
  fail "latest dump $(basename "$newest") is ${age_h}h old (>= ${MAX_AGE_HOURS}h); the nightly backup has not produced a fresh dump"
fi

echo "[$(date -u +%FT%TZ)] backup-check ok: $(basename "$newest") is ${age_h}h old (< ${MAX_AGE_HOURS}h)"
