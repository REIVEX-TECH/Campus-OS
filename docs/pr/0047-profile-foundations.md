# feat: profile foundations (avatars, stats, directory reads)

Targets `main`. Groundwork for the teacher and room profile pages. Pure
additions: no page changes, no schema change, no new data collection.

## What

- **`IdentityAvatar`** (`app/_components/identity-avatar.tsx`): a deterministic
  generated avatar. An FNV-1a hash of a stable seed picks one of eight colours
  and seeds two quiet geometric accents; the entity's initials sit on top. The
  same seed always yields the same mark, so a teacher looks identical on the
  directory and their profile without storing an image. It is inline SVG rendered
  on the server: no client JS, no network request, no runtime dependency. Every
  palette colour carries white text at or above 4.5:1, so the initials meet WCAG
  AA whichever colour a seed lands on. Geometry and initials only: no photograph,
  and nothing inferred about a person from their name.
- **`lib/timetable-stats.ts`**: pure projections of a class list the page has
  already fetched, so a profile costs no extra reads. Gives classes per week,
  booked minutes, teaching days, busiest day, courses, sections, utilisation, and
  **free slots** (the unbooked stretches of each day, with overlapping classes
  merged so a gap is never invented between them).
- **Three read queries** (tenant-scoped through the existing repository, current
  entries only): `teachingWindow()`, `listTeachersWithCounts()`,
  `listRoomsWithCounts()`. The window is the tenant's observed earliest start,
  latest end, and teaching weekdays; free-slot and utilisation maths measure
  against it so figures are comparable across teachers and rooms rather than each
  being scored against its own schedule.
- `vitest.config.ts` gains the `@` alias so modules resolve under test the same
  way they do in the Next build.

## Data & migration impact

No schema change. The new queries are read-only aggregates over existing rows.

## Tests

- Unit (web, 12 new): avatar determinism, palette bounds, initials derivation and
  its empty-label fallback; stats counts, utilisation against the shared window,
  gap finding, overlap merging, an unused day reading as fully free, and duration
  formatting.
- Integration (4 new): the teaching window over current entries, both directory
  reads with their counts and building, and a tenant-scoping check that a second
  tenant sees none of it.
- `pnpm turbo run typecheck lint build test` (21 tasks) and
  `pnpm --filter @campusos/module-timetable test:integration` (32) pass.

## Verification steps

Nothing user-visible yet. `pnpm --filter web test` and the integration suite
cover the behaviour; the pages that consume it follow in the next PRs.

## Follow-ups

- PR B: teacher directory + profile redesign, and the sidebar entry.
- PR C: room list + room page redesign, reusing the same card.
