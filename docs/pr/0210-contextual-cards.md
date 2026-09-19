# feat(web): contextual cards on the tenant home

Run 6, PR 3 of the coordinated set (block A), the partner of the official account (#240).
Small, dismissible nudges on the tenant home that point a signed-in member at a module
worth a first action. Ranked by simple time-decayed relevance with no personalization,
visually distinct from posts, dismissible per card per account, and not repeated for 24h
once dismissed. Additive; a tenant with no enabled modules matching the catalog shows
none, and LGU behaves as before apart from these nudges.

## What

- `packages/modules/identity/drizzle/0036_card_dismissals.sql` + schema — a
  `card_dismissals` table (user, tenant, card, dismissed_at), own-row RLS on
  `app.user_id`, mirroring `verify_prompt_dismissed` (0027). `card_id` is opaque here.
- `packages/modules/identity/src/cards.ts` (new export `./cards`) — `dismissCard`
  (upsert, restarts the window) and `activeCardDismissals` (ids dismissed within a
  window, default 24h). The 24h no-repeat rule is a read-time window, not a stored one.
- `apps/web/lib/cards.ts` — the card catalog and the pure, time-decayed selection:
  `score = weight x 2^(-ageDays / HALF_LIFE_DAYS)`, filter to enabled + undismissed, most
  relevant first, capped at 2. Decay sets order; dismissal and the cap set visibility.
- `apps/web/app/api/account/card/dismiss/route.ts` — same-origin + rate-limited +
  authenticated dismiss, validating the card id against the catalog.
- `apps/web/app/_components/contextual-card.tsx` — an accent-tinted card (not an
  ios-card, so it does not read as content) with an icon, a line, a CTA, and a dismiss X
  that hides optimistically and saves server-side.
- `apps/web/app/u/[slug]/page.tsx` — selects and renders the cards for a signed-in
  member, below the verify prompt. New `cards.*` message keys.

## Data & migration impact

Identity migration `0036_card_dismissals` adds one table with own-row RLS (no definer, no
grant beyond the app's own-row access). Backwards compatible; nothing reads back
differently. Rollback: drop the table.

## Security review (CLAUDE.md 6, 8)

`card_dismissals` is the person's own low-stakes UI preference, not a privilege, so the
app reads and writes it directly under RLS keyed on `app.user_id` (theirs to set, theirs
to read, nobody else's), exactly the `verify_prompt_dismissed` (0027) pattern. No
authorization decision keys on it; there is no §8 surface. FORCE + own-row policy; the
dismiss endpoint is same-origin, rate-limited, authenticated, and validates the card id.

## Tests / verification

`turbo run typecheck lint` passes for identity and web; the full web vitest suite (140,
incl. 6 new: score half-life, decay ordering, enabled/dismissed filtering, the cap, id
uniqueness) passes. An identity integration test (split-only, in CI) proves a dismissal
is remembered within the window, is per account and per tenant, restarts on re-dismiss,
and drops out past the window (a wider window still sees it). The card render is auth-gated
(a signed-in member), so it is exercised by CI build/e2e rather than the local sandbox,
which cannot hold a signed-in session; the selection logic it depends on is unit-tested
directly.

## Follow-ups

- Once we have a per-user signal (block D's click-through is the first candidate),
  relevance can move beyond time decay toward light personalization.
- The catalog is code; adding a card is one appended entry with a fresh id and a `since`.
