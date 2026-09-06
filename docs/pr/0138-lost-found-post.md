# feat(lost-found): report an item, upload photos, my items

Lost & Found PR 3. Verified members can report an item with photos, see their own
items, and withdraw an open one.

## What

- **Module `write.ts`**: `createItem` (verified-only, per-person cap of 10/hour,
  validates category against tenant settings, stamps `expires_at` from the
  90-day setting), `addItemPhoto` (records a stored photo against the caller's own
  item, enforcing the per-item count cap), `withdrawItem` (own open item →
  `withdrawn`), `myItems`, and `listBuildings` for the optional building field.
  Shared input schema in `input.ts`.
- **API routes** (`apps/web/app/api/lost-found/`):
  - `POST /items` (JSON) — create, behind the `lostFoundGate` (same-origin, rate
    limit, signed-in, zod, tenant resolve, module enabled); the module re-checks
    verification in-transaction.
  - `POST /items/[id]/photos` (multipart) — **per-user rate limit, then a
    size cap and a magic-byte sniff BEFORE sharp**, then re-encode to WebP
    (EXIF/GPS stripped) into a display image + thumbnail, store under UUID keys,
    and record only if the item is the caller's; orphan objects are deleted if
    the record is refused.
  - `POST /items/[id]` — withdraw.
- **UI**: `/lost-found/post` (verified-gate wall via `GetVerified`, then the
  item form: kind, title, description, category, location, optional building,
  date, photos), `/lost-found/mine` (own items + withdraw), and Report / My items
  affordances on browse. i18n keys added; Reddit-style, iOS-clean.

## Authorization & privacy

Posting is gated on verified membership in the write transaction (not a role
permission). Photos are re-encoded server-side, so EXIF/GPS never persists;
served under unguessable keys. Reporters stay pseudonymous (handle only).

## Data & migration impact

No schema change (uses PR 2's tables). No new SECURITY DEFINER, RLS, or privilege
grant — item and photo creation ride the RESTRICTIVE own-row insert policies from
PR 2's migration, so no §6 pass is required for this PR (verification and the rate
limit are application logic; the DB boundary is unchanged).

## Tests

`lost-found.integration.test.ts` gains a write-service suite (split DB): an
unverified member is refused and a verified one succeeds; an unknown category is
rejected; a photo is added only by the owner and refused for another member; an
item is withdrawn only by its reporter. Typecheck, lint, format verified locally;
the suite runs in CI.

## Follow-ups

PR 4: claims + moderation (the §8 release — reporting, blocking, mod queue ship
with the claim flow; module enabled only after).
