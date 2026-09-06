# Runbook: cleaning up expired direct messages

A conversation can be **disappearing**: its messages expire either 24 hours after
sending, or a short grace after the recipient first views them. Read queries
already hide anything past its `expires_at`; this sweep **hard-deletes** the
expired rows so they do not linger in the table.

Nothing deletes by itself. The sweep is a script you schedule.

## What it does

`scripts/messages-cleanup.ts` deletes every message in one tenant whose
`expires_at` has passed. It prints how many it removed and changes nothing else.
It runs with no actor in the tenant context; a DELETE policy (messages migration 0002) admits only already-expired rows, so it cannot remove anything that has not
expired, and never reaches another tenant. Running it twice is harmless.

## How to run it

```bash
pnpm messages:cleanup -- --tenant lgu
```

Only needed once a tenant has direct messages enabled AND some conversation uses a
disappearing mode (the default is `never`, which never expires). It needs
`DATABASE_URL` for the application role; it does not need the migration role.

## Scheduling

Run it often — every 15 minutes — so an after-viewing message is gone soon after
its grace, not hours later. A crontab line for LGU:

```cron
*/15 * * * * cd /srv/campusos && pnpm messages:cleanup -- --tenant lgu >> /var/log/campusos/messages-cleanup.log 2>&1
```

Add one line per tenant that has the module enabled. Schedule it the way the
ingestion cron runs (`scripts/cron-ingest.sh`).

## Rollback

There is nothing to roll back: the sweep only deletes rows already past their
`expires_at`, which are already invisible to everyone. To stop new messages from
expiring, set a conversation's disappearing mode back to "never" (the messages UI,
or `setEphemerality`); already-stamped `expires_at` values still run their course.
