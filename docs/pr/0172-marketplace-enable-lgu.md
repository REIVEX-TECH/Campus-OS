# feat(marketplace): policy pages and enable goods for LGU

The final Block 1 (goods) PR: the policy page, and turning the module on for LGU
now that posting, browsing, the seller lifecycle, saved listings, and moderation
are all in.

## What

- **Enable for LGU**: `marketplace` added to `tenants/lgu/tenant.config.ts`
  `enabledModules` (a file default; a DB config row still wins in production). The
  module-hub card flips to live (`soon: false`, `moduleId`, `path`).
- **Policy page** `/u/[slug]/marketplace/policy`: terms (operator **Reivex
  Technologies**, a placeholder to edit), prohibited items and services (weapons,
  drugs, counterfeit, academic dishonesty, etc.), fees (goods are free, cash on
  meetup; paid services carry a fee when enabled), and refunds and disputes. Linked
  from the post page and the browse footer.
- **Test updates for the flip** (done once, here): `seo.spec` points its
  coming-soon check at `rides` (marketplace is live now), and `shell.spec` expects
  Marketplace as a real nav link plus a still-soon `rides` non-link row.
- **e2e** `marketplace.spec.ts`: a verified member posts a listing via the API, it
  shows in browse and on the detail page with cash-on-meetup stated, and a phone
  number in a listing is refused (422).

## Data & migration impact

No schema change. Enabling `marketplace` for LGU turns on its (already-migrated)
tables; run the marketplace migrations (`0000`-`0002`) on deploy.

## Tests

Web typecheck, lint, no-dash, and a local build pass; the marketplace e2e is added.

## Verification

On `/u/lgu`, Marketplace appears in the nav; browse, post a listing (with photos),
open it, save it, message the seller; a tenant admin moderates at
`/marketplace/mod`; the policy page renders and is linked from post and browse.

## Follow-ups

The seller's active-listings tab on the public profile is the one remaining Block 1
goods item (it touches the shared profile page; deferred to keep this PR focused).
Services, money, and the platform finance admin (Blocks 2-5) are not started; see
the morning report.
