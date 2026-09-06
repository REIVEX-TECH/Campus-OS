# feat(web): verification UX

Item 4. Make a member's verification status visible and getting verified easy,
without nagging. Most of the backend and the account-page status already existed;
this re-surfaces them and adds the prompts.

## What

- **One "Get verified" modal** (`get-verified.tsx`): a button that opens an
  accessible dialog (portal, page inert, Escape, focus trapped, bottom-sheet on
  mobile, matching the grant modal) explaining what verification unlocks and the
  two ways to get it (university-email auto-verify, or a request an admin checks),
  then carrying the existing request form. Used from the account page, the home
  prompt, and the post wall, so there is one code path and one place the form lives.
- **Account page**: keeps the persistent, private status line (verified / pending
  / not verified, "only you and the university can see this") and now opens the
  modal to request, rather than an always-expanded form.
- **Non-nagging home prompt** (`verify-prompt-card.tsx`): a gentle, dismissible
  card on the tenant home for a signed-in, unverified member. Dismissal is
  remembered **per account, server-side** (identity `0027`, `verify_prompt_dismissed`,
  RLS to the person's own row), so one dismissal is gone everywhere and it never
  nags again; a verified person never sees it (page-level check).
- **Contextual gate at the post wall**: on the community submit page, an unverified
  member is told "you need to be a verified member to post here" with the Get
  verified affordance right there, instead of a bare "not allowed".
- **Explain-how**: the modal states what verification is, what it unlocks, and the
  two paths. New member-facing strings.

## Data & migration impact

Migration `0027`: one per-user preferences table (`verify_prompt_dismissed`) with
RLS + FORCE keyed on `app.user_id` (own rows only), modeled on `user_recents`. It
is a UI preference, not a privilege: nothing about verification or admin is
decided by it. No other schema change.

## Tests

- `packages/modules/identity/test/isolation.integration.test.ts` -- the dismissal
  is remembered per account and per tenant, idempotent, and private (RLS: one
  person never sees another's row).
- The full web unit suite (no-dash, admin-seam-boundary, journal parity) stays
  green; the dismiss route lives under `/api/account`, not the admin seam.

```bash
pnpm -C apps/web test
pnpm -C packages/modules/identity test:integration
```

## Accessibility / design

Dialog follows the established recipe (role=dialog, aria-modal, focus trap +
return, Escape, inert background). Light and dark via CSS vars, `ios-card`, no
divider lines, no em/en dashes (enforced), status messages use `role=status`.

## Follow-ups

- Extend the contextual gate to the comment composer, vote, and join walls (same
  `GetVerified` component; the comment composer is a client component that needs a
  small prop to surface it). The post wall ships here as the representative gate.
- Optional: a private status chip (Badge) beside the account status line.
