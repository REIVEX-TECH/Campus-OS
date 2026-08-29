# @campusos/db

Database access for Campus OS: the Drizzle schema, migrations, the tenant-context
helper, and the typed repository layer. This is the lowest layer — it depends on
nothing else in the workspace.

## Access rules (enforced, not aspirational)

- The app talks to Postgres **only** via `DATABASE_URL`.
- The raw Drizzle client is exported **only** from `@campusos/db/client`. App and
  route code must go through repositories, which set the tenant context. An
  ESLint rule (and a test) fail the build if `@campusos/db/client` is imported
  from `apps/web`.
- Every tenant-scoped table has `tenant_id` and **FORCE ROW LEVEL SECURITY**.
  The tenant context (`app.tenant_id`) is set per transaction; RLS — not
  application filters — is the isolation boundary.

## Tenant context

Repositories run each operation inside a transaction that first sets the tenant
GUC:

```sql
select set_config('app.tenant_id', $slug, true) -- local to the transaction
```

`set_config(..., true)` scopes the value to the transaction, so it is safe on a
pooled connection. With no tenant set, RLS policies match nothing (default
deny).

## Scripts

- `pnpm --filter @campusos/db db:generate` — generate SQL from the schema
- `pnpm --filter @campusos/db db:migrate` — apply migrations (as `campusos_app`)
- `pnpm --filter @campusos/db test:integration` — repositories + RLS isolation
  against `TEST_DATABASE_URL`

See the repo root `scripts/db-bootstrap.sql` for role/database setup and
`README.md` for the two setup paths (native / Docker).
