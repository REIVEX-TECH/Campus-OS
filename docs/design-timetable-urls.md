# Timetable URLs and brand disassociation — design

Two SEO tasks: (1) move the timetable picker from query params to path segments, and (2)
disassociate `*.campusos.reivex.io` from the Reivex brand in Google's eyes. Pure
URL/metadata work; no content or activity changes. Design first, then build one PR per
piece (SHA per PR).

## What the codebase already does (investigated first)

- **Section, teacher, room and course pages are already path-based and canonical.**
  `/sections/{id}`, `/teachers/{id}`, `/rooms/{id}`, `/courses/{id}` are the indexable
  pages: they are in `sitemap.ts`, carry name-based `<title>`s (e.g. the section page
  titles `"{program.code} {section.name}"`), and are what internal links and the ICS
  feeds point at. **Teachers and rooms use path segments for identity today**, so the
  task's "apply to teachers/rooms if they use query params for identity" is a no-op there
  (confirmed: nothing to convert).
- **`/timetable` is the interactive picker.** Its `?term&program&section` are transient
  cascading-picker state; the page `canonical`s to `/timetable` (params stripped), and the
  section content a visitor drills into has its canonical home at `/sections/{id}`. So the
  only query-params-as-identity surface is the picker's shareable state.
- **No structured data or metadata names Reivex.** JSON-LD is `WebSite` (name "CampusOS"),
  `CollegeOrUniversity` (the tenant), `Course`/`CourseInstance` (the tenant as provider) —
  none mention Reivex. `og:site_name` is the tenant display name (tenant pages) / "CampusOS"
  (platform). There is no Organization/Publisher schema and no `author` meta at all. The
  only in-repo "Reivex" strings are the open-source GitHub links and the marketplace policy
  operator ("Reivex Technologies"), which is legal content and out of scope here.

Net: much of the SEO goal (clean, path-based, canonical section URLs) already holds. The
genuine work is below.

## Task 1 — picker query params to path segments

**Shape.** `/timetable?term=X&program=Y&section=Z` becomes
`/timetable/t/{term}/p/{program}/s/{section}`, prefixed (`t`/`p`/`s`) so the shape is
unambiguous and order-checked. Partial states are the ordered prefixes: `/timetable`,
`/timetable/t/{term}`, `/timetable/t/{term}/p/{program}`. Segments carry **ids** (matching
the existing `/sections/{id}`, `/teachers/{id}` convention and avoiding slug-uniqueness
work); **names go in titles and meta**, per the task.

**Route.** Convert `timetable/page.tsx` to `timetable/[[...filters]]/page.tsx` (optional
catch-all). It parses the ordered prefix pairs, then renders exactly today's picker +
inline preview — behaviour is unchanged, only the URL encoding changes. Unparseable shapes
(wrong/again prefixes) `notFound()`; a valid shape with a stale id degrades to the picker
default, as the query form does today.

**Redirects (301, permanent, ≥90 days).** A pure `legacyTimetableRedirect(pathname,
searchParams)` helper, called from `middleware.ts` (which already emits status-coded
redirects), maps a legacy `/timetable?term[&program[&section]]` to the path form and
returns a 301. It requires `term`, and includes `program`/`section` only alongside their
parents (a stray `?program=` with no term canonicalises to `/timetable`). Unit-tested.

**Canonical.** A fully-selected path (`.../s/{id}`) sets its canonical to
`/sections/{sectionId}` — the existing dedicated page — so there is exactly one canonical
per section rather than two indexable URLs for the same timetable. Partial states canonical
to `/timetable`. So an old indexed `/timetable?...section=Z` 301s to the pretty picker path
(where a human lands in the picker) and consolidates, via canonical, to `/sections/Z`.

> **Decision for Ahad (not acted on):** we keep `/sections/{id}` as the canonical section
> page and dedup the picker to it. The alternative — promote `/timetable/t/.../s/{id}` to
> the canonical and 301 `/sections/{id}` onto it — is a larger change (ICS routes, sitemap,
> every cross-link) and is deferred. The picker-path work is reused either way; only the
> canonical target would flip.

**Titles/meta from names.** `generateMetadata` resolves the selected ids to names:
section -> `"{program.code} {section.name}"`; program -> `"{program.name} · {term.name}"`;
term -> `"{term.name}"`; none -> the generic heading.

**Internal links, sitemap, structured data.** The one internal query-param link (the
`RecordRecent` href) moves to the path form via a shared `buildTimetablePath` helper (also
used by the picker client and metadata). The sitemap already lists `/sections/{id}` and no
query URLs, so it needs no change; structured data already uses path ids. Documented rather
than edited where already correct.

## Task 2 — brand disassociation

**In-repo (buildable now).** Add a CampusOS `Organization` JSON-LD on the platform landing
(name "CampusOS", the platform url, `logo` `/icon.png`, `sameAs` the CampusOS GitHub org),
and reference it as the `WebSite` `publisher`; set `author`/`og:site_name` to "CampusOS" on
the platform metadata. Confirm (already true) that no schema or meta names Reivex. This
gives Google an explicit CampusOS entity to attach the site to.

**External / notes (cannot be done in this repo).**

- **Remove Reivex-property links to `*.campusos.reivex.io`** (footers, case studies, blog,
  portfolio on reivex.io / reivex.com). Those sites are not in this repository. -> Ahad.
- **Add + verify a Search Console _Domain_ property for `campusos.reivex.io`.** Google-side;
  the app already renders `<meta name="google-site-verification">` from
  `GOOGLE_SITE_VERIFICATION` (see `docs/SEO.md`) if a token is set. -> Ahad.
- **Own root domain (`campusos.io`) long-term.** A branding/infra decision, noted only. -> Ahad.

These are captured in `docs/SEO.md` so the human steps live next to the existing ones.

## Verification

`curl -I` an old query URL returns 301 to the path form; the path form renders with a
name-based title and a `/sections/{id}` canonical; partial states canonical to `/timetable`;
no query-params-as-identity URL remains in links or sitemap. Unit tests cover
`legacyTimetableRedirect` and `buildTimetablePath`; the timetable e2e is updated to the path
form.
