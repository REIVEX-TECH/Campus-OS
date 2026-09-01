# feat(web): timetable redesign, colour-coded views (grid flagship)

Targets `main`. UI only: no schema, migration, or query change. Second overnight
PR; builds on the shell + dark mode (#21).

## What

Makes the four timetable views genuinely good, in both themes, full-width, compact.

- **Colour-coded blocks.** A course maps to one of eight hues (`eventColorClass`,
  a deterministic hash of the course id), so every session of a course shares a
  colour and the week reads at a glance. Tints stay near the surface lightness
  (pale in light, deep in dark) with a stronger left bar, and text is always
  `--foreground`, so every block clears WCAG AA in both themes regardless of hue.
  Palette lives in the design system (`.evt-0..7`, plus `.dark` variants and an
  `.evt-dot`).
- **Grid (flagship).** Full-width week: weekday columns, a sticky-left time gutter
  (stays put on horizontal scroll), a crisp hour ruler, colour blocks placed and
  sized by time with overlaps split into side-by-side lanes, and a live "now" line
  in today's column. Horizontal-scroll container on mobile so the page never
  scrolls sideways.
- **Timeline / Days / List.** Timeline gets the colour blocks + "now" line and
  keeps its gap emphasis; List and Days get a course colour dot. All compact and
  correct in light and dark.
- **Responsive default.** Grid on desktop, List on mobile (applied on mount); the
  switcher is kept and the single pending-review header note stays (no per-row
  badges).

## Data & migration impact

None.

## Tests

- Existing unit + e2e updated to be view-independent (the default view is now
  responsive): the cascade/section specs detect a rendered timetable by the view
  switcher, and the teacher-link check switches to List (row views carry the
  links). Time-scale/`eventColorClass` covered by the existing unit suite.
- `pnpm turbo run typecheck lint format:check test build` (22) and
  `pnpm --filter web test:e2e` (11) pass.
- Verified live on a real LGU section (15 classes) in both themes: colour-coded
  full-width grid, timeline gaps, instant switching.

## Verification steps

Open a section, default to Grid on desktop; confirm colour-coded blocks (same
colour per course across the week), the time gutter, and (on the current day) the
"now" line; toggle dark and re-check.

## Follow-ups

- Extend the colour-coded views to the teacher and room pages (still the old
  grid).
- Once a default view is chosen from live use, drop the unused ones.
