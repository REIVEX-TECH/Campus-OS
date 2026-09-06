# fix(identity): move verification-request PII to an own-row side table

The composed §6 review's RLS Medium **M1**: `verification_requests.requests_read`
(0009) is tenant-wide (`user_id = app.user_id OR tenant_id = app.tenant_id`), and
the row also held `full_name`, `roll_number` and `note` — a student's
government-checkable identity, readable by anyone the application placed in the
tenant's context, gated only by `listPendingRequests` remembering to check
`approve-verifications`. No in-tree query reads them un-gated today, but §4 is
explicit: RLS is the boundary, application filtering never the guarantee.

## What (migration 0030)

The PII moves to a new 1:1 table, **`verification_request_details`**
(`full_name`, `roll_number`, `note`):

- **own-row RLS** for the requester (read + insert their own, nobody else's),
  keyed on `app.user_id` — their own low-stakes data, the `user_recents` shape;
- **NO FORCE**, so the two owner-run definers below read/purge across the tenant
  while the application role (a non-owner) stays confined to its own row — the
  `tenant_memberships` / `users` pattern;
- admin reads **only** through `auth_pending_verification_requests(p_tenant_id)`,
  a `SECURITY DEFINER` gated on `approve-verifications` via
  `auth_effective_permissions` (membership for a resident admin, the unforgeable
  grant use-row for a platform admin under a grant — CLAUDE.md 8), returning the
  handle from `public_profiles`, never an email;
- purge is automatic: a `SECURITY DEFINER` trigger deletes the detail row the
  moment its request leaves `pending` (decided or superseded), so the PII cannot
  outlive its one job — the guarantee `decideRequest` used to make by nulling the
  columns, now enforced in the database and unforgettable.

Existing rows with live PII are copied before the columns are dropped from
`verification_requests` (the migration briefly drops `FORCE` for the copy, since
`campusos_owner` is `NOBYPASSRLS`, and restores it in the same transaction).

## Data & migration impact

`0030_verification_request_details.sql`: new table + own-row RLS + trigger +
admin definer, data copied, then `full_name` / `roll_number` / `note` dropped
from `verification_requests`. Journal `idx 30`. Two new public definers, both in
the `DEFINER_INTENT` map: `auth_pending_verification_requests` (app),
`verification_request_details_purge` (owner, revoked by name). **Not backwards
compatible at the column level** (the columns are gone), but no application code
reads them off the request row — `PendingRequest` is unchanged, sourced now from
the definer. Rollback: re-add the columns and copy back from the detail table
(the detail rows for pending requests still hold the values).

## §6 (concrete SQL)

- The admin definer runs in the caller's tenant context; it reads
  `verification_requests` via the existing tenant policy and joins the NO-FORCE
  detail table via owner-bypass, and returns nothing to a caller without
  `approve-verifications` — no enumeration, no email, no cross-tenant read.
- Own-row RLS means a peer placed in the tenant's context reads none of another
  user's details (asserted in a new test; the suite runs only on a split DB).
- The purge trigger is `SECURITY DEFINER` (owner) so it deletes regardless of who
  changed the status; owner-only, EXECUTE revoked from `campusos_app` by name.

## Tests

`packages/modules/identity/test/isolation.integration.test.ts`:

- new: PII is not a column on the request row; a peer in the tenant context
  cannot read another user's details; the requester reads their own; a gated
  admin reads it through the definer.
- updated: the approve/reject cases now assert the **detail row is purged** (not
  a nulled column); the FORCE-invariant map includes the new NO-FORCE table.

`packages/modules/communities/test/communities.integration.test.ts`:
`DEFINER_INTENT` gains the two new definers.

```bash
pnpm -C packages/modules/identity test:integration
pnpm -C packages/modules/communities test:integration
```

Typecheck, lint, journal parity verified locally; the isolation + DEFINER_INTENT
suites run in CI (split Postgres + RLS).

## Follow-ups

- **M2** (next PR, scoped and reported first): the same side-table pattern for
  `tenant_memberships.standing_reason` / `appeal_note` (+ `verification_method`
  if warranted), which is read across modules — the cross-module readers are
  mapped before building.
- A bridge CI test (with the Lows PR) asserting no code outside the gated readers
  selects M2's columns, so its residual window is guarded, not remembered.
- Lows L1–L5 + the `db-grants` default-privileges comment.
- Then the doc rewrite (`design-platform-admin.md` + status doc).
