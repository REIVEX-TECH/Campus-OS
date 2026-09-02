# Overnight autonomous run — final report

## Session 2026-09-02 (current overnight batch)

Full-width shell + dark mode, timetable redesign, free rooms, search, module
stubs, landing pages, admin analytics, and SEO. Many small PRs, each green before
the next. Anything deferred is in [DECISIONS.md](DECISIONS.md).

**All eight scoped items shipped and merged (#21 through #28).** Continued
polish (platform-landing SEO, #29 onward) follows the same one-PR-per-change
loop. No auth, accounts, or community/marketplace features were built (those are
a separate design session); the future modules are "coming soon" stubs only.

| PR                                   | Merge SHA | Shipped                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #21 full-width app shell + dark mode | `5b7e4da` | Live dark/light theme (no-flash script + header toggle, `prefers-color-scheme` default), theme-aware tenant accent (lightened for dark, AA), full-width `AppShell` replacing the max-w-3xl column across all tenant pages. Docs: design.md dark tokens + AA.                                                                                                                                                                    |
| #22 timetable redesign               | `c73579f` | Colour-coded per-course blocks (8-hue, theme-aware, AA), flagship full-width week Grid (proportional blocks, sticky-left time gutter, crisp hour ruler, "now" line), Timeline "now" line, List/Days course dots; responsive default (Grid desktop, List mobile); all four views polished in both themes.                                                                                                                        |
| #23 free rooms                       | `5f5602d` | Public read-only free-rooms page: pick day + time (defaults to "free now" in the tenant timezone), see free rooms as cards linking to each room's schedule. New `TimetableQueries.freeRooms` (name + building), tenant-time helper, nav item. Full-width, iOS, both themes.                                                                                                                                                     |
| #24 search                           | `40ae5e5` | Public read-only search: teacher to their week, course to a "where/when/who" page. Debounced client box writing `?q`, `searchTeachers`/`searchCourses`/`getCourse`/`courseTimetable`, new `/courses/[id]` page, nav item. Full-width, iOS, both themes.                                                                                                                                                                         |
| #25 module stubs                     | `a68abc6` | Tenant home becomes a module hub: 8 module cards (3 live → their pages, 5 "Coming soon" stubs). New `lib/modules.ts` catalogue + `soonModule` validator, `/soon/[module]` stub page (notFound for live/unknown keys), i18n for all module labels/descriptions, e2e. Pure UI, no auth, no feature logic.                                                                                                                         |
| #26 landing pages                    | `121f344` | Full-width platform landing (`/`): minimal frosted header (brand, GitHub, theme toggle), hero, four value-prop feature cards, universities grid. New `PlatformHeader` gives the platform host a theme toggle it lacked. Tenant landing is the module hub (#25). Compact, both themes, e2e.                                                                                                                                      |
| #27 admin analytics                  | `909b32e` | Read-only `/admin/analytics` behind the existing admin gate: at-a-glance totals, teacher/room coverage bars, classes by kind and by ISO weekday, pending-review counts. New `TimetableQueries.analytics()` (aggregate counts only, no new data), SSR CSS bars (no chart lib). Integration + e2e.                                                                                                                                |
| #28 SEO for LGU                      | `3223ec4` | Metadata tuned for "LGU timetable" (keywords + description, no em dash) with Twitter cards and `metadataBase`; sitemap now enumerates every public URL (adds free-rooms, search, courses, soon stubs) with nested-host URLs; JSON-LD (`CollegeOrUniversity` on home, `Course` + weekly `CourseInstance` schedules on course pages); optional `GOOGLE_SITE_VERIFICATION` slot (no real token); `docs/SEO.md`. Integration + e2e. |
| #29 platform SEO                     | `46582c5` | Give the platform landing (`/`) the metadata it lacked: canonical, OpenGraph, and a Twitter card, plus a `WebSite` JSON-LD node. Every public page now has full social/canonical metadata. e2e.                                                                                                                                                                                                                                 |
| #30 404 polish                       | `61a62cc` | Polish the global 404: iOS-clean centred layout, i18n strings (was hardcoded English), a "Back to homepage" action, and a semantic `h1`. Fixes a real bug where the not-found boundary dropped the pre-paint theme class on hydration, so the 404 now honours light + dark (post-hydration re-apply). e2e.                                                                                                                      |
| #31 error boundary                   | `acc58fc` | Add a themed segment error boundary (`app/error.tsx`): a runtime error now shows a clean "Something went wrong" page with "Try again" (reset) and a home link, in light + dark (reuses the 404's theme re-apply), instead of a bare fallback. i18n. Verified in a prod build via a temporary throwing route.                                                                                                                    |
| #32 skip to content                  | `14b1382` | Accessibility: a "Skip to content" link (first tab stop, visually hidden until focused) on the tenant app shell and platform landing, jumping keyboard and screen-reader users past the header nav to the `#main` landmark. i18n. Keyboard-focus e2e.                                                                                                                                                                           |
| #33 admin noindex                    | `e729c9e` | Add an admin `layout.tsx` setting `robots: noindex, nofollow` for the whole admin subtree, so the publicly reachable login (and everything behind it) is never indexed. Public pages are unaffected. e2e asserts the login carries `noindex`.                                                                                                                                                                                   |
| #34 OG images                        | `9a53883` | Generated OpenGraph/Twitter card images (1200x630) via first-party `next/og` (server-only, no client bundle, no external asset): a per-tenant card (brand dot in the tenant accent, university name, tagline) and a platform card. `og:image` + `twitter:image` now wired on every page. e2e.                                                                                                                                   |
| #35 app identity                     | `8704459` | App identity that was missing: a branded SVG favicon (`app/icon.svg`), a generated 180x180 apple-touch icon (`next/og`), a web manifest (installable PWA basics), and per-theme `theme-color` for the mobile browser chrome. No binary assets committed. e2e.                                                                                                                                                                   |
| #36 loading skeleton                 | `e1ed024` | A calm on-brand loading skeleton for the timetable picker (its reads are the heaviest tenant page). Scoped to that leaf route on purpose: a route-group-wide loading boundary streams every tenant page, which turns a `notFound()`/`redirect()` into a committed 200 (the e2e caught exactly this). Verified the skeleton renders via a temporary delay.                                                                       |
| #37 grid keyboard a11y               | `fbcf656` | Make the flagship week grid a keyboard-focusable, screen-reader-named scroll region (`role="region"`, `aria-label`, `tabIndex=0`, focus ring). It scrolls sideways on narrow screens, so keyboard users can now reach and scroll it (WCAG 2.1.1). e2e asserts the region + tabindex.                                                                                                                                            |

### Session summary

**17 PRs, all merged to `main` first-try green** (#21 through #37): the eight
scoped items (#21 to #28) plus nine polish/hardening changes (#29 to #37).

- **Verification.** Every change ran the full gate (`typecheck lint format build`
  - unit/integration + Playwright e2e) locally and in CI before merge. UI was
    checked visually in light **and** dark on a production build via the in-app
    browser (theme toggle + `colorScheme` emulation); data-backed pages were
    checked against the local `campusos_dev` slice. Transient states (error
    boundary, loading skeleton) were proven with temporary instrumentation that was
    removed before commit.
- **Performance budget met.** Largest route first-load JS is **121 kB** (section
  and timetable pages), against the 200 kB/route budget; shared baseline 103 kB.
  No chart or heavy client library was added (admin charts are SSR CSS; OG images
  and icons are server-only `next/og`).
- **Hard rules held.** No auth, accounts, login, Firebase, or
  community/marketplace features were built; future modules are "coming soon"
  stubs only. No secret or verification token is committed. No gate was weakened.
  No architectural fork was guessed (none arose this run).
- **e2e grew** from 13 to 22 specs; the module integration suite from 25 to 27.

_The prior run's report follows below._

## ⚠️ Read first

All three phases were built, reviewed by CI, and **merged to `main`** cleanly.
One goal inside Phase 2 was **paused, not achieved**, for a safety reason:

- **The live full LGU crawl and fresh full real data were NOT collected.** The
  source host `timetable.lgu.edu.pk` is currently unstable: it intermittently
  round-robins between the real Cloudflare portal (works) and a Vercel edge that
  returns 404 (fails), in bursts lasting minutes. This is genuine upstream
  flakiness (confirmed by diagnostics; not a block, no 403/429/challenge), not a
  bug in our crawler. Per the overnight rules I stopped rather than hammer a
  failing host, and did not fabricate data. The full-crawl CODE shipped and is
  tested; the real full ingest awaits a stable portal window. Details and the
  recommendation are in [DECISIONS.md](DECISIONS.md).

Everything else landed. The app is **deploy-ready pending the human steps** in
[docs/DEPLOY.md](../DEPLOY.md) (accounts, secrets, DNS, run migrate/seed/ingest,
map rooms, flip on the scheduled ingest).

## Phases

| Phase                         | PR                                                    | Merge SHA                                  | CI                | Notes                           |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------ | ----------------- | ------------------------------- |
| 1. Design system + room admin | [#4](https://github.com/REIVEX-TECH/Campus-OS/pull/4) | `00b5489e73629555046960d0b420daa39e6b4258` | green (first run) | room=TBA 41/41 -> 0/41          |
| 2. Full LGU crawl             | [#5](https://github.com/REIVEX-TECH/Campus-OS/pull/5) | `aa45f9180a634e1d1db74d61e855ec0b0ab830d3` | green (first run) | code + tests; live data BLOCKED |
| 3. Deploy prep                | [#6](https://github.com/REIVEX-TECH/Campus-OS/pull/6) | `327b05bc24e71a02177dfd6e18fdd1492e90ae68` | green (first run) | config + runbook only           |

No flaky `@campusos/db` deadlock recurred; no gate was weakened.

## Phase 1 — design system + room-mapping admin

- **Design language** documented in [docs/design.md](../design.md) and encoded in
  `packages/ui`: minimalist flat base, neumorphism ONLY on interactive surfaces,
  static content flat and high contrast. WCAG AA verified with computed ratios
  (lowest 6.47:1 white-on-destructive; tenant accent 7.95:1; neutral surfaces 16
  to 18:1). Dark mode activated (system preference); tenant accent injected live
  from config with no FOUC.
- **Two hard rules enforced**: no dash punctuation (Vitest scanner over
  `messages/*.ts` + ESLint JSXText rule; plain hyphen kept) and no divider lines
  (spacing only). Every existing occurrence fixed (grid time reads "8:00 to 9:30").
- **Room-mapping admin** (`/u/[slug]/admin/rooms`): a `room_source` column
  (migration `0002`, additive/nullable) lets the resolver back-fill blocked
  entries in place with a recomputed `content_hash` equal to the next ingest's, so
  map-then-reingest is a no-op. Sink self-heals via resolved aliases so mappings
  survive re-crawl.
- **room=TBA before/after** (fixture ingest into `campusos_dev`, then map all
  pending rooms via the flow):

  ```
  BEFORE: entries=41  room=TBA 41/41  pending rooms=15
  mapped 15 rooms, resolved 41 entries
  AFTER:  entries=41  room=TBA 0/41
  ```

## Phase 2 — full crawl (code shipped; live data blocked)

- `crawl()` now walks the full semester x degree x section product; one bad
  section becomes an anomaly and is skipped, a real block aborts, and in fixture
  mode a not-recorded combo is skipped silently. The live client retries transient
  failures (incl. the flaky-host 404 blips) with backoff; the autonomous session
  mint retries through bad bursts; optional politeness caps bound a run. normalize
  spans many semesters/degrees and maps anomalies to unmapped records.
- Tested with a synthetic self-consistent multi-combo fixture set (cartesian +
  anomaly + caps) and the real recorded slice (clean, zero network).
- **Full-data numbers: not collected** (portal flakiness, see the top). The
  fixture-mode ingest is unchanged from the recorded slice: 41 entries, clean.

## Phase 3 — deploy preparation (config only)

- `vercel.json` (Turborepo build, Next framework, lazy-DB build), full
  [docs/DEPLOY.md](../DEPLOY.md) runbook + readiness checklist, and the scheduled
  ingest workflow enabled behind the `HOSTED_DB_ENABLED` repo-variable gate
  (autonomous session, idempotent migrate, full crawl, twice daily).
- Multi-tenant host routing verified: `subdomainOf('lgu.reivex.io','reivex.io')`
  resolves the `lgu` tenant; SEO/robots/sitemap/canonical derive from the live
  host. Production needs only `APP_DOMAIN=reivex.io`.
- `next build` needs no DB (lazy client; the CI verify job builds with no
  `DATABASE_URL`). Nothing was deployed; no secret was placed.

## How the admin authz gate is enforced (Phase 3 depends on this being real)

- Env `ADMIN_SECRET` enables admin; if unset, admin **fails closed** (all access
  denied).
- `/u/[slug]/admin/login` compares the submitted secret in constant time and, on
  success, sets an **HttpOnly, SameSite=Lax, per-tenant signed cookie** =
  HMAC-SHA256 of the tenant slug keyed by the secret. It cannot be forged without
  the secret, and a token for one tenant does not authorize another.
- **Every admin page** calls `requireAdmin(slug)` (server component) and redirects
  unauthenticated visitors to login. **Every mutation** (`POST /admin/rooms/resolve`,
  `/admin/login/submit`, `/admin/logout`) verifies the cookie server-side and
  returns 401 **before any database access**. So the protection is real
  server-side enforcement, not a hidden URL or a client-only control. Login is
  rate limited. This is a documented stopgap until the identity module.
- Proven by: a unit test (forged / wrong-tenant / wrong-secret / missing all
  rejected; valid accepted) and an e2e (the admin route redirects and the mutation
  endpoint returns 401 when unauthenticated).

## Morning human checklist (get lgu.reivex.io live)

Full detail in [docs/DEPLOY.md](../DEPLOY.md); the ordered list:

1. **Neon**: create a free project. Create the `campusos_app` role (`NOBYPASSRLS`,
   a strong password you choose) and the `campusos` database. Copy the direct and
   pooled connection strings.
2. **Migrate + seed + ingest** locally with `DATABASE_URL` = Neon direct string:
   `pnpm db:migrate:all` then `pnpm db:seed` then `SOURCE_MODE=live pnpm ingest:lgu`
   (retry during a stable portal window if it flaps).
3. **Vercel**: import the repo; set env vars `DATABASE_URL` (Neon direct for now),
   `APP_DOMAIN=reivex.io`, `ADMIN_SECRET` (a strong secret); deploy.
4. **DNS**: add `lgu.reivex.io` in Vercel Domains and the `CNAME lgu ->
cname.vercel-dns.com` record at your DNS provider.
5. **Map rooms**: sign in at `https://lgu.reivex.io/u/lgu/admin/login` and resolve
   each room at `/u/lgu/admin/rooms` so room=TBA drops to ~0.
6. **Scheduled ingest**: add repo secret `DATABASE_URL` (Neon direct) and repo
   variable `HOSTED_DB_ENABLED=true`.
7. **Verify** against the readiness checklist in `docs/DEPLOY.md`.

## Honest state

**Deploy-ready pending the seven human steps above** (accounts, secrets, DNS, the
one-time migrate/seed/ingest, room mapping, enabling the schedule). The code,
CI, migrations, admin, SEO, and deploy config are all in place. The single
external unknown is the LGU portal's intermittent flakiness, which affects data
freshness and the first full ingest, not the app's deployability. With the
Phase 1 data slice the app is already functional (one semester, rooms mappable);
full data follows once the portal is stable or the scheduled ingest catches a
good window.
