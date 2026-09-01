# feat(web): SEO for LGU (metadata, sitemap, JSON-LD)

Targets `main`. Read-only; no schema or migration change, no new data. No secret
or verification token is committed.

## What

Strengthens search discoverability for the first tenant, targeting the query
**"LGU timetable"**.

- **Metadata** (`lib/metadata.ts`, `tenants/lgu/tenant.config.ts`): keywords and
  description tuned for "LGU timetable" / "Lahore Garrison University timetable"
  (and the LGU description's em dash is removed, per the no-dash rule). Adds a
  Twitter `summary_large_image` card and `metadataBase` alongside the existing
  canonical + OpenGraph.
- **Sitemap** (`app/sitemap.ts`): now enumerates every public URL. Adds
  `/free-rooms`, `/search`, every course page, and the "coming soon" module
  stubs to the existing home / timetable / sections / teachers / rooms. Still
  host-reflective (nested tenant-host URLs in production, `/u/{slug}` in dev). New
  `TimetableQueries.listCourseIdsWithEntries()` backs the course URLs.
- **Structured data** (`lib/json-ld.ts`, `_components/json-ld.tsx`):
  `CollegeOrUniversity` on the tenant home; `Course` (+ `provider` and one
  `CourseInstance` per weekly session, each with a schema.org `Schedule`:
  `byDay` + wall-clock `startTime`/`endTime`, weekly repeat) on course pages.
  `<` is escaped in the emitted JSON so scraped names can't break out of the
  script tag.
- **Search Console** (`app/layout.tsx`, `.env.example`, `docs/SEO.md`): an
  optional `GOOGLE_SITE_VERIFICATION` env var renders the verification meta tag
  when set. It is left unset; **no real token is in the repo**. `docs/SEO.md`
  covers DNS and HTML-tag verification, sitemap submission, and validation.

## Data & migration impact

None. Only reads.

## Tests

- Integration (`queries.integration.test.ts`): `listCourseIdsWithEntries()`
  returns the distinct course ids on current entries.
- e2e (`seo.spec.ts`): the tenant sitemap enumerates every public URL type
  (static pages, sections, courses, teachers, rooms, soon stubs) with absolute
  nested-host URLs; the tenant home carries `CollegeOrUniversity` JSON-LD.
- `pnpm turbo run typecheck lint build`, `pnpm --filter @campusos/module-timetable
test:integration` (27), and `pnpm --filter web test:e2e` (18) pass; format
  applied.
- Verified against local dev data: home + course JSON-LD parse correctly, the
  sitemap lists all 46 URLs, and the OG/Twitter/keywords/canonical tags render
  (no verification token present).

## Verification steps

`curl -H 'Host: lgu.<host>' https://.../sitemap.xml` lists every public URL.
View source on `/u/lgu` (CollegeOrUniversity) and a course page (Course with
weekly CourseInstances); validate with Google's Rich Results Test after deploy.
Follow `docs/SEO.md` to verify the property in Search Console.

## Follow-ups

- OpenGraph image generation (`next/og`) once a shared brand asset exists (cards
  are valid as text summaries meanwhile).
- Human-readable slug URLs for section/course/teacher/room pages.
