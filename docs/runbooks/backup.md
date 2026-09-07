# Backup and restore

What to back up, how, where to, and how to restore. Two things hold the state that
cannot be rebuilt: the Postgres database (`campusos`) and the media directory
(`MEDIA_DATA_DIR`, Lost & Found photos). Everything else (code, tenant configs) is
in git; `.env` is documented by `.env.example` and is NOT in these backups (keep it
in your secret store).

The database holds student PII. Treat every dump as sensitive: encrypt it before it
leaves the box, and send it only to a target you control (a second host or volume,
never a third-party bucket without encryption). No paid service is required: an SSH
target and `rsync` are enough.

## 0. One-time setup

On the backup target (a host or volume you control), create the destination and a
key:

```bash
# On the app host: a GPG keypair whose PUBLIC key encrypts the dumps. Keep the
# PRIVATE key OFF the app host (on the restore operator's machine or a vault), so a
# compromise of the app host cannot read old backups.
gpg --quick-generate-key "campusos-backup <ops@your-domain>" default encrypt never
gpg --armor --export campusos-backup > /root/campusos-backup.pub   # ship to app host
gpg --import /root/campusos-backup.pub                              # on the app host

sudo mkdir -p /srv/campusos-backups
sudo chown "$USER":"$USER" /srv/campusos-backups
sudo chmod 700 /srv/campusos-backups
```

Set the variables the script below uses (in the cron environment or a sourced file):

```bash
DATABASE_URL=postgres://USER:PASS@localhost:5432/campusos   # read access is enough
MEDIA_DATA_DIR=/srv/campusos-data/media
BACKUP_DIR=/srv/campusos-backups
BACKUP_RECIPIENT=campusos-backup            # the GPG key id/uid
BACKUP_REMOTE=backup@backup-host:/backups/campusos   # rsync/ssh target you control
```

## 1. The nightly script

`scripts/backup.sh` is not shipped (it depends on your host paths); create it from
this. It writes a compressed custom-format dump, encrypts it, mirrors the media
tree, rsyncs both off-box, and prunes local copies older than 14 days.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?}"; : "${MEDIA_DATA_DIR:?}"; : "${BACKUP_DIR:?}"
: "${BACKUP_RECIPIENT:?}"; : "${BACKUP_REMOTE:?}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/campusos-$stamp.dump"

# 1. Database: custom format (-Fc) is compressed and restores selectively.
pg_dump "$DATABASE_URL" -Fc -f "$dump"
# 2. Encrypt at rest, then drop the plaintext dump.
gpg --yes --encrypt --recipient "$BACKUP_RECIPIENT" "$dump"
rm -f "$dump"
# 3. Media: a mirror (delete removes files gone from the source).
rsync -a --delete "$MEDIA_DATA_DIR"/ "$BACKUP_DIR/media"/
# 4. Off-box, over SSH.
rsync -az --delete "$BACKUP_DIR"/ "$BACKUP_REMOTE"/
# 5. Prune local encrypted dumps older than 14 days (the remote keeps its own).
find "$BACKUP_DIR" -name 'campusos-*.dump.gpg' -mtime +14 -delete
echo "backup ok: campusos-$stamp.dump.gpg + media"
```

Make it executable and run it nightly (03:30, after the Lost & Found expiry at
03:20 so a night's cleanup is captured):

```cron
30 3 * * * cd /srv/campusos && ./scripts/backup.sh >> /var/log/campusos/backup.log 2>&1
```

Watch `/var/log/campusos/backup.log`; a non-zero exit (the script is `set -e`)
leaves a visible error. Alert on "backup ok" not appearing, not just on errors.

## 2. Restore

To restore onto a fresh host (disaster recovery) or into a scratch database (the
drill below):

```bash
# 1. Decrypt the chosen dump (needs the PRIVATE key, off the app host).
gpg --decrypt campusos-STAMP.dump.gpg > /tmp/campusos.dump
# 2. Restore into a target database. --clean --if-exists makes it repeatable.
#    Create the DB first if it does not exist: createdb campusos_restore
pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" /tmp/campusos.dump
rm -f /tmp/campusos.dump
# 3. Re-apply the role grants (the dump does not carry the app-role split cleanly).
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db-grants.sql
# 4. Media: copy the tree back into place.
rsync -a "$BACKUP_REMOTE"/media/ "$MEDIA_DATA_DIR"/
```

`--no-owner` restores objects as the connecting role; run the restore as the
`campusos_owner` role (the schema owner) so ownership and RLS line up, then step 3
re-grants the app role. After a real restore, run the post-deploy verification SQL
in `docs/overnight/REPORT.md` (FORCE state, definer EXECUTE, journal parity) to
confirm the security posture survived.

## 3. Restore drill (run once on setup, then quarterly)

A backup you have never restored is a guess. Do this once when you set backups up,
and on a schedule after:

```bash
createdb campusos_restoretest
TARGET_DATABASE_URL=postgres://USER:PASS@localhost:5432/campusos_restoretest
# Run the decrypt + pg_restore from section 2 against campusos_restoretest.
# Then sanity-check it against production counts:
psql "$TARGET_DATABASE_URL" -c "select
  (select count(*) from users) as users,
  (select count(*) from tenant_memberships) as memberships,
  (select count(*) from posts) as posts;"
dropdb campusos_restoretest
```

The counts should be within a night of production. If `pg_restore` reports errors
other than "already exists" (harmless with `--clean --if-exists`), the dump is not
usable: stop and fix the backup before relying on it.

> NOTE: This drill has NOT been run in the development environment for this
> document (no local Postgres client tools or Docker, and production is not touched
> from here). Run it once by hand on first setup, per the steps above, before
> trusting the backups. The commands are the standard `pg_dump -Fc` /
> `pg_restore` pair; the only project-specific step is re-applying
> `scripts/db-grants.sql` after a restore.

## 4. What is and is not covered

- **Covered:** all tenant data and PII in `campusos`, and every Lost & Found photo.
- **Not covered (by design):** `.env` / secrets (keep in your secret store), the
  code and tenant configs (git), and anything derivable (the karma cache rebuilds
  via `pnpm communities:karma:recompute`; search indexes rebuild from their source).
- **Rotation:** local keeps 14 days; give the remote its own longer retention
  (e.g. weekly snapshots kept for a quarter) on the target host.
