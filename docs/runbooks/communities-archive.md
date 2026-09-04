# Runbook: archiving idle communities

A community nobody has posted in for a long while goes read only: it stays
visible with its posts, nothing can be added, and a tenant administrator can
reopen it from `/admin/communities`.

Nothing archives by itself. The sweep is a script you schedule.

## What it does

`scripts/communities-archive.ts` archives every live community in one tenant
whose newest live post is older than the window and which was created before
the window. It prints the slugs it archived and changes nothing else. Running
it twice is harmless.

## How to run it

```bash
pnpm communities:archive -- --tenant lgu --months 6
```

Use the tenant's `archiveAfterMonths` from its communities settings as the
number of months; a tenant that leaves it null has chosen not to archive, so
do not schedule the sweep for it.

Schedule it the way the ingestion cron runs (`scripts/cron-ingest.sh`), once a
day is plenty. It needs `DATABASE_URL` for the application role; it does not
need the migration role.

## Reopening

`/admin/communities` lists archived communities with a Reopen control for
anyone holding `communities.oversee`; the change lands in the audit log as
`communities.reopened`. Archiving one by hand from the same page logs
`communities.archived`.

## Rollback

There is nothing to roll back: archiving sets `communities.archived_at`, and
reopening clears it.
