# fix(web): the course filter is called Course

Targets `main`. One label.

## What

The timetable filter group that filters by course was labelled "Class". That is
wrong twice over: everywhere else the app calls these Courses (Courses taught,
Courses held here, the Courses figure, the course pages, the Courses section of
search), and "classes" already means something else here, an individual scheduled
session, as in "2 classes a week" and "No classes match these filters".

So the panel offered a "Class" filter whose chips were courses, sitting beside a
message counting classes. It now reads "Course".

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build test --filter=web` and
  `pnpm --filter web test:e2e` (33) pass.

## Verification steps

Open the timetable filters: the group of course chips is headed "Course".

## Follow-ups

None.
