# fix(web): require base/host env vars at boot; tenantOrigin throws on absent base

## What

Hardens the two fixes from the `lgu.lgu.campusos.reivex.io` incident, whose
confirmed cause was an empty process env: `ecosystem.config.cjs` forwarded
`process.env.*`, which is only populated if `.env` was sourced into the shell
before `pm2 start`. A restart without sourcing left `TENANT_BASE_DOMAIN`,
`PLATFORM_HOST`, `APP_DOMAIN` (and `SUPERADMIN_EMAILS`) undefined, and the
tenant-link helper fell back to a wrong base and doubled the slug.

1. **Env model no longer depends on sourcing.** `ecosystem.config.cjs` already
   loads `.env` itself (`require('dotenv').config({ path: __dirname + '/.env' })`,
   shipped previously), so the vars are read from the file regardless of shell
   state.
2. **Fail loudly on a missing base/host var.** The boot assertion
   (`instrumentation.ts` -> `assertAppEnv`) now treats `DATABASE_URL` as required
   in every environment and `TENANT_BASE_DOMAIN`, `PLATFORM_HOST`, `APP_DOMAIN`
   as required **in production**, crashing the boot with a message naming any
   that are missing/empty. A missing base domain can never again silently produce
   a wrong hostname. The host vars are production-gated because `next dev`
   legitimately runs with `PLATFORM_HOST` empty and the host vars falling back to
   localhost.
3. **`tenantOrigin` throws on an absent base.** Previously it returned null (path
   form) for both a local and an absent base. Now an absent base
   (empty/whitespace) **throws** rather than construct a wrong host; a local base
   still returns null so dev uses the `/u/{slug}` path form. Idempotency (never
   prepend a slug the base already carries) is unchanged.

## Reconciliation note

`.env.example` documented `APP_DOMAIN` as removable by _unsetting_ it. Requiring
it in production conflicts with that, so the removal path is now _set it equal to
`TENANT_BASE_DOMAIN`_ (the redirect is inert when the two match) - a documented
alternative that keeps the drop-the-legacy-redirect capability without allowing
an empty value.

## Files

- `apps/web/lib/app-env.vars.json` - `requiredInProduction` on `TENANT_BASE_DOMAIN`,
  `PLATFORM_HOST`, `APP_DOMAIN`.
- `apps/web/lib/app-env.ts` - `assertAppEnv` enforces `required` always and
  `requiredInProduction` when `NODE_ENV=production`.
- `apps/web/lib/tenant-routing.ts` - `tenantOrigin` throws on an absent base.
- `apps/web/test/app-env.test.ts`, `apps/web/test/tenant-routing.test.ts` - coverage.
- `.env.example` - production-required set and the `APP_DOMAIN` removal path.

## Data & migration impact

No schema change.

## Tests

- `app-env.test.ts`: host vars required in production (a missing one throws),
  NOT required in development; manifest shape (`required` = [DATABASE_URL],
  `requiredInProduction` = [APP_DOMAIN, PLATFORM_HOST, TENANT_BASE_DOMAIN]).
- `tenant-routing.test.ts`: `tenantOrigin` throws on an absent/whitespace base;
  still null for a local base; still never yields `lgu.lgu.*`.

```bash
pnpm -C apps/web exec vitest run
```

## Verification steps

- `pnpm -C apps/web exec vitest run` (89 pass), `tsc --noEmit`, `next build` - all clean.
- Operator: with a required var blanked in `.env`,
  `pm2 restart ecosystem.config.cjs --update-env` crashes the boot naming it
  (`pm2 logs campusos --err`); restore and confirm a clean start.

## Follow-ups

- A production deploy that intentionally has no legacy domain sets
  `APP_DOMAIN=$TENANT_BASE_DOMAIN` rather than leaving it empty.
