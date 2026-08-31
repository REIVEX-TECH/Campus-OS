# fix(web): tenant-relative URLs on subdomains (admin login 404)

Targets `main`. No schema change, no migration.

## The bug

On the live VPS (`lgu.reivex.io`, tenant resolved from the subdomain), the admin
login form action was hardcoded to `/u/lgu/admin/login/submit`. Middleware
already maps the subdomain to the `lgu` tenant, so it prepended `/u/lgu` again,
producing `/u/lgu/u/lgu/admin/login/submit` -> 404 "This tenant or page could not
be found." The same latent bug affected every internal link/form action (section
links, ICS links, breadcrumbs, logout, resolve): they all built absolute
`/u/[slug]/...` URLs that double-prefix on a real subdomain.

## The fix

Internal URLs are now built from a **base that reflects how the tenant was
resolved**: `''` (root-relative) when resolved from the subdomain, `/u/{slug}`
when resolved from the path (local dev).

- **`lib/tenant-routing.ts`** (pure, unit-tested): `tenantBaseForHost(host, slug)`
  returns the correct base; `planRoute(host, pathname)` is the middleware
  decision (rewrite clean -> internal, redirect duplicate `/u/{label}` -> clean,
  or pass through the dev path).
- **`lib/tenant-url.ts`**: `tenantBase(slug)` reads the request Host and returns
  the base for server components.
- **`middleware.ts`**: uses `planRoute`. New behaviour: on a tenant subdomain a
  `/u/{label}/...` path now **308-redirects to the canonical clean URL** (`/...`),
  fixing the double-rewrite and giving one canonical URL shape per environment
  (good for SEO).
- **All call sites** now use the base: admin login/logout/resolve form actions
  and route-handler redirects, `requireAdmin`, the section/teacher/room views
  (links, ICS, breadcrumbs), the picker, the tenant home, and every
  `generateMetadata` canonical path.

On a subdomain the emitted URLs are `/admin/login/submit`, `/admin/rooms`,
`/sections/{id}`, etc.; in path-based dev they remain `/u/lgu/...`.

## Tests

- **Unit** (`test/tenant-routing.test.ts`): `tenantBaseForHost` (subdomain -> ``,
  path -> `/u/{slug}`) and `planRoute` (rewrite, duplicate-path redirect,
  dev pass-through, non-tenant pass-through).
- **E2E** (`e2e/admin-subdomain.spec.ts`): simulates the subdomain via a `Host`
  header (playwright config aligns `APP_DOMAIN` to the e2e host). Asserts the
  admin login POST at the clean path resolves (a 3xx, not a 404) and a duplicate
  `/u/lgu/*` path 308-redirects to the clean URL. The existing `/u/lgu` path-based
  specs still pass unchanged.

```bash
pnpm --filter web test        # 16 unit tests
pnpm turbo run typecheck lint format:check build test   # all 22 tasks green
```

## Data & migration impact

None.

## Follow-ups

- None. The two URL shapes (subdomain clean, dev `/u/{slug}`) are now consistent
  everywhere and covered by tests.
