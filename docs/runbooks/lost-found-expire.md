# Runbook: expiring old Lost & Found items

An open lost-or-found item nobody resolved eventually falls out of the default
browse list. Past its window it becomes **expired**: it no longer appears in the
open list, but it is still viewable by direct link and in the reporter's
**My items**, where a one-tap **Keep it listed** button pushes the window out by
another full period.

Nothing expires by itself. The sweep is a script you schedule.

## What it does

`scripts/lost-found-expire.ts` sets `status = 'expired'` on every open item in
one tenant whose `expires_at` has passed. It prints how many it expired and
changes nothing else. Running it twice is harmless (an already-expired item is
no longer open, so it is not touched again).

The window itself is stamped at post time from the tenant's `expiryDays`
Lost & Found setting (default 90). Extending an item, from My items, resets the
window to another `expiryDays` from now.

The "expiring soon" badge shown on My items is computed live from `expires_at`
(within 7 days of the window closing), so it appears whether or not this sweep
has run. A push/email reminder is deferred with the shared notifications concern
(see `docs/overnight/DECISIONS.md`); the `expiry_notified_at` column is reserved
for that reminder's idempotency.

## How to run it

```bash
pnpm lostfound:expire -- --tenant lgu
```

Run it once a tenant has Lost & Found enabled. It needs `DATABASE_URL` for the
application role; it does not need the migration role.

## Scheduling

Schedule it the way the ingestion cron runs (`scripts/cron-ingest.sh`). Once a
day is plenty — a day's slack on a 90-day window is immaterial. A crontab line
that expires LGU's items every night at 03:20:

```cron
20 3 * * * cd /srv/campusos && pnpm lostfound:expire -- --tenant lgu >> /var/log/campusos/lostfound-expire.log 2>&1
```

Add one line per tenant that has the module enabled.

## Rollback

There is nothing destructive to roll back: the sweep only flips `status` from
`open` to `expired`. To bring an item back, the reporter extends it from My
items (which returns it to `open` with a fresh window), or an operator sets its
`status` back to `open` and gives it a future `expires_at`.
