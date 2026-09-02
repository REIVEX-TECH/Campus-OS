# feat(web): room directory and profile pages

Targets `main`. Gives rooms the same treatment as teachers: a searchable
directory, a real profile, and consistent cards. Read-only, no schema change.

## What

- **Directory** at `/rooms`: every room with published classes, as cards with a
  generated avatar, the building, and its class and day counts. Added to the
  sidebar nav, the module hub, and the tenant sitemap.
- **Profile** at `/rooms/[id]`, rebuilt: header with the generated avatar, a
  figure row (classes a week, hours a week, **how booked**, courses, busiest
  day), the courses that sit in the room, when the room is free, and the
  filterable weekly timetable.
- **Room marks lead with the number**: names import as "Room 26 NB" or
  "Lab 18 OB", and the number is what people actually say, so the avatar shows
  "26" or "18" and falls back to initials for a room without one.
- **Free-rooms cards** now use the same room card, so a room looks the same
  wherever it appears.
- **Pluralisation fixed**: counts read "1 class, 1 day" rather than
  "1 classes across 1 days". A `countText` helper picks the form with
  `Intl.PluralRules`, so a locale with more than two plural forms works too. This
  also corrected "1 courses" on the teacher directory.
- Hardened the semester-combobox e2e: picking a term runs a soft navigation, so
  the URL assertion now allows for a loaded CI runner instead of the 5s default.
  That assertion flaked once on the previous PR.

## Data & migration impact

None. Reads only, through the existing tenant-scoped queries.

## Tests

- e2e (2 new, 32 total): the room directory lists and filters, and a profile
  shows the generated avatar, the booked figure, and the free-slot card.
- Unit (5 new, 51 total): room marks lead with the number and fall back to
  letters; plural forms for one and many.
- `pnpm turbo run typecheck lint build test --filter=web` passes.
- Verified in the browser: for Lab 18 OB, classes at 09:30 to 11:00 and 14:00 to
  15:30 on Wednesday produce exactly the gaps 08:00 to 09:30, 11:00 to 14:00 and
  15:30 to 16:00, and 4h 30m against a 40h window reads as 11% booked.

## Verification steps

Open `/u/lgu/rooms`, filter by a room number, open one: the figures, free slots,
and the timetable all describe the same week. Open `/u/lgu/free-rooms`: the
result cards match the directory's.

## Follow-ups

- Utilisation uses the tenant's observed teaching window. If a campus schedules
  evening classes only in one term, that widens the window for everyone; a
  per-term window would be the refinement.
