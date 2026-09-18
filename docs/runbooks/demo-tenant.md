# Demo tenant

`demo` is a showcase/staging tenant served at `demo.campusos.reivex.io`. Its content is
seeded fixtures (see `docs/design-demo-tenant.md`); real signed-in users are read-only
there, so the only way its content changes is the seed/reset below. Nothing here touches
LGU.

## Host / DNS (no infra change)

`TENANT_BASE_DOMAIN=campusos.reivex.io`, and the deploy already serves the wildcard
`*.campusos.reivex.io` (DNS A/wildcard, wildcard TLS, and the wildcard nginx server
block — see `docs/DEPLOY-VPS.md`). So `demo.campusos.reivex.io` resolves to the `demo`
tenant the moment the tenant exists in the registry. No new DNS record, cert, env var,
or nginx change is needed. (`demo` is committed in `tenants/demo/tenant.config.ts` and
`fileTenantConfigs`.)

## Stand it up

Run as the owner (uses `MIGRATION_DATABASE_URL`), from the repo root:

```bash
pnpm db:migrate:all      # if not already migrated (adds identity 0034 users.is_demo)
pnpm demo:seed           # tenant anchor + config (incl. the banner) + roles + content
```

`pnpm demo:seed` is idempotent and self-contained: it upserts the `universities` row,
writes `tenant_configs` from the file config (which carries the banner notice — set here,
never hand-edited), runs `auth_sync_tenant_roles('demo')`, and seeds personas +
content across every enabled module. Running `pnpm tenants:sync` also writes the config
row if you only want the tenant + banner without content.

## Reset to a known state

```bash
pnpm demo:reset          # wipe demo content, then re-seed
```

Idempotent and scoped to `demo` only (every delete is `where tenant_id = 'demo'`; the
seeded persona accounts are kept). Use it after a demo session to clear any state and
return the tenant to its pristine seeded content.

## Banner copy (G)

The banner text lives in `tenants/demo/tenant.config.ts` (`notice`) and reaches the
database through `pnpm demo:seed` / `pnpm tenants:sync` — the seed/migration path, never
a manual DB edit. To change it, edit the config and re-run one of those.

## Maintenance crons

If the demo runs the same background jobs as a live tenant, add `-- --tenant demo` lines
alongside the LGU ones (see each module's runbook):

```cron
# demo tenant maintenance (mirror the LGU cadence)
15 3 * * * cd /srv/campusos && pnpm lostfound:expire -- --tenant demo   >> /var/log/campusos/demo.log 2>&1
20 3 * * * cd /srv/campusos && pnpm marketplace:expire -- --tenant demo >> /var/log/campusos/demo.log 2>&1
25 3 * * * cd /srv/campusos && pnpm messages:cleanup -- --tenant demo   >> /var/log/campusos/demo.log 2>&1
0  * * * * cd /srv/campusos && pnpm rides:sweep -- --tenant demo        >> /var/log/campusos/demo.log 2>&1
```

These are optional for a pure showcase (the content is static and real users cannot
write), but keep the demo behaving like a real tenant if you leave them on.
