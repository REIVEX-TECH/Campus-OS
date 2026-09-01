# fix(web): single-hop tenant links on the landing, and a valid bare /admin entry

Targets `main`. No schema change, no migration. Two app-level bugs found on the
live nested-host deploy.

## Bug 1: landing card double-redirected via the legacy host

On `campusos.reivex.io`, the tenant card linked to `lgu.reivex.io`, which then
redirected to `lgu.campusos.reivex.io` (two hops).

**Root cause**: the only tenant-link emitter is `tenantOrigin(slug)`, which read
`tenantBaseDomain() = TENANT_BASE_DOMAIN ?? APP_DOMAIN ?? localhost`. When
`TENANT_BASE_DOMAIN` is not set in the running process (the deploy had
`PLATFORM_HOST` set so the landing renders, and resolves the nested host via the
leading-label extractor, but `TENANT_BASE_DOMAIN` was not effective), the helper
fell back to `APP_DOMAIN=reivex.io` and emitted the legacy host.

**Fix**: emit the tenant link **host-reflectively**. The landing (and the platform
sitemap) are only ever served on the platform host, and a tenant is a subdomain
of that host, so the link is built as `https://{slug}.{request host}`. This is a
single hop and does not depend on `TENANT_BASE_DOMAIN` being set. `tenantOrigin`
is replaced by `tenantUrlForHost(slug, host)`; `app/page.tsx` reads the request
`Host` and `app/sitemap.ts` uses the host it already has. Local dev stays
path-based (`/u/{slug}`). No hardcoded host remains in link/card code (grep of
`apps/web` for `reivex.io` / `APP_DOMAIN` in emitters is clean).

## Bug 2: bare /admin 404'd

`lgu.campusos.reivex.io/admin` returned "This tenant or page could not be found"
because the admin pages live at `/admin/login` and `/admin/rooms`, with nothing
at `/admin`.

**Fix**:

- `app/u/[slug]/admin/page.tsx` (new): the tenant admin entry. Redirects to
  `/admin/rooms` when already authed, else `/admin/login` (root-relative, so it
  is correct behind the proxy). Unknown tenant still 404s via `requireTenant`.
- `app/admin/page.tsx` (new): bare `/admin` on the PLATFORM host. A tenant host's
  `/admin` is rewritten to `/u/{slug}/admin`, so this route serves only the
  platform host (and the bare dev host). Minimal placeholder for the future
  platform super-admin (the identity module), so `/admin` is not a 404. No
  credentials, no tenant data.

The full platform-super-admin vs tenant-admin identity model is a separate future
effort; this only makes the existing login/rooms flow reachable from `/admin` and
keeps the platform `/admin` from 404ing.

## Data & migration impact

No schema change, no migration.

## Tests

- `apps/web/test/tenant-routing.test.ts`: `tenantOrigin` cases replaced with
  `tenantUrlForHost` (subdomain of the live host for any platform host; null and
  path-based for local hosts). 14 tests.
- `apps/web/e2e/admin-entry.spec.ts` (new): the landing card emits
  `{slug}.{platform host}` and never a `reivex.io` legacy host; bare `/admin` on a
  tenant host 3xx-redirects to `/admin/login`; bare `/admin` on the platform host
  serves the placeholder (200, not 404).

Commands: `pnpm turbo run typecheck lint format:check test build`,
`pnpm test:integration`, `pnpm --filter web test:e2e` (10 e2e pass).

## Verification steps

```
# Bug 1 (host-reflective single hop):
curl -s -H 'Host: campus.example.edu' http://localhost:<port>/ | grep -o 'https://lgu.campus.example.edu'
# Bug 2:
curl -sI -H 'Host: lgu.localhost:<port>' http://localhost:<port>/admin   # 3xx -> /admin/login
curl -sI -H 'Host: localhost:<port>'     http://localhost:<port>/admin   # 200 placeholder
```

## Follow-ups

- Setting `TENANT_BASE_DOMAIN` on the deploy is still correct (it tightens
  resolution and drives the legacy 308); the host-reflective link just no longer
  depends on it.
- Platform super-admin + tenant-admin identity module (managing tenants and
  branding from the DB) remains a separate future effort.
