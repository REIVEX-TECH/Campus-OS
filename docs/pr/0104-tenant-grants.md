# feat(identity): cross-tenant platform administration as an audited grant (Phase 5A)

The security core of Phase 5, with the corrected containment. A platform
administrator may, for a stated reason and a short while, act as ONE named
university's administrator — breadth, never depth — and every property that
makes that safe is a database mechanism, not an application convention.

**This is the security core only. No admin surface runs under a grant yet** —
on the bare connection pool the resolver still returns nothing for a platform
admin, so every surface stays 404 until Phase 5B opens them deliberately, one
granted transaction at a time.

## The definer functions you asked to see at merge

The full SQL is `packages/modules/identity/drizzle/0018_tenant_grants.sql`. The
two that carry the guarantee:

**`auth_open_tenant_grant`** — entering a tenant and logging it are one
statement. It validates platform-admin + a live session + the tenant, closes any
lapsed grant, enforces one-open, writes the opening audit line, creates the
grant row (its `audit_id` is a NOT NULL FK to that line, so a grant that was
never logged cannot exist), and calls assume — atomically. Any failure rolls the
whole thing back and no context was set.

**`auth_assume_tenant_grant`** — re-enters an open grant for one transaction. It
finds the live grant by the acting user and their session, refuses to layer over
a different tenant context, writes the `platform_grant_uses` row stamped with
`pg_current_xact_id()`, then sets `app.tenant_id`. That use row is the
unforgeable proof the rest of the system keys on.

**`auth_grant_admin_for_txn`** — returns the grant's administrator for the
current transaction id, read through the use row. The self-elevation check keys
on THIS, never on `app.user_id` (see Security).

**`auth_effective_permissions`** gains one UNION branch: a platform admin with a
use row for this transaction resolves to the tenant's own `tenant_admin` set
**minus `communities.unmask`**. The membership branch is byte-unchanged, so a
resident, a stranger and a suspended member resolve exactly as before.

## Security — and the two holes the review found in the first draft

This design was rebuilt after an adversarial review broke the previous one and
then broke this one's first draft. Both breaks were the same class — a security
decision keyed on a setting the application can write — and both are fixed:

1. **The prior design keyed "am I under a grant" on `app.grant_use`, a GUC the
   app can clear** to switch the subtraction off. Fixed: it now keys on a
   `platform_grant_uses` row for the current transaction id, read through a
   SECURITY DEFINER over a table the application has no write on. Clearing a GUC
   changes nothing.

2. **This draft's self-membership check compared `NEW.user_id` to
   `current_setting('app.user_id')`** — also forgeable: an attacker re-sets
   `app.user_id` after the use row is written, so `self != decoy` passes and they
   self-promote to a permanent `tenant_admin` that outlives the grant. Fixed: the
   check now compares `NEW.user_id` to `auth_grant_admin_for_txn()`, the
   administrator derived unforgeably from the use row. Verified against a live
   `app.user_id` swap: the function still returns the real admin.

**The containment, keyed on the unforgeable row:**

- Under a grant, the visitor may not write their OWN membership or role
  assignment (the one move that would outlive the grant). They may still manage
  OTHER members, because that is what acting as the tenant's admin means.
- Under a grant, the platform-level tables a resident admin cannot touch —
  `roles`, `role_permissions`, `role_templates`, `role_template_permissions`,
  `tenant_configs`, `universities` — are withdrawn by RESTRICTIVE policies.
  `platform_roles` is absent from that list because 0016 already made it
  unwritable by the application under any context.
- The grant row takes exactly one write after creation, its revocation: a
  BEFORE UPDATE trigger freezes every other field and forbids un-revoking, so an
  expiry can never be pushed back, even by a definer. Extending access is a new
  grant, a new reason, a new line.
- One open grant per administrator, race-proof (a partial unique index, not a
  check-then-insert).
- Every audit row written inside a granted transaction is stamped with the grant
  by a BEFORE INSERT trigger, derived from the use row — so the eight raw-SQL
  audit writers and `communities_unmask` are covered without touching them, and
  the caller cannot forge the stamp.

**One pre-existing hole this does NOT close, flagged as the next PR.** Membership
and role writes are authorised at the database only by tenant scope
(`memberships_insert` and `membership_roles_in_tenant` check `tenant_id`, not the
actor). So a caller who sets a bare foreign tenant context WITHOUT a grant, via
raw SQL as the app credential, could self-insert a `tenant_admin` membership —
independent of Phase 5, and contrary to CLAUDE.md §4. In 5A the only code path
that sets a foreign-tenant context is `withPlatformGrant`/`withGrantedTenant`,
which always write the use row and so always trigger the subtraction; the bare
path requires the app credential (app compromise). Closing it at the database
means routing membership/role writes through definers, as 0016 did for
`platform_roles` — a self-contained change I recommend as the next PR. Details
in Follow-ups.

