# feat(marketplace): services (gig) catalog UI

Block 2d part 2: the gig catalog — browse, detail, create, and the seller's gigs —
plus the gig API. All gated on the `marketplace-services` flag, which no tenant has,
so every route 404s in production. This is the front half of services, up to (not
including) placing an order.

## What

- **Pages** under `/u/[slug]/services` (all `requireMarketplaceServices`):
  - browse (`/services`): search + category filter, a card grid ("from Rs X",
    cover thumb), keyset "more".
  - detail (`/services/[gigId]`): portfolio gallery, description, the seller and a
    rating summary, and the packages with a per-package "Continue" that links to the
    order route (built next). The seller sees pause / un-pause / delete controls.
  - create (`/services/new`): verified-gate, then the gig form — title, description,
    category, one to three packages (basic required), and portfolio photo upload.
  - seller's gigs (`/services/mine`): the person's gigs with status.
- **API** (`/api/marketplace/gigs`): create a gig; `[id]` pause/activate/delete
  (delete removes photo files); `[id]/photos` the same server-mediated image
  pipeline as goods (size cap, magic-byte sniff, sharp -> WebP, EXIF stripped). All
  behind `marketplaceServicesGate` (the services flag; same origin, rate limit,
  signed-in, tenant resolved from the body).
- **Reads**: `GigSummary` gains `coverThumbKey` (first portfolio photo) for the card.
- **i18n**: `marketplace.services.*` and `marketplace.gig.*`; `countText` gains
  `revisions`.
- **Components**: `gig-card`, `post-gig-form` (packages + photos), `gig-seller-controls`.

## Data & migration impact

No schema change (builds on `mkt_gig_photos` from the previous PR).

## Tests

Web typecheck, lint, no-dash, and a full `pnpm --filter web build` pass (all four
services routes compile). No e2e: the feature is flag-disabled, so there is no live
route to drive; the module's read/write paths are covered by the marketplace
integration suite.

## Verification

With `marketplace-services` enabled for a test tenant, `/u/<t>/services` browses,
`/services/new` posts a gig with packages + portfolio, `/services/[gigId]` renders
it, `/services/mine` lists it, and the seller can pause/delete. For LGU (services
off) every route is a 404.

## Follow-ups

The order request flow, the order page with linked chat, and the deliver/accept/
revision UI are the next Block 2d PRs. The per-package "Continue" link targets the
order route they add.
