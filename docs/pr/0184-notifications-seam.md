# feat(notifications): a module that owns the table and a generic emit seam

Block A item 2, part 1. A new `packages/modules/notifications` takes ownership of the
shared `notifications` table (created by communities) and adds a generic
`notify(tenant, userId, kind, payload, link)` seam so any module can emit, not just
communities. This PR is the module + the ownership transfer; the bell/inbox wiring
and the per-module emitters follow.

## What

- **Ownership transfer** (`drizzle/0000_notifications_seam.sql`, DDL only, existing
  rows untouched): adds `payload jsonb` and `link text`, relaxes `community_id` to
  nullable, and adds the generic `notifications_emit` definer. RLS is unchanged
  (tenant isolation + RESTRICTIVE own-row; the app still has no INSERT). This module
  now owns future changes to the table; it runs after communities in migrate-all
  because it ALTERs a table communities creates.
- **`notify()` / `notifyInTx()`** (`src/notify.ts`): one call to tell a member
  something happened; the row is written by the definer under the caller's tenant
  (from the GUC), for an explicit recipient, dropping self-notifications.
- **Inbox reads** (`src/inbox.ts`): `unreadCount` (every unread row, kind-agnostic,
  for the bell), `listGenericInbox` (the generic link-bearing notifications), and
  `markRead`.
- Wired into `migrate-all` (after communities), the workspace, and the communities
  DEFINER_INTENT audit (`notifications_emit: 'app'`).

Communities is untouched: its `communities_notify` and rich inbox render stay as they
are; it simply shares the now-generalised table.

## Data & migration impact

New module + one DDL migration on the existing `notifications` table (additive
columns, one dropped NOT NULL). No data change. `pnpm-lock.yaml` updated for the new
workspace package.

## Security review (CLAUDE.md 6, 8)

- The app cannot INSERT `notifications`; the only writer is a SECURITY DEFINER.
  `notifications_emit` keys the row's tenant on the GUC (isolation, its job), takes an
  explicit recipient the caller legitimately holds, and records the actor. A
  notification is data, not a privilege decision, so `app` EXECUTE is correct
  (mirrors `communities_notify`). REVOKE FROM PUBLIC + by-name GRANT to the app role.
- The ownership migration changes no existing row and preserves the RLS.

## Tests

`test/notifications.integration.test.ts` (CI Postgres+RLS): emit + own-row read,
another member sees nothing, self-notification dropped, a raw app INSERT is refused,
and the kind-agnostic unread count + mark-read. Module typecheck and lint pass;
communities typecheck passes.

## Follow-ups

The bell (ungated, counts all) + inbox generic section, and the per-module emitters
(L&F, marketplace, services, messages), are the next two Block A PRs.
