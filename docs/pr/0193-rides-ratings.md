# feat(rides): ratings — 1-5 driver/passenger reputation

Block B, PR 3. After a completed ride, the driver and each accepted passenger rate
each other 1-5, one per pairing, shown on the person's public profile. Stacked on
PR 2.

## What

- **`ride_ratings` (migration `0002`)** — `rater_id`, `ratee_id`, `direction`
  (`of_driver` | `of_passenger`), `stars` (1-5 CHECK), optional `comment`, unique per
  `(ride, rater, ratee)`, no self-rating (CHECK). Tenant-wide SELECT (public-profile
  data); **no application write policy**, and writes revoked from the app role by
  name — the only writer is the definer.
- **`auth_rides_submit_rating` (definer)** — the module's first `SECURITY DEFINER`.
  Re-verifies, as the owner, that the rating is for a pairing that actually happened:
  the ride is `completed`, and either the rater is an accepted passenger and the
  ratee is the driver (`of_driver`), or the rater is the driver and the ratee is an
  accepted passenger (`of_passenger`). Returns `created | exists | not_completed |
not_eligible | invalid`.
- **`ratings.ts`** — `submitRating` (contact-scrubs the comment, then calls the
  definer) and `ratingsForUser` (average + count split by direction, plus recent
  comments) for the profile surface.

## Data & migration impact

New table `ride_ratings` and one definer (migration `0002`, rides module). Additive.
Rollback = drop the table and function. Nothing enabled for any tenant.

## Security review (CLAUDE.md 6, 8)

- **Reputation integrity is enforced by the database, not the app.** A rating can
  only be written through the definer, which reads the real ride and seat-request
  rows (as owner) to confirm the pairing; a compromised app role cannot forge one
  because it has no INSERT on `ride_ratings` (no policy + revoked by name). This is
  the platform_roles/L&F-report definer pattern.
- **No privilege decision rests on a GUC.** The rater is the caller's own session
  identity (`app.user_id`, the trust the whole session rests on); the eligibility —
  who may be rated, on which ride — is read from rows, not settings. The ratee is a
  parameter but is validated against the ride's author and its accepted passengers,
  so it cannot name an arbitrary person.
- One rating per pairing (unique index + `ON CONFLICT DO NOTHING`), no self-rating
  (CHECK). The definer is `REVOKE ALL FROM PUBLIC` then granted to the app; it is
  declared `'app'` in the communities DEFINER_INTENT audit, which now also applies
  the rides migrations so the audit sees it.
- `ride_ratings` is NO FORCE so the owner-definer writes it; the app is default-denied
  writes with no policy.

## Tests

`test/rides-ratings.integration.test.ts` (real Postgres, split-DB only): both
directions rate after completion (one per pairing, surfaced on the profile
aggregates), the guards (not a party, not completed, self, contact-laced comment),
and a raw app insert is refused (definer-only write). Fifteen rides integration
tests green locally; the communities DEFINER audit passes with the new definer
registered. Module typecheck + lint pass.

## Follow-ups

Per `docs/design-rides.md`: PR 4 safety (reports, moderation queue, share link),
PR 5 lifecycle (sweep, auto-complete, recurrence). Profile UI wiring and the
seat-request/rating UI ride on this layer.
