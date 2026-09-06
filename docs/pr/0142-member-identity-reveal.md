# feat(identity): let an admin reveal a member's real identity (§6, §8)

Block 1.5a. A tenant admin can see a member's real identity — full name, roll
number, sign-in email — deliberately, one member at a time, every look audited.
Adds RLS + a SECURITY DEFINER + a privilege grant, so §6 (concrete SQL) applies.

## The gap this fills

The platform keeps no real identity after a decision: verification PII lives in
`verification_request_details` only while a request is pending and a trigger
purges it the moment it is decided (0030); `users` holds the sign-in email but no
name or roll number. So there is nothing to look up later — unless the name/roll
are **captured at verification, before the purge**. That is what this does.

## What (migration 0031)

- **`tenant_member_identity`** — the captured `full_name` + `roll_number`, 1:1 per
  member (PK `(tenant_id, user_id)`). RLS enabled, **NOT forced, and no
  application-facing policy at all**: db-grants blanket-grants table DML to the app,
  so RLS is the boundary, and with zero app policy the app role (a non-owner) is
  denied every row. The only reader is the owner-run reveal definer. No permissive
  tenant policy — a tenant-wide read would expose identity to any member in the
  tenant context.
- **Capture inside `auth_verify_member`** (re-defined; every verify path funnels
  through it). It copies the still-live pending verification detail into
  `tenant_member_identity` before `decideRequest` flips the status and the purge
  trigger fires — "copy before purge". A path that collected no name/roll (a domain
  self-verify) captures nothing; that member's reveal returns the live email with a
  null name/roll, which is the honest answer.
- **`auth_member_identity(p_tenant_id, p_target)`** — the reveal. SECURITY DEFINER,
  gated on the new `view-member-identity` through `auth_effective_permissions` (the
  unforgeable membership/grant resolver); not authorized → empty, no leak. The
  target must be a member of THIS tenant (no cross-tenant / non-member reveal).
  Every authorized reveal writes a `member.identity_viewed` audit line (ids only,
  no PII in meta). Reads `users.email` live (NO FORCE, 0004) and the handle from
  `public_profiles`. No bulk variant.
- **`view-member-identity`** added to the core `PERMISSIONS` catalogue (so it flows
  into `SYSTEM_ROLES.tenant_admin`) and to the `tenant_admin` role template +
  backfilled onto existing tenant_admin roles.

## §6 (concrete SQL)

- The reveal keys authorization on `auth_effective_permissions`, never a GUC or a
  bare tenant read; a caller without `view-member-identity` gets an empty set, and
  a target outside the tenant returns nothing (§8).
- The identity table is unreadable by the application role by construction: RLS on,
  no app policy, so every direct app read is denied — the owner definers (NO FORCE)
  are the only path, and the app is a non-owner. Pinned by the `row security
invariants` test (`tenant_member_identity: false`).
- `auth_member_identity` is app-callable and self-gating (declared `app` in the
  DEFINER_INTENT registry); `auth_verify_member` keeps its existing grant across
  the `CREATE OR REPLACE`.
- **Decision:** a platform admin under a live grant can reveal (it is not excluded
  like `communities.unmask`) — administrative tooling, fully audited by actor.
  Rationale and the one-migration flip to make it resident-only are in
  `docs/overnight/DECISIONS.md` and `docs/SECURITY-BACKLOG.md`.

## UI

- `/u/[slug]/admin/members`: a **Show identity** control (only for a holder of
  `view-member-identity`) reveals name / roll / sign-in email inline, with a Hide
  toggle; a member with no name on file shows just the email.
- New route `POST /api/admin/members/identity`, gated on `view-member-identity` via
  `tenantWriteContext`, tighter-rate-limited than a plain read.
- The members and verification explainers were corrected: they no longer claim "no
  email is shown", and the verification intro now says an approved request's name
  and number are kept as the member's identity (a rejected one's are discarded),
  and that every reveal is logged.

## Data & migration impact

Identity migration `0031_member_identity` (journal idx 31): one table, one new
definer, `auth_verify_member` re-defined to capture, and the permission grant +
backfill. Backwards-compatible; nothing to roll back beyond dropping the table and
reverting `auth_verify_member` to its 0019 body. Applies cleanly (verified locally
against the dev DB up to the split check).

## Tests

`isolation.integration.test.ts` gains a `member identity (reveal, 0031)` suite
(split DB): capture-before-purge on approval + reveal with the live email; email
only for a domain-verified member; a non-admin (and the member themselves) refused;
cross-tenant refused; a `member.identity_viewed` audit line per reveal with no PII;
and a direct app read of the table returning nothing. The FORCE-state invariant map
pins `tenant_member_identity` as NOT forced, and the DEFINER_INTENT registry gains
`auth_member_identity`.

```bash
pnpm -C packages/modules/identity test:integration
```

## Verification

```bash
pnpm --filter web build
```

- `/u/lgu/admin/members` as a tenant admin → each member shows **Show identity**;
  click reveals name/roll/email; a domain-verified member shows just the email.
- As a non-admin the control is absent, and the API 404s.

## Follow-ups

- Whether reveal should be resident-admin-only (exclude from the grant branch) —
  logged in the backlog with the exact flip.
- The `verified_at` / standing side-table work (M2) is unrelated and still queued.
