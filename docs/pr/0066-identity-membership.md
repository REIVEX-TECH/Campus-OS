# feat(identity): verified membership by email domain, and recently viewed timetables

Targets `main`. Identity foundation: membership. Not admin gating, not platform
admin. Nothing public is gated by anything here.

## What

- **Verified membership by domain.** On sign in, when the tenant joins by domain
  (`joinMode: 'domain'`, LGU's setting) and the Google verified email is on its
  `allowedEmailDomains` (`lgu.edu.pk`), the person becomes a verified student
  member of that tenant, silently. Anyone else gets an account and a session and
  simply is not a member. Nothing in the sign in response says which happened.
- **Verified is private.** It is a `verified_at` and a `verification_method`
  (`domain` today, `admin` later) on `tenant_memberships`, kept beside `status`
  rather than inside it, because a member can be verified and suspended at once
  and an admin will need the time and the method. No public surface reads it:
  `public_profiles` is unchanged, and the only place it appears is the account
  page, to the person themselves, labelled as private.
- **Verified cannot be forged.** The membership policy is split: a person may
  READ the memberships they hold, but INSERT, UPDATE and DELETE require the
  tenant context, which only server code sets. An integration test proves a user
  writing their own membership is refused (42501) and that an update they
  attempt changes nothing. The domain path is the only writer today; the admin
  path in the next PR will be the second, inside `withActorInTenant`.
- **Every membership change is audited** (`membership.joined`,
  `membership.verified`) in the same transaction, with ids and enum values only.
- **Recently viewed timetables.** Under the picker on the timetable page: the
  sections, teachers and rooms you looked at, newest first, one tap back. Signed
  out it lives in the browser; signed in the account keeps it too (`user_recents`,
  own rows, capped at 20 per tenant) and the two are merged after mount so the
  first paint matches on server and client. A "Clear" forgets both, for a shared
  device.

## Where the tenant comes from at sign in

Middleware does not run on `/api`, so `/api/auth/session` cannot read
`x-tenant-slug`. The client sends the tenant slug it is signing in on. That is
safe: naming a tenant grants nothing. Whether the address earns a membership is
decided on the server against that tenant's own config, from the email the
provider verified, and a slug that is not a real tenant is ignored.

## Data & migration impact

`0008_membership_verification`: two nullable columns on `tenant_memberships`;
the policy split described above; the `user_recents` table with RLS and FORCE.
Additive and safe to re-run. Rollback: drop the two columns and the table, and
restore the single `own_or_tenant_memberships` policy from `0001`.

**Production still needs `0003` to `0007` applied** (see the deploy note). This
PR's `0008` will apply in the same `pnpm db:migrate:all` run. `docs/DEPLOY-VPS.md`
now says to run it on every update: it is a no-op when nothing is pending, and a
skipped one is exactly what broke sign in.

## Tests

- Unit: `emailDomain`, `domainAllowed` (case, exact match, subdomain and look
  alike domains refused, empty list), `isVerified` (needs both verification and
  good standing); `mergeRecents` (order, dedupe, kind scoping, cap).
- Integration (CI, split database): domain email becomes a verified student;
  gmail does not; invite mode does not; idempotent across sign ins; verifies an
  existing unverified membership rather than duplicating; audit rows without an
  address; **a user cannot write their own membership**; recents are own rows,
  newest first, one per key, and clearable. The FORCE invariant now includes
  `user_recents`.
- e2e (2 new, 46 total): the timetable page remembers a section signed out,
  one tap returns to it, and Clear forgets it; recording a recent requires a
  session.
- `pnpm turbo run typecheck lint test` (16 + 7 tasks) and `pnpm --filter web
build` pass; `pnpm --filter web test:e2e` 46 passed.

## Verification steps

After `pnpm db:migrate:all` on the VPS:

1. Sign in with an `@lgu.edu.pk` address. On `/account` the line under the
   email reads "Verified member of Lahore Garrison University". Nothing about it
   appears anywhere public.
2. Sign in with an `@gmail.com` address. The same line reads "Not yet a verified
   member". Still a working account and handle.
3. As owner: `select role, status, verified_at, verification_method from
tenant_memberships` shows one row for the first person and none for the second;
   `select action from audit_log` shows `membership.joined`.
4. Open a section, a teacher and a room, then return to the timetable page:
   "Recently viewed" lists all three; Clear empties it.

## Follow-ups

- The verification request and admin approval flow is planned separately and
  waits for review before it is built.
- `account.emailNote` still says "moderators"; the account page's new line says
  "the university". One word should win once the admin model is settled.
