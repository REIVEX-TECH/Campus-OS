# feat(web): compactness pass across the tenant pages

Targets `main`. PR 3 of the UI redesign. Spacing/type only; no schema, no
migration, no logic change.

## What

Tightens the tenant pages so the layout carries less empty space, keeping an
iOS/Reddit density without feeling cramped. Applied consistently across the
tenant pages and the timetable view components:

- Page-level stacks: `gap-6 → gap-5` (and `gap-8 → gap-6` on the roomier hub and
  search pages).
- Inner-page headings: `text-3xl → text-2xl` (the hub keeps its larger display
  heading; the platform landing is untouched).
- Card padding: `p-5 → p-4`.

The three-column shell, the timetable form/results split, and every page's
behaviour are unchanged; this is purely density.

## Data & migration impact

None.

## Tests

- No new tests (spacing only). `pnpm turbo run typecheck lint build` and
  `pnpm --filter web test:e2e` (26) pass; format applied.
- Verified visually (light + dark): tighter headings and denser cards on the
  timetable, search, and free-rooms pages, with no layout breakage and no inner
  scrollbars.

## Verification steps

Open any tenant page: headings are `text-2xl`, cards use `p-4`, and page stacks
are `gap-5` — visibly denser than before, still comfortable.

## Follow-ups

- Contextual right rails were added where genuinely useful (hub "About",
  timetable "free rooms now"); other pages omit the rail rather than pad it.
  Search "recent/popular" could be a later add (recents need per-viewer storage).
