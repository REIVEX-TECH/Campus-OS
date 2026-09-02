# fix(web): show readable course titles, not import slugs

Targets `main`. Display only. No schema change and no data change: the fix is in
what we render, not in what we store.

## What

The import gives a course a slug shaped `code` ("application-of-information-
communication-technologies") and a readable `title` ("Application of Information
& Communication Technologies"). Several surfaces led with the slug, which read as
noise and, once truncated, made two genuinely different courses look identical:
"application-of-information-communication-technologie..." was rendered for both
the course and its `-lab`. That is the whole of the reported "same course twice"
problem; the underlying tally was already correct.

Now the readable title is what appears:

- Teacher and room profiles: the "Courses taught" rows show the title alone.
- Course page: the heading was already the title; the breadcrumb above it showed
  the slug and now reads "Search". The page title drops the slug too.
- Search results: the slug subtitle under each course title is gone.
- Timetable filters: course chips are named by title. Titles are long, so a chip
  is capped and truncated with the full title on hover.

## Data & migration impact

None. `code` is untouched and still stored; it is simply no longer shown as a
name.

## Tests

- Unit (2 new, 53 total): repeats of one course collapse into a single tally
  carrying the right class count, and a course and its lab stay separate because
  they are different courses. These pin the behaviour that was suspected broken.
- `pnpm turbo run typecheck lint build test --filter=web` and
  `pnpm --filter web test:e2e` (32) pass.

## Verification steps

Open a teacher with a lecture and a lab: the two rows now read as distinct
courses. Open the filter panel: course chips carry titles.

## Follow-ups

- `course.code` has no short human code in the current import, only a slug. If a
  real course code (for example CS101) becomes available, the profile rows could
  show it alongside the title.
