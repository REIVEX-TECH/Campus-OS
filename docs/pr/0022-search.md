# feat(web): public search (teachers and courses)

Targets `main`. Read-only over existing data; no schema or migration change.

## What

A public `/u/[slug]/search` page: the fastest path from anywhere to a teacher's
week or a course's schedule.

- **Queries.** `searchTeachers(q)` and `searchCourses(q)` match by name / title /
  code (case-insensitive, wildcard-escaped), restricted to entities with a
  current entry, tenant scoped (RLS). `getCourse` + `courseTimetable` back a new
  course page.
- **Search page.** A debounced client box writes `?q=` and soft-navigates; the
  server renders two result groups (Teachers, Courses) as compact full-width card
  grids. Teachers link to their weekly timetable; courses link to the new course
  page.
- **Course page** `/u/[slug]/courses/[id]` ("where and when this course runs"):
  every current session grouped by day, showing who (teacher), where (room),
  when (time), and which section, all linked.
- Added to the tenant nav.

## Data & migration impact

None (read-only).

## Tests

- Integration: `searchTeachers`/`searchCourses` (match by name and code, current
  entries only, no-match empty) and `courseTimetable`/`getCourse`.
- e2e: search by course term links to a course page; search by teacher name links
  to a teacher page.
- `pnpm turbo run typecheck lint format:check test build` (22),
  `pnpm test:integration` (module 25), `pnpm --filter web test:e2e` (13) pass.

## Verification steps

Open `/u/lgu/search`, type a teacher or course; click a teacher to see their week,
or a course to see where/when/who.

## Follow-ups

- SEO enumerates the search landing in the sitemap (SEO PR).
