# feat(timetable): picker URLs as path segments, 301 the legacy query form

Run of the timetable SEO work, Task 1. The timetable picker's shareable state moves from
`?term&program&section` to `/timetable/t/{term}/p/{program}/s/{section}`, the old query form
301s to it, and the picker's title/metadata are rendered from the resolved names. Picker
behaviour is unchanged; only the URL encoding and metadata change. Applies to every tenant.
See `docs/design-timetable-urls.md`.

## What

- `apps/web/lib/timetable-url.ts` (new) — pure, unit-tested helpers shared by the picker,
  the page metadata, and middleware: `buildTimetablePath`, `parseTimetableFilters`
  (ordered, prefixed `t`/`p`/`s`; rejects wrong shape), and `legacyTimetableRedirect`.
- `apps/web/app/u/[slug]/timetable/[[...filters]]/page.tsx` (replaces `timetable/page.tsx`)
  — an optional catch-all that parses the path segments and renders the same picker +
  inline preview. `generateMetadata` resolves the ids to names for the title, and sets the
  canonical to `/sections/{id}` when a section is fully chosen (dedup with the dedicated
  page), else `/timetable`. Unparseable segment shapes `notFound()`.
- `apps/web/middleware.ts` — 301s a legacy `/timetable?term[&program[&section]]` to the
  path form (on the canonical host), via `legacyTimetableRedirect`. Permanent, so indexed
  and externally linked URLs keep working.
- `apps/web/app/_components/timetable-picker.tsx` + `timetable-workspace.tsx` — the picker
  navigates the path form (built from a `basePath` prop) instead of writing query params.
- `apps/web/app/u/[slug]/timetable/[[...filters]]/page.tsx` — the one internal deep link
  (the `RecordRecent` href) uses the path form; old stored recents keep working via the 301.
- `apps/web/lib/metadata.ts` — the stale "slug paths replace ids" note updated to reflect
  the prefixed-id path + names-in-titles decision.

## What did not change (documented in the design)

Section, teacher, room and course pages are already path-based and canonical
(`/sections/{id}`, `/teachers/{id}`, …); they are the indexable pages and are already in
the sitemap, so teachers/rooms need no conversion and the sitemap/structured data need no
edit. The section content's canonical home stays `/sections/{id}`; the picker dedups to it.

## Data & migration impact

No schema change. URL/metadata only.

## SEO review

- **301, permanent (>=90 days).** The legacy query form redirects to the path form on the
  canonical host; a fully-selected path then declares its canonical as `/sections/{id}`, so
  an old `/timetable?...section=Z` consolidates to `/sections/Z` while a human lands in the
  picker. Partial states canonical to `/timetable`.
- **No redirect loop.** The redirect only fires on the picker root with legacy params and
  strips the query; the path form does not match, and orphan params (no term) collapse to
  the bare picker once.
- **Titles from names, not ids**, per the task.

## Tests / verification

`turbo run typecheck lint` and the web vitest suite (150, incl. the new
`timetable-url.test.ts` covering build/parse/redirect) pass; the production build succeeds.
The timetable e2e is rewritten to drive and assert the path form, and adds a check that the
legacy query URL returns a 301 to the path form.

## Follow-ups

The canonical-strategy decision (keep `/sections/{id}` canonical, chosen) is noted for Ahad
in the design doc, with the larger alternative deferred. Task 2 (brand disassociation) is a
separate PR.
