# feat(notifications): instrument notification click-through

Run 6, block D. Block D is on hold: the decision (does the notification surface earn more
investment?) waits on data. This PR stands up the instrumentation so a week of
click-through data can accrue before that decision, and nothing else. No behavior a user
notices changes.

## What

- `packages/modules/notifications/drizzle/0001_notification_clicked_at.sql` + schema —
  `notifications.clicked_at` (nullable timestamptz). Additive; existing rows read back as
  never-clicked.
- `packages/modules/notifications/src/inbox.ts` — `recordClick(actor, tenant, id)`: stamps
  `clicked_at` (and marks the row read) the first time the recipient follows a
  notification. Own row only, by the existing RESTRICTIVE own-row policy; idempotent, so
  the metric counts recipients who clicked, not raw clicks.
- `apps/web/app/api/notifications/route.ts` — the existing notifications endpoint gains a
  `click` action (discriminated union alongside `read`); same gate, same own-row RLS.
- `apps/web/app/_components/notifications/notification-link.tsx` — a client wrapper that
  fires a fire-and-forget `keepalive` beacon on click, then navigates. Failure is silent;
  it never delays or blocks the click.
- `apps/web/app/u/[slug]/notifications/page.tsx` — each inbox row uses `NotificationLink`.

## Data & migration impact

Notifications migration `0001_notification_clicked_at` adds one nullable column. No policy
change (the write reuses the own-row update path `markRead` already uses). Rollback: drop
the column. Backwards compatible.

## How the metric is read (after a week)

Click-through rate over a window, per tenant, is a plain aggregate over the column, e.g.:

```sql
select count(*) filter (where clicked_at is not null)::float / nullif(count(*), 0) as ctr
from notifications
where tenant_id = $1 and created_at > now() - interval '7 days';
```

No cross-user report is built here (that would need a definer for an aggregate over a FORCE
table); the query above is run by an operator against the DB. No PII is recorded: the
stamp is a timestamp on the recipient's own row, nothing about the target or the click
beyond that it happened (CLAUDE.md 8).

## Security review (CLAUDE.md 6, 8)

`clicked_at` is a self-reported UI metric on the user's own row, not an authorization
input, so there is no §8 surface. The write is an own-row UPDATE admitted by the existing
RESTRICTIVE own-row policy; no new policy, definer, or grant. The click endpoint is
same-origin + rate-limited + authenticated like the existing read action.

## Tests / verification

`turbo run typecheck lint` passes for notifications and web; the full web vitest suite
(134) passes. A notifications integration test (split-only, in CI) asserts a click is
recorded once, marks the row read, is idempotent, and is refused on another user's row.

## Follow-ups

- The decision itself (block D) is deliberately deferred until a week of `ctr` exists.
- The same tracked-link pattern can back the empty-state CTA metric in
  `docs/design-empty-states.md` (block B) if that metric is wired up later.
