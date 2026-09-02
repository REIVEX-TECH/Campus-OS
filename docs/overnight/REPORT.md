# Overnight run: report

Every PR shipped through the normal loop: branch, PR, CI green, merge. No gate was
weakened and nothing was merged red.

Anything stopped rather than guessed is in `DECISIONS.md`.

---

## Merged

| #   | PR                                                                     | Merge SHA |
| --- | ---------------------------------------------------------------------- | --------- |
| 56  | `fix(web): show readable course titles, not import slugs`              | `75d70e9` |
| 57  | `fix(web): set metadataBase so social cards resolve`                   | `25dcb6f` |
| 58  | `feat(web): illustrated generated avatars`                             | `18c7184` |
| 59  | `feat(identity): the identity data model and its isolation guarantees` | `d1fb575` |
| 60  | `feat(core): tenant join mode setting`                                 | `2de96c1` |

---

## A. Bug fixes

**1 and 2, course names and the duplicate course, were one bug.** The import gives
a course a slug shaped `code` and a readable `title`. Several surfaces led with the
slug, so a course and its lab both truncated to
`application-of-information-communication-technologie...` and read as the same row
rendered twice. The underlying tally was already correct and deduplicated by course
id. Fixing the display fixed both reports. Titles now appear on teacher and room
profiles, the course page, search results, and the filter chips, with chips capped
and the full title on hover. Two unit tests pin the dedup so the suspicion cannot
resurface silently.

**3, metadataBase.** Tenant pages already set it per request. The warning came from
the statically rendered routes, the 404 and the platform opengraph image, which
have no request host to read. The root layout now sets it from `PLATFORM_HOST`,
falling back through `TENANT_BASE_DOMAIN` and `APP_DOMAIN`. Deliberately
configuration rather than `headers()`: reading the host in the root layout would
opt the whole tree into dynamic rendering to fix metadata for the few routes that
have no host anyway. `.env.example` documents the dependency.

## B. Illustrated avatars

DiceBear, server rendered. People get **Notionists**, a hand drawn character
style; rooms get **Shapes**, because a face on a lecture hall reads as a mistake.
Seeded by entity id, so one teacher always resolves to one picture.

Licences checked before adding, as asked: `@dicebear/core` MIT,
`@dicebear/collection` MIT, the Notionists artwork **CC0 1.0** (Zoish), Shapes
MIT. Nothing needs runtime attribution.

Two things worth knowing:

- The first install resolved `@dicebear/collection@9` against `@dicebear/core@10`,
  which throws on import because `escape` was removed in core 10. Core is pinned
  to 9 to match.
- Each illustrated SVG is roughly 11KB, so inlining twenty of them would add
  hundreds of KB to the HTML on every load. They are served from
  `/api/avatar/[kind]/[seed]` with an immutable cache header, which is honest
  because the output is a pure function of the seed. The client ships no avatar
  code, and the same component works from server and client trees.

## C. Identity foundation

**Identity PR 1 shipped.** The module package, six tables, their RLS policies, the
`app.user_id` context with `withActor` and `withActorInTenant`, and twelve
integration tests that are the actual deliverable: a user reads only their own
row and cannot write a row claiming another identity, no context returns nothing,
membership reads work in both directions without leaking one tenant's members to
another, and the audit log survives an attempted update and delete unchanged.

Building it surfaced two real problems:

- **`auth_resolve_session` cannot work as designed** and was not shipped. See
  `DECISIONS.md` item 1. It blocks identity PR 2.
- **Modules were silently skipping each other's migrations.** Drizzle applies only
  migrations dated after the last one recorded, and every module shared one
  bookkeeping table. Adding identity, dated later than timetable, made a fresh
  database record identity and then skip every timetable migration, so
  `departments` was never created. Each module now names its own table. Base and
  timetable stay on the default, so no existing database re-runs anything. This
  was a latent bug that would have hit the next module regardless.

**Identity PRs 2 to 4 were not started**, per `DECISIONS.md` item 2: the
instructions conflict on whether to run them unattended, and PR 2 is blocked on
the session resolution decision anyway.

**`join_mode`** shipped separately as an additive, inert tenant setting, since it
was approved and does not depend on membership existing.

---

## Gate status

Every merge was CI green on all three jobs: typecheck/lint/format/build/test, e2e
smoke, and integration on Postgres with RLS. The known flaky `@campusos/db`
deadlock did not appear. Two unrelated flakes were seen locally and cleared on
re-run without any test being weakened: the semester combobox URL assertion, which
was hardened earlier with a longer timeout because picking a term runs a soft
navigation, and one stale-build race in the web e2e.
