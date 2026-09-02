# feat(web): teacher directory and profile pages

Targets `main`. Turns the teacher page into a real profile and adds a directory
in front of it. Read-only: every figure is derived from timetable rows the page
already fetches. No schema change.

## What

- **Directory** at `/teachers`: every teacher with published classes, as cards
  carrying their generated avatar, name, an Unverified badge where the import is
  still pending, and their class and course counts. The full list renders on the
  server and filters in the browser, so typing is instant and costs no request.
  Added to the sidebar nav and the module hub, and to the tenant sitemap.
- **Profile** at `/teachers/[id]`, rebuilt: a header with the generated avatar,
  a figure row (classes a week, hours a week, teaching days, courses, busiest
  day), the courses they carry with a per-course class count, **when they are
  free**, and the existing filterable weekly timetable.
- Free slots and figures come from the same class list the grid below renders, so
  the two can never disagree, and they measure against the tenant's teaching
  window so one teacher's week is comparable to another's.
- Shared `profile/` components (header, stat grid, free-slots card, directory) so
  the room pages in the next PR read as the same family.

## Data & migration impact

None. Reads only, through the existing tenant-scoped queries.

## Tests

- e2e (2 new, 30 total): the directory lists teachers, filters as you type, and
  shows an empty note for a query that matches nothing; a profile shows the
  inline generated avatar, the figures, and the free-slot card.
- `pnpm turbo run typecheck lint build test --filter=web` passes.
- Verified in the browser, light and dark: seeded avatars are distinct and stable,
  and the free slots match the grid (a teacher whose only Monday class runs 08:00
  to 09:30 reads as free 09:30 to 16:00).

## Verification steps

Open `/u/lgu/teachers`, type part of a name to filter, then open a teacher: the
avatar, figures, courses, free slots, and the timetable all describe the same
week.

## Follow-ups

- PR C: the room list and room page, reusing these components.
- Directory search is a client-side substring match, which suits a few hundred
  names; a server-side search would be the move if a tenant is much larger.
