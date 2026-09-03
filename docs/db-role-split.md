# Database role split: runbook

**Run this yourself on the VPS. It is not automated and no deploy step performs
it.** It changes ownership of every object in the production database, so it is
written to be read once, understood, and then pasted.

Time: a couple of minutes. Downtime: none required, but see step 3.

---

## Why

Today the application connects as `campusos_app`, which also **owns** every
table. That has two consequences.

Row-level security does not apply to a table's owner unless the table sets
`FORCE ROW LEVEL SECURITY`. Because the application was the owner, every
tenant-scoped table needed `FORCE` to stay isolated. The isolation is real, but
it rests on remembering `FORCE` on every future table rather than on the
application simply not being privileged.

More concretely, it broke session resolution. Resolving a request's session
happens before the user is known: we hold a token, not a user id, so the read
cannot satisfy the own-row policy on `sessions`. The intended answer was a
`SECURITY DEFINER` function, which gains privileges of the function's owner. With
one role that is a no-op, because it elevates to the role already calling it, and
`FORCE` applies the policy to the owner anyway. The function returned nothing.

After this split:

- `campusos_owner` owns the database, the schema, and every object. It runs
  migrations and never serves traffic.
- `campusos_app` owns nothing. RLS applies to it because it is not an owner, not
  because a flag was remembered. It holds `SELECT`, `INSERT`, `UPDATE` and
  `DELETE`, and nothing else: no DDL, and **no `TRUNCATE`**, which matters
  because `TRUNCATE` ignores RLS entirely, so a runtime role holding it could
  empty every tenant in one statement.
- `auth_resolve_session` becomes a real privilege boundary: one function, owned
  by the owner, that takes a hash rather than a token and returns at most one row
  on an exact match.

`FORCE` stays on every tenant-scoped table. It is now redundant, which is exactly
why it is worth keeping: it is a safety net if anyone ever points the application
at the owner credential by mistake.

---

## Before you start

1. **Take a backup.** This is the one step that is not easily undone if
   something else goes wrong at the same time.

   ```bash
   sudo -u postgres pg_dump -Fc campusos > ~/campusos-before-role-split.dump
   ```

2. Know which database you are changing. Everything below assumes `campusos`.

3. Have the repository checked out on the VPS, because step 3 includes a file
   from `scripts/`.

---

## Step 1: create the owner role

Choose a strong password, different from the application's. Avoid a single quote
so the literal stays simple.

```bash
sudo -u postgres psql -c "CREATE ROLE campusos_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'CHOOSE_A_STRONG_OWNER_PASSWORD';"
```

`NOBYPASSRLS` matters on both roles. A role with `BYPASSRLS` would make
row-level security advisory rather than enforced.

## Step 2: hand the database itself to the owner

```bash
sudo -u postgres psql -c "ALTER DATABASE campusos OWNER TO campusos_owner;"
```

## Step 3: move the objects, and grant the application back what it needs

This is the only step with a visible effect on a running application, so it runs
as **one transaction**: either the application ends up owning nothing and holding
the right grants, or nothing changes at all. There is no window in which it owns
nothing and has no grants.

Reassigning takes a brief exclusive lock on each table. `lock_timeout` makes the
whole thing fail fast rather than queue behind a long-running query, so if it
does time out, nothing changed and you can simply run it again.

From the repository root on the VPS:

```bash
sudo -u postgres psql -d campusos -1 -v ON_ERROR_STOP=1 <<'SQL'
SET lock_timeout = '5s';

-- Everything campusos_app owns in this database moves to campusos_owner:
-- tables, sequences, the drizzle bookkeeping schema, all of it.
REASSIGN OWNED BY campusos_app TO campusos_owner;

-- campusos_app now owns nothing, so it needs explicit privileges. This is the
-- same file development and CI use, so all three environments agree.
\ir scripts/db-grants.sql
SQL
```

If it reports a lock timeout, retry when the database is quieter. Nothing was
changed.

