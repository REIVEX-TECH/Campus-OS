# feat(identity): verification requests and tenant admin approval

Targets `main`. Tenant admin scoped. No platform admin, no god mode: an admin
here is a membership row in one tenant and can see and touch only that tenant.

## What

- **Ask to be verified.** A signed in person off the university's email domain
  gives three things an admin can check against the university's records: full
  name, roll or registration number, an optional note. One open request per
  person per tenant (a partial unique index, so it cannot race), three per 30
  days. The account page shows the state of the latest request.
- **Approve, reject, or verify by hand.** At `{slug}.host/admin/verification`
  (and `/admin`, which sends a membership admin there) a tenant admin sees the
  queue with handles beside each request, never an email, and decides. Approval
  **creates a verified membership when none exists** (the gmail case, as your
  account proves) **and sets `verified_at` on an unverified one**; both paths are
  tested. A member can also be verified by handle without a request.
- **Details are purged on decision.** What a request leaves behind is its status,
  its timestamps and who decided; the row is never deleted, so the monthly limit
  has a memory.
- **First admins come from tenant config.** `adminEmails` in
  `tenants/lgu/tenant.config.ts`, git tracked. At sign in a listed verified
  address becomes a verified `tenant_admin`, an upgrade only. Set to
  `ahadnawaz585@gmail.com`; the LGU address goes in the same list when known.
  Documented in `DEPLOY-VPS.md` as moving to database backed tenant config when
  platform administration lands.

## The security model, as built

- **Admin is a row, not a claim.** `tenantAdmin(slug)` reads the person's own
  membership on every request and requires `role = 'tenant_admin'` and
  `status = 'active'` in that tenant. Every mutation re-checks the same inside its
  own transaction (`isTenantAdmin`), so the page gate is the first of two checks.
- **404, not 403.** Signed out or without the role, admin routes and the page
  are not found, so their existence says nothing about who holds the role.
- **Tenant scoping is RLS.** Admin reads and writes run in
  `withActorInTenant(admin, slug)`; the request table's read policy is own or
  tenant, and a tenant A admin literally gets no rows from tenant B (tested:
  `not_found`).
- **A person can ask, never answer.** RLS on `verification_requests`: INSERT only
  their own, only pending, only undecided; UPDATE only in a tenant context, which
  their own request never runs in. Tested: a user's own update matches nothing.
- **Nobody decides their own request** (`self`, refused inside the transaction,
  whatever role they hold), and **nobody verifies themselves** by hand.
- **`verified_at` has one writer**, `grantVerified`, with three callers: the
  domain check, the configured admin list, and an admin's decision. All three
  run server side in a tenant context. The membership policy from `0008` refuses
  any user write, with a test.
- **Idempotent decisions.** The request row is locked `FOR UPDATE`; a second
  decision, from a double click or a second admin, reports `already_decided` and
  writes nothing. Tested, including that only one audit line exists.
- **Transport.** Every mutation requires a same origin `Origin` header (behind
  the proxy, `x-forwarded-host`) on top of the `SameSite=Lax` cookie, and is rate
  limited per client.
- **Audit.** `verification.requested`, `verification.approved`,
  `verification.rejected`, `membership.joined`, `membership.verified`,
  `membership.role_granted`, all in the same transaction as the change, with ids
  and enum values only.

## Data & migration impact

`0009_verification_requests`: the table, its indexes, RLS with FORCE, and the
three policies above. `tenant_memberships.verification_method` gains the value
`config`. `tenantConfigSchema` gains `adminEmails` (defaults to none, so no
other tenant changes). Additive; rollback drops the table.

## Tests

- Unit: `verificationDetailsSchema` (accepts the three fields, trims, drops an
  empty note, refuses markup and over long input); `isSameOrigin` (same host,
  forwarded host, other site, missing, nonsense); `isConfiguredAdmin` is covered
  through the integration cases.
- Integration (CI, split database), 16 new cases: configured admin created off
  the domain, upgraded in place, never downgraded; a person can ask once, see
  their own, not others', and cannot change one; already verified refused; three
  asks then `rate_limited`; the admin's queue carries handles and no `@`; approve
  with no membership creates a verified one; approve with an unverified one
  verifies it in place; **double decision is idempotent with one audit line**;
  reject purges and creates nothing; self decision refused; a plain member and an
  admin of another tenant both refused; verify by handle creates, then reports
  already verified, refuses self and an unknown user. The FORCE invariant now
  includes `verification_requests`.
- e2e (3 new, 49 total): the admin page is 404 signed out; an admin decision is
  404 without the role; asking requires a session.
- `pnpm turbo run typecheck lint test` (16 + 7) and `pnpm --filter web build`
  pass; `pnpm --filter web test:e2e` 49 passed.

## Verification steps

After deploy and `pnpm db:migrate:all`:

1. Sign in with `ahadnawaz585@gmail.com`. `/account` shows "Verified member" and
   "Open the university admin". `/admin` lands on the queue.
2. In another browser, sign in with a different gmail. `/account` shows the
   request form. Submit it. The form says sent; the page then says it is with the
   university.
3. Back as admin: the request is in the queue with that handle. Approve. The
   other browser's `/account` now says verified; `tenant_memberships` has a row
   with `verification_method = 'admin'`; the request row has null details.
4. Approve again from a stale tab: "Someone already decided this one", nothing
   changes.

## Follow-ups

- Add the LGU admin address to `adminEmails`.
- The legacy secret gated `/admin/rooms` and `/admin/analytics` still exist
  beside this; retiring the secret is the deferred PR 8.
- The sign in route itself does not yet check `Origin`; the new mutations do.
