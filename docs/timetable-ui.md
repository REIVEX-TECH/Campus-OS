# Timetable UI

How the timetable renders — and, deliberately, how it renders **honestly**
against imported, partly-unverified data.

## Honest rendering rules

The current data is imported LGU fixtures: several dimensions are auto-created
`status='pending'`, and many entries have no room/teacher. The UI shows this
rather than hiding it.

- **Missing teacher / room** (null) → **"TBA"**, with a screen-reader label
  ("Teacher/Room to be announced"). Rooms are never invented; an unmatched room
  from ingestion stays null and is logged to `unmapped_source_values`.
- **Pending dimension** (`status='pending'` on a section, program, term, or
  teacher) → an **"Unverified"** badge (aria/title: "Imported automatically,
  pending review"). An entry is flagged pending when its section or teacher is
  pending.
- **Provenance footer** on every timetable view: "Imported from the university
  portal; some details are pending verification."
- **Term dates pending**: when a term has no start/end date, the section view
  shows a note that the calendar feed recurs weekly without an end date.
- **Empty states** (designed, not blank): no term published, no sections in the
  term, or no classes scheduled for a section/teacher/room.

## Freshness

Every timetable view shows **"Last updated <relative time>"** from the most
recent successful `ingestion_runs` row for the tenant. If no successful run
exists it says **"Not yet imported"** — never a fake timestamp.

## Accessibility

- The weekly grid is a semantic `<table>` with a `<caption>`, `scope="col"` day
  headers, and `scope="row"` time headers, so screen readers announce each class
  with its day and time.
- Every cell carries an aria-label summarising the class (course, kind, day,
  time, teacher, room).
- All interactive elements are keyboard reachable with a visible focus ring;
  colours use the design tokens (WCAG AA).

## Internationalisation

Every user-facing string — including aria labels and the "TBA"/"Unverified"
wording — goes through `t(locale, key)` bound to the tenant's locale
(`apps/web/lib/i18n.ts`, catalog in `apps/web/messages/`). English is the source
and fallback; add a catalog (e.g. `ur-PK`) to localise. Kind and day names are
translated too.

## SEO

Every route defines `generateMetadata`: the title composes the tenant's
`seo.titleTemplate` (from the `[slug]` layout) with the page name
(section/teacher/room), plus description, keywords, a canonical URL, and basic
OpenGraph. `robots.txt`/`sitemap.xml` remain tenant-driven (from Phase 1).

**URLs use raw UUIDs for now** (e.g. `/u/lgu/sections/<uuid>`). Human-readable
slug paths (e.g. `/u/lgu/timetable/bscs/5/a`) replace them in a follow-up, once
dimension data is verified enough to mint stable, collision-free slugs.

## Calendar feeds (ICS)

- Public, subscribe-by-URL feeds for public timetable data:
  `/u/{slug}/sections/{id}/timetable.ics` (and teacher/room). Per-user feeds
  arrive with identity later.
- Recurring **wall-clock** semantics (CLAUDE.md §5): `VTIMEZONE` + `DTSTART;TZID=`
  from the tenant timezone, weekly `RRULE`. The tz→VTIMEZONE map covers
  fixed-offset zones (incl. `Asia/Karachi`); an unsupported/DST timezone
  **throws** rather than emitting a wrong VTIMEZONE (Luxon-based DST support is a
  follow-up).
- **Stable UIDs** per logical slot `(sectionId, courseId, dayOfWeek, startsAt,
kind)` with a deterministic collision suffix, so calendar clients update in
  place instead of duplicating.
- When term dates are pending, the `RRULE` is open-ended (no `UNTIL`), anchored
  to the next matching weekday.

## Import boundary

The UI reads **`@campusos/db`** and **`@campusos/module-timetable`** only. It
must never import a data-source adapter (`@campusos/adapter-*`) — those are
ingestion-only. Enforced by an ESLint `no-restricted-imports` rule and the
`no-raw-db-import` test.
