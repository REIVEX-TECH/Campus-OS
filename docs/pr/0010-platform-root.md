# feat(web): platform root (campusos.reivex.io) + force light + sitemap sections

Targets `main`. No schema change, no migration. First of two PRs; the full iOS
redesign follows and will polish the landing.

## What

- **Platform-root routing.** A new `PLATFORM_HOST` env (e.g. `campusos.reivex.io`)
  marks the platform landing host, which is NOT a tenant. In the middleware's pure
  `planRoute`, a request on the platform host is never resolved as a tenant slug:
  `/` serves the platform landing and `/u/{slug}` still works as path-based tenant
  access. Tenant subdomains (`lgu.reivex.io`) are unchanged; the platform host can
  never be mistaken for a tenant, nor a tenant for the platform. Without
  `PLATFORM_HOST` set (dev), the bare `localhost` host already serves the landing.
- **Force light.** The root `<html>` now carries `class="light"`, opting out of
  the `prefers-color-scheme: dark` fallback so the platform is reliably light
  (the iOS-light direction) even on a dark-OS device. `.dark` stays defined for a
  future toggle.
- **Platform landing** (`app/page.tsx`): a minimal light page (hero, one-line
  description, a card linking to each registered university from the tenant
  registry, a GitHub link). Tenant-agnostic (registry-driven), no dashes, no
  divider lines, AA. Deliberately minimal; the redesign PR restyles it into the
  finished iOS system.
- **Sitemap** (`app/sitemap.ts`): previously emitted only the tenant root (0
  section URLs). Now a tenant host enumerates the tenant home, the picker, and
  every section timetable URL (correct subdomain shape); the platform host lists
  the platform home and each tenant's instance URL. `robots.ts` advertises the
  sitemap on both host kinds. (Teacher/room sitemap URLs land with the redesign
  PR that adds their navigation + enumeration queries.)
- **Docs/env**: `PLATFORM_HOST` added to `.env.example` and `docs/DEPLOY-VPS.md`
  (with the `campusos.reivex.io` vhost + DNS steps, same app on port 3003).

## Part A note (diagnosis carried into the redesign PR)

Confirmed via the read layer + a live DB probe: teacher views are NOT broken
(teachers are auto-created; `teacherTimetable` returns rows), and section/room
queries are correct. "Teachers nothing showing" is a **navigation** gap: nothing
in the UI links to teacher/room views (the grid renders their names as plain
text), and the picker hardcodes `terms[0]`. Those fixes (grid links, cascading
picker, term selection) are in the redesign PR, per the approved plan.

## Tests

- Unit (`test/tenant-routing.test.ts`): `isPlatformHost` (matches the configured
  host, port-insensitive; not tenants), `planRoute` on the platform host (serves
  landing at `/`, path-based `/u/{slug}` still works, real subdomains still
  resolve), and `tenantBaseForHost` from the platform host. Existing routing +
  redirect + no-dash + admin-token tests unchanged (22 web unit tests total).
- Verified the landing renders (screenshot) and routes correctly.

```bash
pnpm --filter web test
pnpm turbo run typecheck lint format:check build test   # all 22 tasks green
```

## Data & migration impact

None.

## Follow-ups

- The iOS-light redesign PR (approved): cascading semester/program/section
  picker, redesigned grid + teacher/room views, grid teacher/room links (fixes
  the reported "nothing showing"), correct term selection, teacher/room sitemap
  URLs, and full iOS tokens (flat elevation, grouped white cards on grey, SF
  type) replacing neumorphism.