## Step 4: point migrations at the owner

On the VPS, in the application's environment file, keep `DATABASE_URL` as it is
and add the owner connection:

```bash
# runtime, unchanged: owns nothing, RLS always applies
DATABASE_URL=postgres://campusos_app:EXISTING_APP_PASSWORD@localhost:5432/campusos

# migrations only, never used to serve traffic
MIGRATION_DATABASE_URL=postgres://campusos_owner:CHOOSE_A_STRONG_OWNER_PASSWORD@localhost:5432/campusos
```

Then deploy the new build and run migrations as usual:

```bash
pnpm db:migrate:all
```

Two things happen on this run. The identity tables are created for the first
time (they existed in the repository but were never registered with the migration
runner, so production has never had them), and `auth_resolve_session` is created,
owned by `campusos_owner`.

---

## Step 5: verify

**The application owns nothing:**

```bash
sudo -u postgres psql -d campusos -c "SELECT count(*) AS owned_by_app FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'campusos_app';"
```

Expect `0`.

**The application cannot create or truncate:**

```bash
psql "postgres://campusos_app:EXISTING_APP_PASSWORD@localhost:5432/campusos" -c "CREATE TABLE should_fail (id int);"
psql "postgres://campusos_app:EXISTING_APP_PASSWORD@localhost:5432/campusos" -c "TRUNCATE universities;"
```

Both should fail with a permission error. That is the point of the exercise.

**The application can still do its job:**

```bash
psql "postgres://campusos_app:EXISTING_APP_PASSWORD@localhost:5432/campusos" -c "SELECT count(*) FROM universities;"
```

**Session resolution works** (this is the thing that was broken):

```bash
sudo -u postgres psql -d campusos -c "SELECT prosecdef, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'auth_resolve_session';"
```

Expect `prosecdef = t` and `owner = campusos_owner`.

Then, as the application role, confirm it is callable and returns nothing for a
token that does not exist (an empty result is the correct answer, not an error):

```bash
psql "postgres://campusos_app:EXISTING_APP_PASSWORD@localhost:5432/campusos" -c "SELECT * FROM auth_resolve_session('no-such-token');"
```

Expect `(0 rows)`. A permission error means the grant did not apply; re-run
step 3.

**And the application still cannot read sessions directly:**

```bash
psql "postgres://campusos_app:EXISTING_APP_PASSWORD@localhost:5432/campusos" -c "SELECT count(*) FROM sessions;"
```

Expect `0`, because the own-row policy matches nothing without a user context,
even though the table now allows its owner through.

Finally, load the site and confirm timetables still render.

---

## Rollback

Nothing here destroys data, so rolling back is a matter of handing ownership
back.

```bash
sudo -u postgres psql -d campusos -1 -v ON_ERROR_STOP=1 <<'SQL'
SET lock_timeout = '5s';

ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM campusos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM campusos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM campusos_app;

REASSIGN OWNED BY campusos_owner TO campusos_app;
ALTER SCHEMA public OWNER TO campusos_app;
GRANT ALL ON SCHEMA public TO campusos_app;
SQL

sudo -u postgres psql -c "ALTER DATABASE campusos OWNER TO campusos_app;"
```

Then remove `MIGRATION_DATABASE_URL` from the environment and redeploy the
previous build. The application falls back to `DATABASE_URL` for migrations, so
it keeps working either way.

Leave `campusos_owner` in place, or drop it once it owns nothing:

```bash
sudo -u postgres psql -c "DROP ROLE campusos_owner;"
```

Note that after a rollback `auth_resolve_session` returns nothing again, for the
reason described at the top. Sign in depends on it, so identity work waits on
this split.

---

## Fresh installs

Nothing above applies to a new database. `scripts/db-bootstrap-prod.sql` creates
both roles and the correct grants from the start, and `scripts/db-bootstrap.sql`
does the same for development and CI. Both include `scripts/db-grants.sql`, which
is the single definition of what the application role may do.
