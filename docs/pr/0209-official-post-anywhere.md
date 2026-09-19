# feat(communities): official accounts may post in any community

Run 6, PR 2 of the coordinated cards + official-account set (block C), building on the
`is_official` flag from #237. An official account may post in any community, subject to
the content rules but not the participation gates, and this ships the owner-run promote
tooling and the ops runbook for launch posts and re-posting. No account is promoted here;
nothing about LGU changes until an operator runs the promote step against it.

## What

- `packages/modules/communities/src/gates.ts` — `isOfficialAccount(tx, userId)`: reads
  `is_official` from the caller's own row inside the write transaction.
- `packages/modules/communities/src/posts.ts` — `createPostIn` waives the participation
  gates (verification, ban/mute, community access, karma/account-age gate, unaccepted
  rules) for an official account, keyed on that read. The structural content rules stay:
  the community must exist and be approved and un-archived, the kind must be allowed, and
  flair validity, duplicate detection and the per-hour rate limit still apply.
- `scripts/official/promote.ts` + `scripts/official-promote.ts` + `package.json` —
  `pnpm official:promote -- --tenant <slug> --handle <handle> [--demote]`, the owner-run
  path that sets (or clears) `is_official` on an existing account. The app cannot set the
  flag, so this is the only way it is set.
- `docs/runbooks/official-account.md` — what official grants and does not, how to create
  and promote the account, how it posts launch announcements (through the normal composer,
  now that it may post anywhere), and the manual re-post process for lost/found and
  for-sale items with a link back (honest, judicious, not bulk, not bots).

## Data & migration impact

No schema change (the column shipped in #237). `official:promote` is owner-run tooling,
not run in CI or automatically anywhere.

## Security review (CLAUDE.md 6, 8)

- **The bypass is an authorization decision, so it keys on an unforgeable value (§8).**
  `isOfficialAccount` reads `users.is_official`, which the RESTRICTIVE `users_app_not_official`
  policy (#237) stops the app role from ever writing true; it is read as the caller's own
  row through the write transaction, never from a GUC or a client field. A user cannot make
  themselves official to post past a gate.
- **The waiver is scoped to participation, never to content or safety.** An official post
  is still subject to the community existing and being approved, the allowed kinds, flair
  validity, duplicate and rate limits, and to moderation (report/remove) like any post. The
  account is not an admin and gains no moderation or configuration power.
- Promotion is owner-only by construction (the app-role write is refused), so the privilege
  cannot be granted from inside the app, admins included.

## Tests / verification

`turbo run typecheck lint` passes for communities and web. A communities integration test
(split-only, in CI) proves a brand-new account with no membership is refused (`not_verified`),
then, once promoted the owner-only way, may post in that community without joining or
verifying, while a same-title repeat is still refused (`exists`) so the content rules are
shown to still bind. `pnpm official:promote` with no args prints usage and exits.

## Follow-ups (this run)

Block A (contextual cards on the tenant home), the coordinated partner of this PR, lands
next. The demo tenant could seed an official persona to showcase the badge (not done here;
no LGU or prod change).
