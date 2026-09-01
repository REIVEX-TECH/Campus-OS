# feat(web): nest tenants under the platform host ({slug}.campusos.reivex.io)

Targets `main`. No schema change, no migration. App-only: DNS, nginx, and the
wildcard certificate are handled separately after merge.

## What

Tenants move from the flat `{slug}.APP_DOMAIN` (`lgu.reivex.io`) to
`{slug}.TENANT_BASE_DOMAIN` nested under the platform root
(`lgu.campusos.reivex.io`, with `campusos.reivex.io` as the platform landing).
One Next.js app on one port serves every tenant by `Host` header.

- **Resolution base swap** (`lib/tenant-routing.ts`): new `tenantBaseDomain()` =
  `TENANT_BASE_DOMAIN ?? APP_DOMAIN ?? localhost:3000`. `planRoute` and
  `tenantBaseForHost` now resolve the tenant as a subdomain of
  `TENANT_BASE_DOMAIN`. The `subdomainOf` label extractor is unchanged (it
  already takes the leading label, so `lgu.campusos.reivex.io -> lgu`).
- **Inert until configured**: the fallback chain means that until
  `TENANT_BASE_DOMAIN` is set, resolution stays on `APP_DOMAIN` and the legacy
  redirect never fires. Safe to merge and deploy before the DNS/cert cutover.
- **Legacy 308** (`planRoute` + `middleware.ts`): a request on the old
  `{slug}.APP_DOMAIN` host 308-redirects, cross-host, to
  `{slug}.TENANT_BASE_DOMAIN` (path and query preserved). Ordering guard runs the
  platform and tenant-base checks first, so `campusos.reivex.io` (itself a
  `*.reivex.io` subdomain) never loops to `campusos.campusos.reivex.io`. The
  `RoutePlan` redirect variant gained an optional `host`; middleware builds the
  absolute cross-host `Location`, keeping the request scheme. **Removable**: unset
  `APP_DOMAIN` (or set it equal to `TENANT_BASE_DOMAIN`).
- **Unknown slug**: `planRoute` stays pure (no registry). An unknown subdomain
  still rewrites onto `/u/{slug}`, where the `[slug]` layout renders the styled
  404, exactly as before.
- **Middleware hardening** (from an adversarial review of this change): the
  cross-host 308 target is set to exactly `{slug}.TENANT_BASE_DOMAIN` (a port-less
  target clears any inherited request port, so the redirect is deterministic);
  and the middleware strips any client-supplied `x-tenant-slug` before setting its
  own, since that header is middleware-owned and trusted downstream.
- **Link/SEO emission**: one shared helper `tenantOrigin(slug)` on
  `TENANT_BASE_DOMAIN` replaces the duplicated `https://{slug}.{APP_DOMAIN}`
  construction in the landing cards (`app/page.tsx`) and the platform sitemap
  (`app/sitemap.ts`); `sitemap.ts`/`robots.ts` resolve the tenant against the new
  base. Canonical/OpenGraph (`lib/metadata.ts`) and the tenant-host sitemap/robots
  branches are host-reflective (`baseUrlFromHost`) and self-correct on the new
  host, so they are unchanged.
- **Env + ops**: `TENANT_BASE_DOMAIN` added to `.env.example`, `docs/DEPLOY-VPS.md`
  (including the previously-missing `PLATFORM_HOST` in the `.env` heredoc), and
  `docs/DEPLOY.md`; `APP_DOMAIN` reframed as legacy/redirect-only; the three-var
  relationship documented. `ecosystem.config.cjs` now forwards the host vars (and
  `DATABASE_URL`/`ADMIN_SECRET`/`SOURCE_MODE`/`PORT`) explicitly, so a var missed
  during `source .env` shows up empty at boot instead of silently defaulting.

## Assumptions & decisions

- **Auth cookie stays host-only** (no `domain`): the secure choice, since a
  `.campusos.reivex.io` cookie would leak one tenant's admin session to siblings.
  Consequence: admins re-authenticate once after the host move. No code change.
- **Legacy `robots.txt`/`sitemap.xml`**: excluded from the middleware matcher, so
  the 308 does not cover them; on the OLD host they degrade during the transition.
  HTML page 308s plus new-host canonicals steer crawlers regardless. Documented in
  `docs/DEPLOY-VPS.md`; no special-casing (per the agreed scope).
- **Frozen behavior**: cascade, admin, ICS feeds (UIDs key off `tenant.slug`, not
  host), and the iOS UI are unchanged; only hostnames move.

## Data & migration impact

No schema change, no DB migration. Pure routing/URL/env/docs change.

## Tests

- `apps/web/test/tenant-routing.test.ts` rewritten for the nested model: rewrite
  and dupe-redirect on `{slug}.TENANT_BASE_DOMAIN`; unknown slug still rewrites;
  platform host and bare tenant base serve the landing (no loop, even with
  `PLATFORM_HOST` unset); legacy `{slug}.APP_DOMAIN` 308s to the nested host with
  path preserved; inert when legacy equals the base; plus `tenantOrigin` cases.
  14 tests.
- `apps/web/e2e/tenant-host.spec.ts` (new): a tenant resolves on
  `lgu.localhost:<port>`; the legacy `lgu.legacy.test` host returns a 308 to the
  nested host. Header-injected on request fixtures (no DNS needed).
- `playwright.config.ts` and `.github/workflows/ci.yml` set
  `TENANT_BASE_DOMAIN`/`PLATFORM_HOST` (localhost) and a distinct legacy
  `APP_DOMAIN` in lockstep.

Commands: `pnpm turbo run typecheck lint format:check test build`,
`pnpm test:integration`, `pnpm --filter web test:e2e`.

## Verification steps

Local, with the nested model emulated:

```
TENANT_BASE_DOMAIN=localhost:3005 PLATFORM_HOST=localhost:3005 APP_DOMAIN=legacy.test <run>
curl -sI -H 'Host: lgu.localhost:3005' http://localhost:3005/timetable   # 200 (tenant)
curl -sI -H 'Host: lgu.legacy.test'    http://localhost:3005/timetable   # 308 -> lgu.localhost:3005
curl -sI -H 'Host: localhost:3005'     http://localhost:3005/            # 200 (platform landing)
```

## Follow-ups

- Post-merge (yours): wildcard DNS `*.campusos.reivex.io` + wildcard cert, nginx
  vhost, optional legacy `lgu.reivex.io` vhost; then set `TENANT_BASE_DOMAIN`.
- Optional later: wire the dormant `tenant.seo.aliases` field into
  `alternates`/canonical if alternate hostnames are ever needed.
