# feat(identity): owner-run migration of config admins to memberships

Phase 5B, item 3a. First step of retiring the 0016 trust boundary that survived
into Phase 4: a tenant's `adminEmails` lives in DB-editable config, and
`ensureConfiguredAdmin` re-seeds `tenant_admin` from it at every sign in. A value
the application can write should never decide who is an administrator (CLAUDE.md
§8). This PR does not delete that path yet; it makes it safe to delete by
converting every current config admin into a real membership row, **once**,
audited distinctly.

Additive and idempotent. Nothing is deleted. It writes no membership on its own:
a human runs it via the runbook.

## What

- A one-time, owner-only definer `auth_migrate_configured_admin(tenant, email)`
  that, for an address with an existing account, seeds (or upgrades to) a
  `tenant_admin` membership and audits it as **`membership.migrated_from_config`**
  (`meta.source = 'config_migration'`). An address with no account yet returns
  `no_user`: that person signs in once and is granted from the roles UI under a
  platform grant (the bootstrap path that item 3c builds; the only way in after
  the self-seeding path is removed in 3b).
- The owner script `scripts/migrate-configured-admins.ts` (`pnpm admins:migrate`,
  `--check` for a dry run) that walks every tenant's effective `adminEmails`
  (database config wins over the file, matching the live registry) and calls the
  definer over the owner connection.
- A runbook, `docs/runbooks/retire-admin-emails.md`, including a step that
  verifies LGU admin access is not lost.

## Why owner-only

The definer seeds `tenant_admin` for an **arbitrary** email (unlike
`auth_grant_configured_admin`, which only ever promotes the actor's own address).
That is safe only because `campusos_app` can never call it: `REVOKE ALL ... FROM
PUBLIC` plus a split-guarded `REVOKE ... FROM campusos_app` BY NAME (the owner's
default privileges grant EXECUTE at CREATE time, so a bare revoke from PUBLIC is
not enough — the 0019 trap). Its only gate is that EXECUTE grant; it makes no
authorization decision on any `app.*` GUC.

## Data & migration impact

- Migration `packages/modules/identity/drizzle/0023_migrate_configured_admins.sql`
  (+ its `meta/_journal.json` entry, idx 23). Creates one owner-only function;
  writes no data. Backwards-compatible; the function is inert until called.
- No rows change until an operator runs `pnpm admins:migrate`. Rollback for a
  single tenant's migrated memberships is in the runbook; the migration itself
  needs none.

## Tests

`packages/modules/identity/test/isolation.integration.test.ts` — a new
`describe('migrating configured admins to memberships (0023)')`:

- seeds a `tenant_admin` membership for a listed address, audited
  `membership.migrated_from_config`;
- idempotent: a second run neither duplicates the membership nor re-audits;
- upgrades an existing student in place rather than duplicating;
- `no_user`: writes nothing for an address with no account;
- **owner-only**: the application role cannot execute it (`permission denied`),
  and nothing is written by the failed attempt.

Integration suite runs against a split Postgres in CI:

```bash
pnpm -C packages/modules/identity test:integration
```

## Verification

Deploy, then follow `docs/runbooks/retire-admin-emails.md`: `pnpm db:migrate:all`,
`pnpm admins:migrate --check`, `pnpm admins:migrate`, then confirm LGU admin
access and the audit line.

## Follow-ups

- **3b**: delete `ensureConfiguredAdmin` self-seeding once 3a has been run in
  production and LGU access confirmed; boundary-test that the names never return;
  §6 on the diff.
- **3c**: bootstrap UX (create-tenant messaging + find-a-user-by-email in the
  roles UI under a grant).
- **3d**: move `allowedEmailDomains` / `joinMode` editing under a grant with a
  distinct audited action (they govern member auto-join, never admin).
