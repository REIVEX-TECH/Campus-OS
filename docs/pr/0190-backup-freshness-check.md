# chore(ops): a backup freshness check for cron

Block A item 6. `docs/runbooks/backup.md` already describes the nightly
`pg_dump`/encrypt/rsync and the restore drill; the one gap was noticing when a
night produces no dump. A silent "backup ok" that stops appearing in a log is easy
to miss. This adds a small checker a second cron runs to turn that silence into a
non-zero exit.

## What

- **`scripts/backup-check.sh`** — finds the newest `campusos-*.dump.gpg` in
  `$BACKUP_DIR` (the local dir the nightly `scripts/backup.sh` writes and prunes)
  and exits non-zero, with a clear message, if it is missing or older than
  `MAX_AGE_HOURS` (default 26: the 24h dump cadence plus a 2h grace, so an on-time
  dump never trips and a single missed night does). Prints a one-line ok/fail with
  a UTC timestamp. `set -euo pipefail`, portable `stat` (GNU `-c` / BSD `-f`),
  matches the house style of `scripts/cron-ingest.sh`.
- **`docs/runbooks/backup.md`** — section 1 now points at the checker with a ready
  cron line. The rest of the runbook is unchanged and already matches main.

## Data & migration impact

No schema change. No application code touched. Ops tooling only.

## Tests

Not a unit-test surface (a shell script over the filesystem). Exercised by hand
across every branch: missing `BACKUP_DIR` env, non-existent dir, empty dir, a fresh
dump (ok), a 30h-old dump (fail), a stale-plus-fresh dir (newest wins, ok), and a
custom `MAX_AGE_HOURS` window — each returns the expected exit code and message. No
shellcheck gate exists in CI; the script carries no shellcheck suppressions.

## Verification steps

```bash
mkdir -p /tmp/bk && : > /tmp/bk/campusos-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg
BACKUP_DIR=/tmp/bk ./scripts/backup-check.sh            # -> backup-check ok, exit 0
touch -d '30 hours ago' /tmp/bk/campusos-*.dump.gpg
BACKUP_DIR=/tmp/bk ./scripts/backup-check.sh; echo $?   # -> FAILED, exit 1
```

## Follow-ups

The restore drill (runbook section 3) is still a human step by design — a backup
you have never restored is a guess, and it needs real Postgres client tools and an
operator's private GPG key, neither present in CI. Block A is complete after this.
