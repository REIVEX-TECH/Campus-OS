# feat(web): iOS-light redesign + cascading timetable picker + Part A fixes

Targets `main`. No schema change, no migration. Second of two PRs; PR #12
(platform root, force light, section sitemap URLs) landed first.

## What

**Part A: fix what was broken (navigation + SEO).**

- **Grid names are now links.** The weekly grid rendered teacher and room names as
  plain text, so there was no way to reach a teacher's or room's timetable. Each
  teacher/room now links to `/teachers/{id}` and `/rooms/{id}` (accent green,
  underline on hover). When a teacher or room is unmapped the cell shows the
  accessible "TBA" text, not a dead link. This closes the "teachers nothing
  showing" gap: teacher views always returned data, nothing linked to them.
- **Cascading picker replaces `terms[0]`.** The old picker dumped every section
  and implicitly used the first term. The new picker (below) selects a term
  explicitly and only surfaces sections that exist.
- **Sitemap now lists teacher and room URLs.** `sitemap.ts` enumerates sections
  (already added in #12) plus every teacher and room that appears on a current
  entry, via two new distinct-id queries. Previously teacher/room pages had zero
  discoverable URLs.

**Part B: iOS-light design language.**

- **Tokens (`packages/ui/src/styles/globals.css`).** Light iOS grouped model:
  systemGroupedBackground grey page (~`#F2F2F7`), white cards, a single flat drop
  shadow (`--shadow-card`, `--shadow-card-strong`) replacing the old neumorphic
  dual-shadow pair, the SF system font stack, 17px body, a 12px/16px radius
  scale. The `prefers-color-scheme` auto-dark block is gone (the app is forced
  light via `<html class="light">` from #12); `.dark` stays defined but dormant.
- **Components.** Flat iOS `Button` (pressable scale, accent-filled default,
  `outline` = white card), `Card` (`ios-card rounded-2xl`, `flat`/`pressable`),
  `Input`/`Select` (`.ios-field` filled control with a focus ring), pill `Badge`,
  centred `EmptyState`.
- **Weekly grid.** Redesigned to a mobile-first, day-grouped list: one white card
  per weekday, classes separated by spacing (no divider lines). Times display as
  `HH:MM` ("08:00 to 09:30"). Semantic structure preserved: an sr-only grid
  caption, a heading per day, a list of classes with full aria labels; TBA,
  Unverified, and freshness states kept.
- **Cascading picker (the core flow).** `app/_components/timetable-picker.tsx`
  (thin `'use client'`): semester then program then section, each choice
  revealing the next. State lives in the URL query (`?term&program&section`) so a
  chosen timetable is shareable and back-navigable; updates are a soft navigation
  (`router.replace`, no full reload). The timetable renders inline once a section
  is chosen, with a Subscribe (ICS) control for that section. Backed by three new
  read queries: `listTermsWithSections`, `listProgramsByTerm`,
  `listSectionsByProgramTerm`.
- **Docs.** `docs/design.md` rewritten for the iOS-light language, with a
  recomputed WCAG table for the new palette and the cascading-picker pattern
  documented.

## Assumptions & open questions

- Rooms are largely unmapped in the LGU source, so most room cells are honestly
  "TBA" and room sitemap URLs are sparse; this is expected, not a bug.
- The inline timetable and the standalone `/sections/{id}` page both offer the
  section ICS feed. The standalone section page is retained for SEO and deep
  links even though the picker no longer links to it directly.

## Data & migration impact

No schema change. The three cascade queries and the two sitemap queries are
read-only and use existing columns and indexes (no new indexes required for the
fixture and current production volume).

## Tests

- **Integration** (`packages/modules/timetable/test/queries.integration.test.ts`):
  the seed now adds a second term with no sections and a second program, so the
  cascade filters are proven: `listTermsWithSections` drops the empty term,
  `listProgramsByTerm` returns the distinct programs (including a pending one) in
  a term and nothing for an empty term, `listSectionsByProgramTerm` returns only
  one program's sections, and the sitemap id queries return the distinct teacher
  and room ids. Run: `pnpm --filter @campusos/module-timetable test:integration`.
- **E2E** (`apps/web/e2e/timetable.spec.ts`), rewritten for the cascade: driving
  semester then program then section renders the timetable inline and its ICS
  feed returns a valid calendar; a teacher name in the grid links to the teacher
  view and that view renders. Run: `pnpm --filter web test:e2e`.
- WCAG ratios recomputed for the new palette; every pairing clears AA (lowest
  6.47:1), nearly all clear AAA.

## Verification steps

- `pnpm format && pnpm turbo run typecheck lint format:check test build`
  (22 tasks pass).
- `pnpm test:integration` (db + timetable, serialized; 12 tests pass).
- `pnpm --filter web test:e2e` (5 tests pass).
- Visual: `http://localhost:<port>/u/lgu/timetable`, pick BSCS then Sec A, confirm
  the inline grid, green teacher links, TBA rooms, Unverified pills, Subscribe.

## Follow-ups

- Teacher/room admin mapping so more rooms resolve past "TBA".
- Optional: an empty-term aware default when a tenant has multiple live terms.
