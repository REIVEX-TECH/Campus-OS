# feat(identity): official-account flag and profile badge

Run 6, PR 1 (of the coordinated cards + official-account set). The foundation for the
official account (block C): the `is_official` marker on an account, made unforgeable by
the app, and the public "Official" badge on a profile. **Nothing about LGU changes** —
the column is additive and defaults off, and no account is promoted here.

## What

- `packages/modules/identity/drizzle/0035_users_is_official.sql` + schema —
  `users.is_official` (boolean, default false), the first-party-account marker, with a
  RESTRICTIVE RLS policy scoped to `campusos_app` that forbids the app from ever writing
  `is_official = true` (only an owner-run promote/seed sets it). Also extends the
  sanctioned `public_profiles` view (0005) with `is_official` — a public, non-sensitive
  fact, read there so no other user column can ride along.
- `packages/modules/identity/src/membership.ts` — `memberPublicFacts` returns
  `isOfficial`, read through `public_profiles` (global fact, no PII).
- `apps/web/app/u/[slug]/people/[handle]/page.tsx` — an "Official" badge (a `BadgeCheck`
  mark) next to the handle when the account is official, mirroring the existing "Admin"
  badge. New message key `profile.badge.official`.

The posting capability itself (an official account may post in any community, subject to
the structural rules) and the launch/re-post ops land in PR 2, keyed on this flag.

## Data & migration impact

Identity migration `0035_users_is_official` adds a defaulted boolean column (backwards
compatible; existing inserts omit it), a RESTRICTIVE policy in a split DB, and a
`CREATE OR REPLACE VIEW` that appends one column to `public_profiles`. Rollback: drop the
column (cascades the view column) and the policy. No account is promoted; `is_official`
reaches `true` only via a later owner-run step.

## Security review (CLAUDE.md 6, 8)

- **`is_official` is an authorization input (it waives the community participation gates
  in PR 2), so it must not be app-writable (§8).** `own_user` (0001) would let a user
  write their own row and self-promote; a column-level revoke would not survive
  db-grants' blanket table grant. So a RESTRICTIVE policy `TO campusos_app` blocks the app
  role from writing `is_official = true` on insert or update — a permissive policy plus a
  restrictive one must both pass, and the restrictive one fails. It is a policy, not a
  grant, so it is independent of db-grants and survives re-application; skipped on an
  unsplit dev DB where the guarantee cannot hold. This mirrors `is_demo` (0034).
- **No new definer.** The badge reads through the existing `public_profiles` view, whose
  whole contract is "the public half of an identity and nothing sensitive"; `is_official`
  fits that contract (its purpose is to be shown). `users` keeps ENABLE + FORCE and its
  `own_user` policy; the only new grant-surface is one boolean column on an existing view.

## Tests / verification

`turbo run typecheck lint` passes for identity and web. The migration-journal-parity and
no-dash web suites pick up `0035` and the new message. The RESTRICTIVE policy's runtime
behavior (app cannot set `is_official = true`) runs in CI (the identity integration suite
is split-only); PR 2 adds the posting-authz boundary test that exercises the flag.

## Follow-ups (this run)

PR 2 (C) — official accounts may post in any community (authz keyed on this flag, read
unforgeably inside the write transaction) + the launch-posts / re-post ops tooling and
runbook. Then block A (contextual cards), block B (empty states), block D
(notification click-through instrumentation).
