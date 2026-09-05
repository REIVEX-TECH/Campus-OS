# fix(web): assert runtime env at boot; forward from a single manifest

## What

Closes a recurring class of silent misconfiguration: a variable added to `.env`
never reached the running process because `ecosystem.config.cjs` forwarded only a
hand-maintained list, and `pm2 restart --update-env` re-reads that config, not
`.env`. It bit `DATABASE_URL`, then `PLATFORM_HOST`, then `TENANT_BASE_DOMAIN`,
then `SUPERADMIN_EMAILS` — each time the process simply saw an empty value and
degraded (no platform admin, wrong routing) with no error anywhere.

Two halves, one source of truth:

- **`apps/web/lib/app-env.vars.json`** declares the runtime env vars the web
  process consumes. Owner-only creds (`MIGRATION_DATABASE_URL`) and build-time
  vars (`NEXT_PUBLIC_FIREBASE_*`) are deliberately excluded — the running app
  must never hold owner credentials, and `NEXT_PUBLIC_*` are inlined by Next at
  build time.
- **`ecosystem.config.cjs`** builds its pm2 forward-list from that manifest (no
  second list to forget) and loads `.env` itself, so
  `pm2 restart ecosystem.config.cjs --update-env` genuinely re-reads `.env`.
- **`apps/web/instrumentation.ts`** runs `assertAppEnv()` once at boot: a
  required var missing, or a var set in `.env` that did not reach the process,
  crashes the boot (`process.exit(1)`) with a message naming the variable. Fails
  closed and loud instead of degrading silently.

`SUPERADMIN_EMAILS` is optional by design (empty = no platform admin, the
fail-closed default), so a "required vars" check alone would not have caught the
var that triggered this. The forwarding comparison (every var `.env` sets must
reach the process) catches optional-but-set vars too. It runs in production only;
in dev Next loads `.env*` itself, so there is no forwarding layer to verify.

## Why

`pm2 restart --update-env` "appears to work and doesn't." The structural fix is a
single manifest that both forwards and asserts, so the two can never drift, plus
a boot gate that makes any remaining gap impossible to miss.

## Files

- `apps/web/lib/app-env.vars.json` — manifest (single source of truth).
- `apps/web/lib/app-env.ts` — `assertAppEnv()`: required-present + `.env`-reached
  checks; zero-dependency `.env` reader; throws (testable).
- `apps/web/instrumentation.ts` — `register()` calls the assertion, exits on
  failure.
- `ecosystem.config.cjs` — forward-list derived from the manifest; loads `.env`.
- `apps/web/test/app-env.test.ts` — 10 unit tests, incl. a structural guard that
  the ecosystem forwards exactly the manifest set (+ `NODE_ENV`).
- `.env.example`, `docs/runbooks/platform-admin-credentials.md` — document the
  manifest, the boot behaviour, and the correct restart command.

## Data & migration impact

No schema change.

## Tests

`apps/web/test/app-env.test.ts` (10 tests): required-missing, empty-required,
forwarding-gap (the recurring bug), reached-OK, intentionally-empty, dev-skips-
comparison, non-manifest key ignored, manifest shape, and the ecosystem-matches-
manifest structural guard.

```bash
pnpm -C apps/web exec vitest run test/app-env.test.ts
```

## Verification steps

- `pnpm -C apps/web exec vitest run` — full unit suite (84 pass).
- `pnpm -C apps/web exec tsc --noEmit` — typecheck clean.
- On the VPS (operator, per runbook): set a required var to empty in `.env`,
  `pm2 restart ecosystem.config.cjs --update-env`, confirm `pm2 logs campusos
--err` shows the boot crash naming the var; restore and confirm a clean start.

## Follow-ups

- `GOOGLE_SITE_VERIFICATION` was also read at runtime but never forwarded (same
  bug class, SEO tag silently absent on the VPS); it is now in the manifest and
  forwarded.
- The dev/build-time wiring of `NEXT_PUBLIC_FIREBASE_*` on the VPS is separate
  (build-time inlining) and out of scope here.
