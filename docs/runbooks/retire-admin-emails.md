# Runbook: retire config admin lists into memberships

Platform admin Phase 5B, item 3a (`CLAUDE.md` §2, §8; the 0016 trust boundary).
Human-run steps for the live database. Nothing below runs on its own.

## Why

A tenant's `adminEmails` lives in DB-editable config, and `ensureConfiguredAdmin`
re-seeds `tenant_admin` from it at every sign in. That means a value the
application can write decides who is an administrator, which is exactly the trust
boundary §8 forbids. This step converts every current config admin into a real
`tenant_memberships` row **once**, audited distinctly, so a later PR can delete
the self-seeding path entirely. After retirement the only way to `tenant_admin`
is `auth_set_membership_role` under a platform grant (contained and audited).

This runbook is additive and idempotent: it seeds memberships, deletes nothing,
and re-running changes nothing already migrated. Run it **before** the PR that
removes `ensureConfiguredAdmin` is deployed.

## Before

- The code with this runbook and migration `0023` is deployed
  (`pnpm db:migrate:all` has run, or `pm2 restart campusos` after the usual
  build applied it — see step 1).
- You are on the VPS, in the repo, with the schema owner connection available as
  `MIGRATION_DATABASE_URL` (the same one `pnpm db:migrate:all` uses). The script
  refuses to seed `tenant_admin` from the application role by design.

## 1. Migrate the schema

```
pnpm db:migrate:all
```

Adds the owner-only definer `auth_migrate_configured_admin` (identity `0023`).
Nothing changes yet: no membership is written until step 3.

## 2. Dry run

```
pnpm admins:migrate --check
```

Prints, per tenant, each effective `adminEmails` address it _would_ migrate
(database config wins over the file, matching the live registry). Read the list.
Confirm LGU's admin address is present. Nothing is written.

## 3. Migrate

```
pnpm admins:migrate
```

For each address it prints one of:

- `migrated` — a new `tenant_admin` membership was created (audited
  `membership.migrated_from_config`).
- `upgraded` — an existing member was raised to `tenant_admin` (audited).
- `already` — already a `tenant_admin`; nothing written.
- `no_user` — no account for that address yet. That person signs in once, then a
  platform admin grants them `tenant_admin` from the roles UI under a grant. This
  is expected for any admin who has never signed in.

## 4. Verify (do not skip: confirm you keep LGU access)

- Sign in to the LGU tenant host with your admin address and open
  `/u/lgu/admin`: it loads as an administrator.
- The membership exists independently of config now:

  ```sql
  select m.role, m.verification_method
  from tenant_memberships m
  join users u on u.id = m.user_id
  where m.tenant_id = 'lgu' and lower(u.email) = lower('<your address>');
  -- expect: tenant_admin | config
  ```

- The audit line is present:

  ```sql
  select actor_user_id, action, meta
  from audit_log
  where tenant_id = 'lgu' and action = 'membership.migrated_from_config';
  ```

Only once every listed admin who has an account reads `migrated`/`upgraded`/
`already`, and your own LGU access is confirmed, is it safe to deploy the PR that
removes `ensureConfiguredAdmin`.

## Rollback

The migrated memberships are real rows; removing them by hand for one tenant:

```sql
delete from membership_roles mr using roles r
  where mr.role_id = r.id and r.tenant_id = '<slug>' and r.key = 'tenant_admin'
    and mr.membership_id in (
      select id from tenant_memberships
      where tenant_id = '<slug>' and verification_method = 'config' and role = 'tenant_admin');
delete from tenant_memberships
  where tenant_id = '<slug>' and verification_method = 'config' and role = 'tenant_admin';
```

Only do this while `ensureConfiguredAdmin` is still deployed (it re-seeds from
config at the next sign in). Once that path is removed, deleting an admin
membership locks that person out until re-granted under a grant. The migration
itself needs no rollback; the definer is inert when never called.