## Authentication is the session, not a secret

Granted access is driven from the platform host, where `/u/{slug}/...` already
renders the tenant surface with the administrator's own resolved session
(`planRoute` returns `{next, slug}` there). The grant is bound to that
`session_id`, so signing out ends every visit and there is no second credential
to carry, leak, or strand — which is why there is no grant cookie or secret.

## Tests

Split-database integration (the identity isolation suite is CI-only):

- Opening a grant resolves, inside a granted transaction, to the tenant_admin
  set including `manage-members`/`manage-roles`/`restrict-members` and NOT
  `communities.unmask`, and writes exactly one `platform.tenant_grant_opened`
  line.
- The same platform admin resolves to the empty set on the bare pool.
- **Self-promotion is refused even when `app.user_id` is forged mid-transaction**
  (the critical the review found), for both the membership and the role-assignment
  halves, and nothing sticks.
- The withdrawn powers raise on INSERT (`roles`, `tenant_configs`, `universities`)
  and, for the silent UPDATE case the review flagged, the **row count is asserted
  zero** rather than `rejects.toThrow` (a RESTRICTIVE `USING` on UPDATE filters
  silently, so `toThrow` would pass vacuously).
- One-open is enforced; the holder closes and another platform admin revokes
  while a stranger cannot; a revoked grant cannot be re-entered.
- The application can neither write the grant table nor read the uses table.
- The FORCE-invariant map gains both grant tables (`false`, with the reason), so
  a stray FORCE — which would fail the subtraction OPEN — is caught.

`pnpm turbo run typecheck lint test`: 26 tasks green. Communities integration 44
passed, timetable 39, db 4 (local unsplit). `pnpm --filter web test:e2e`: 86
passed (one known `timetable.spec.ts` cold-start flake, green on rerun of that
file). Build clean. The grant lifecycle was also verified end to end by probe on
the dev database (open, resolve-minus-unmask, stamp, bare-pool-empty, one-open,
revoke+reopen, expiry-push-blocked, and the unforgeable-admin check across a GUC
swap).

## Verification steps

Run the migration (below). On a split database: as a platform admin, open a
grant into a tenant and confirm one `platform.tenant_grant_opened` line; inside
the granted transaction confirm the resolver returns tenant_admin minus
`communities.unmask`; confirm a self `tenant_memberships` insert is refused even
after re-setting `app.user_id`; confirm a second concurrent open is refused;
revoke and confirm re-entry fails. On the bare pool, confirm the platform admin
resolves to nothing.

## Migration notes

`packages/modules/identity/drizzle/0018_tenant_grants.sql`, applied by
`pnpm db:migrate:all`. Additive: two tables, one resolver replacement, one audit
trigger, one grant-immutability trigger, and the RESTRICTIVE subtraction
policies; no data changes. The privilege lock (`REVOKE INSERT/UPDATE/DELETE on
platform_tenant_grants`, `REVOKE ALL on platform_grant_uses` from `campusos_app`)
applies only on a split database and is skipped with a warning on an unsplit one
— so it is real only where the roles are split, which the invariant test and CI
enforce. Rollback: drop the two triggers, the subtraction policies, the grant
functions, restore `auth_effective_permissions` from 0014's body, and drop the
two tables. Your step on the live database.

## Breaking changes

None. `auth_effective_permissions` keeps its signature and its result for every
existing caller. New exports `withPlatformGrant`, `withGrantedTenant`,
`PlatformGrant` from `@campusos/db`.

## Follow-ups (in priority order)

- **Next PR — membership/role writes behind a definer.** Close the pre-existing
  tenant-scope-only authorisation on `tenant_memberships` and
  `membership_roles`, the same way 0016 closed `platform_roles`: revoke the
  app's direct writes and route them through audited definers that check real
  authority. This makes 5A's property 4 hold on the bare path too, not only the
  grant path, and satisfies CLAUDE.md §4.
- Phase 5B: restructure the platform-admin surfaces to run inside granted
  transactions, with a minimum-remaining-time preflight, a typed redirect on the
  42501 an expired grant raises mid-request, an explicit `statement_timeout` on
  granted transactions, and a visible countdown. Wire `auth_tenant_grants_for_tenant`
  (defined here) into the tenant's admin view so a university can read who visited.
- Retention: `platform_grant_uses` grows one row per granted request. A prune
  function and a schedule are a 5B concern; recorded here so the table's growth
  is a decision, not a surprise.
- The `platform.tenant_grant_opened` line is stamped with a NULL grant id (the
  use row does not exist yet when it is written); the grant-activity view unions
  it back by `target_id`. Documented, not a code change.
