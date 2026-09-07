# feat(marketplace): reporting and moderation

Marketplace is user-to-user, so reporting + a moderator queue ship with it
(CLAUDE.md 8), before it is enabled for any tenant. Same shape as Lost & Found.

## What

- Migration `0002_marketplace_moderation.sql`: `mkt_reports` (own-insert/own-read
  RLS, **NO FORCE** so the owner-run definers read across reporters); grants
  `marketplace.moderate` to the `tenant_admin` template and backfills system roles;
  two SECURITY DEFINERs gated on `marketplace.moderate` via
  `auth_effective_permissions`: `auth_mkt_report_queue` (the queue) and
  `auth_mkt_resolve_reports` (resolve). Both `REVOKE ... FROM PUBLIC` then
  `GRANT EXECUTE ... campusos_app`.
- Service (`moderation.ts`): `reportTarget` (idempotent per reporter), the queue,
  `dismissReports`, and `removeListing` (moderator: status -> removed, resolve
  reports, and delete the listing's photo rows + files).
- API: `POST /api/marketplace/reports` and `POST /api/marketplace/moderation`
  (remove | dismiss; remove deletes the photo files). UI: a Report control on the
  listing detail and a moderator queue at `/u/[slug]/marketplace/mod`.
- Registered the two definers in the global `DEFINER_INTENT` registry (both `app`)
  and applied the marketplace migrations in the communities integration setup, so
  the definer-hygiene test sees them.

## §6 review (concrete SQL)

Reviewed against the migration as written. `mkt_reports` is own-row on
`app.user_id` + tenant (NO FORCE) so the two owner-run definers can read/resolve
across reporters; the app role stays confined to its own rows. Both definers
`RAISE` on no actor, self-gate on `marketplace.moderate` (membership for a resident
admin, or the grant use-row for a platform admin under a grant), `SET search_path`,
and are revoked from PUBLIC and granted only to `campusos_app`. No decision keys on
a forgeable GUC for privilege: the permission check is the gate, read through
`auth_effective_permissions`. Mirrors the L&F `0002` that already passed §6.

## Tests

Integration: a report queues for a moderator only (empty for a non-moderator);
removal resolves the reports, sets `removed`, and drops the photo rows + returns
their keys; a non-moderator cannot remove; dismiss clears reports without removing.
Module + web typecheck, lint, no-dash, and a local build pass.

## Verification

Report a listing; a tenant admin sees it at `/marketplace/mod`, removes it with a
reason (the listing goes away, its photos are deleted) or dismisses it.

## Follow-ups

Enablement for LGU (with the policy pages, the profile listings tab, and the
nav-card flip) is the next and final Block 1 PR.
