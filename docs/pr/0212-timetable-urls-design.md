# docs(timetable): design pass for timetable URLs and brand disassociation

The design-first pass for the two timetable SEO tasks, before any build. Docs only.

## What

- `docs/design-timetable-urls.md` — the one-page design. It records what the codebase
  already does (section/teacher/room/course pages are already path-based and canonical;
  the only query-params-as-identity surface is the timetable picker's transient state; no
  structured data or metadata names Reivex), then the plan:
  - **Task 1**: move the picker to `/timetable/t/{term}/p/{program}/s/{section}` (optional
    catch-all, ids in the path, names in titles), 301 the old query form from middleware,
    canonical a fully-selected path to the existing `/sections/{id}` page, name-based
    metadata, and the one internal link moved to the path form. Teachers/rooms already use
    path identity, so no change there.
  - **Task 2**: add a CampusOS `Organization`/publisher entity and confirm `author` /
    `og:site_name` say CampusOS; the reivex.io link removal, the Search Console _Domain_
    property, and the root-domain question are external/decisions captured for Ahad.

## Notable finding

Much of the intended SEO outcome (clean, path-based, canonical section URLs) already
holds via `/sections/{id}`. The genuine work is the picker's shareable URLs + 301s +
name-based picker titles, and the CampusOS entity. The doc carries one decision for Ahad:
keep `/sections/{id}` as the canonical section page (chosen) vs. promote the picker path to
canonical (deferred, larger).

## Data & migration impact

No schema change. Docs only.

## Tests / verification

`prettier --check` passes. Build PRs follow (SHA per PR): the picker path conversion, then
the brand/metadata changes.
