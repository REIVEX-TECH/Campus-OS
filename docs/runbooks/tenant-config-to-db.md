# Runbook: tenant configuration, file to database

Platform admin Phase 4 (`docs/design-platform-admin.md` §4). Human-run steps for
the live database. Nothing below runs on its own.

## Before

- The code with this runbook is deployed (`pm2 restart campusos` after the
  usual build).
- `.env` on the VPS has `SUPERADMIN_EMAILS=<your address>`; the pm2 file forwards
  it. Restart pm2 after editing `.env` (it reads the shell environment at start).

## 1. Migrate

```
pnpm db:migrate:all
```

Adds `tenant_configs` (base `0004`) and its write policies (identity `0012`).
Nothing changes yet: the table is empty and every tenant still serves from its
file.

## 2. Become the platform admin

Open `https://<platform host>/signin` and sign in with the listed address. The
first sign in writes the `platform_roles` row (audited as
`platform.admin_granted`). Then open `https://<platform host>/admin`: it lists
LGU with the source chip **File**.

## 3. Move LGU into the database

Either of:

- In `/admin`, open LGU and press **Save changes** without editing anything.
- From the repo on the VPS, as the schema owner:

  ```
  pnpm tenants:sync
  ```

Within 30 seconds (the registry cache window) the chip reads **Database**.
`pnpm tenants:sync --check` prints the same from the table.

## 4. Verify

- The tenant host serves as before: timetable, rooms, sign in.
- Edit the display name in `/admin`, save, reload the tenant: it follows. Put
  it back.

## Rollback

```sql
delete from tenant_configs where slug = 'lgu';
```

The file answers again within the cache window. The migration itself needs no
rollback; an empty table is inert.

## After

A later PR removes `tenants/lgu/tenant.config.ts` from the file registry once
the row has served for a while. Until then the file is the fallback, on purpose.
