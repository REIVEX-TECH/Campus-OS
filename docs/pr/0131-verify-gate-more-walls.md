# feat(web): contextual verification gate at the comment, vote, and join walls

Item 4 follow-up. The contextual "get verified" affordance shipped on the post
wall; this extends it to the other verified-only actions a member hits, and
unifies the whole feature on one shared modal.

## What

- **One shared modal, hosted by the tenant layout** (`verify-gate.tsx`): a
  `VerifyGateProvider` mounts a single verification modal and exposes
  `openVerify()` plus `needsVerify` (the signed-in viewer is an unverified
  member). So any control a gate stops opens the same modal without carrying it,
  and there is one code path. `GetVerified` is now a thin button that calls
  `openVerify()`; the account page, home prompt, and post wall use it unchanged in
  behaviour.
- **Comment wall**: the comment thread, when a member cannot comment, shows the
  `VerifyGateInline` affordance (a server-safe client component that renders only
  for an unverified member).
- **Join wall**: `JoinButton`, when the server refuses with `not_verified`, shows
  the Get verified affordance beside the reason.
- **Vote wall**: the vote arrows stay live for an unverified member, and a tap
  opens the verification modal instead of failing silently. Nothing is added to
  the 40px column; the control itself is where the gate is met.

A verified person, or a stranger, sees none of it: `needsVerify` is false, and
each affordance renders nothing.

## Why this shape

Votes appear on every post card, so prop-drilling a modal there is untenable; a
context that hosts one modal and hands out `openVerify()` is the clean fit and
removes the per-place modal that item 4's post wall used. The vote column is too
narrow for any inline element, so the arrow itself becomes the trigger.

## Data & migration impact

None. UI only; the verification backend and the `verify_prompt_dismissed` table
already exist. No new SQL, no new authority (voting/commenting/joining stay
server-gated by `isVerifiedMember`); this only surfaces the affordance.

## Tests

The full web unit suite (no-dash, admin-seam-boundary, journal parity) stays
green. This is client/server UI wiring; the gated actions are already covered by
the communities integration suite.

```bash
pnpm -C apps/web test
```

## Accessibility / design

Same dialog recipe (role=dialog, focus trap + return, Escape, inert background,
bottom-sheet on mobile). Light and dark via CSS vars, no divider lines, no
em/en dashes, `role=status` messages.

## Follow-ups

- Optional: a private status Badge chip on the account status line.
