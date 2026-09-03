# feat(identity): activity timing on the dashboard, and no column for an address

Targets `main`. Platform admin **Phase 3** of `docs/design-platform-admin.md`.
Timing only: when people signed in and when they were last seen, aggregated.
Nothing here records, reads, or displays where anyone was, and after this PR the
schema has no column that could.

## What

**Two marks on `users`.** `last_login_at` (new) is set when a session is issued.
`last_seen_at` already existed and was never written; the hourly session `touch`
now moves it too, at most once an hour, so "active this week" is one cheap read.
Both are written inside the same transactions that already existed.

**`ip_hash` is gone.** `sessions.ip_hash` was written at sign in and never shown;
`audit_log.ip_hash` was never written. The migration drops both, `issueSession`
no longer accepts one, and `requestFingerprint` keeps the user agent alone. A
field that must never be displayed is better absent.

**Dashboard** (`/admin/analytics`, `view-analytics`), above the timetable
figures:

- People: members, active today, this week, this month.
- Sign-ins, last 14 days: a small two-series bar chart, sign-ins and last seen
  per day in the tenant's timezone, with every day's numbers as text for a
  screen reader and a legend.
- Members by role, and the verification queue: how many are waiting and how
  long the oldest has waited.

**Member list** (`/admin/members`): each member carries a coarse activity line,
"Active today", "this week", "this month", "Not active lately", or "Never signed
in". A bucket, never a timestamp.

## How the reads stay narrow

`users` and `sessions` are visible only to their owner, and a tenant
administrator is not that owner. So the reads go through three `SECURITY
DEFINER` functions in `0011_activity_timing.sql`, each answering for one tenant:

| Function                                            | Returns                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `auth_tenant_activity_totals(tenant)`               | members, active in last day / 7 days / 30 days       |
| `auth_tenant_activity_days(tenant, days, timezone)` | per day: sign-ins, members last seen, zeros kept     |
| `auth_tenant_member_activity(tenant)`               | per member: `day`, `week`, `month`, `older`, `never` |

None returns a timestamp of anyone in particular. They read `users`, `sessions`
and `tenant_memberships`, all of which are already NO FORCE for the resolver
and permission functions; the FORCE invariant test is unchanged and still
passes. The application checks `view-analytics` (or `manage-members`, for the
bucket) inside the transaction before calling any of them, as `rbac.ts` does for
its own definer function.

New module export `@campusos/module-identity/analytics`: `tenantActivity(actor,
tenant, { days, timezone })` returning totals, the day series, members by role
(a tenant-context query over `roles` and `membership_roles`), and queue stats
(a tenant-context query over `verification_requests`).

## Data & migration impact

`packages/modules/identity/drizzle/0011_activity_timing.sql`:

- `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz`
- `ALTER TABLE sessions DROP COLUMN IF EXISTS ip_hash`
- `ALTER TABLE audit_log DROP COLUMN IF EXISTS ip_hash`
- the three functions above, `REVOKE … FROM PUBLIC`, `GRANT EXECUTE … TO campusos_app`

Backwards compatibility: the new column is nullable; the code in this PR stops
writing `ip_hash` before the column goes, and the migration runs **after** the
deploy as usual, so no running code references a missing column. The standing
step, human-run:

```
pnpm db:migrate:all
```

Rollback, if ever wanted:

```sql
alter table sessions add column ip_hash text;
alter table audit_log add column ip_hash text;
alter table users drop column last_login_at;
drop function if exists auth_tenant_activity_totals(text);
drop function if exists auth_tenant_activity_days(text, int, text);
drop function if exists auth_tenant_member_activity(text);
```

(The re-added columns come back empty; the hashes they held are not recoverable
and are not meant to be.)

## Tests

- Unit: `scaleToPercent` (scales to the maximum, keeps a small day visible as a
  sliver, all zero stays zero, empty stays empty). `pnpm turbo run typecheck
lint test`: 23 tasks green (web 70, identity 47, core 33, timetable 56,
  adapter 12).
- Integration (identity suite, in CI against the split database): issuing a
  session stamps both marks; resolving it two hours later moves last seen and
  leaves last login; a second resolve within the hour writes nothing; the
  dashboard totals, the 14-day series, members by role and the empty queue come
  out right for an administrator and carry no handle or email; a student is
  refused; one tenant's activity never reaches another and its admin is refused
  there; the member list carries `day` for the signed-in member and `never` for
  the admin and no field mentioning "seen"; **`information_schema` has no
  `ip_hash` column anywhere**.
- e2e: unchanged; the analytics 404 without permission is already covered.
  `pnpm --filter web test:e2e`: 64 passed against a production build;
  `pnpm --filter web build` clean.
- Browser (local dev server, a minted administrator): `/admin/analytics` shows
  People with the three active cards, the 14 day chart whose last day reads
  "2 sign-ins, 1 last seen" for the two sessions minted today, the legend,
  Members by role, and the queue card in its empty state; `/admin/members`
  reads "Active today" for the administrator and "Never signed in" for the
  member who has no session.

## Verification steps

1. Deploy, then `pnpm db:migrate:all`.
2. Sign in, open `/admin/analytics`: People shows the member count and yourself
   as active today; the chart shows today's sign-in; Members by role and the
   queue card render.
3. `/admin/members`: your own row reads "Active today"; a member who has never
   signed in reads "Never signed in".
4. `select column_name from information_schema.columns where column_name =
'ip_hash'` returns nothing.

## Follow-ups

- The day series counts members by their single last seen day, which is honest
  for the recent past and thins out further back; a true daily active series
  would need a per-day activity table, which the design's privacy line rules
  out for now.
- `TOUCH_AFTER_MINUTES` (60) bounds how fresh "active today" is; fine for a
  dashboard.
- Phase 4 (tenant config file → database, super-admin tenant CRUD) is next.
