# Runbook: platform-admin access (`SUPERADMIN_EMAILS` + `platform_roles`)

The credential that controls cross-tenant administration. Read the model once;
the procedures below are cold-start and assume you may be locked out.

## The model, in three sentences

`SUPERADMIN_EMAILS` (in `.env`) names who **may become** a platform admin. On a
sign-in whose verified Google address is on that list, `auth_grant_platform_admin`
writes one `platform_roles` row — who **is** one. That write is **upgrade only**:
it never downgrades, and removing the address later does **not** delete the row.

Two consequences you must hold in mind:

- The app reads `SUPERADMIN_EMAILS` from its process environment, which is fixed
  when the process starts. **Editing `.env` does nothing until you restart.**
- Being on the list is not the same as holding the role. Promotion happens once,
  on a sign-in after a restart. Revocation is a separate, manual delete.

**What is unaffected by any change here:** sessions. A session is an opaque
random token whose sha256 lives in `sessions`; it is not derived from
`SUPERADMIN_EMAILS` or `platform_roles`. Changing either does not sign anyone in
or out. Deleting a `platform_roles` row takes effect on that person's **next
request** (platform-admin status is read fresh each request), without touching
their session.

---

## A. Add or change `SUPERADMIN_EMAILS`

Exact order. Do not skip the restart or the verification.

1. Edit `.env` on the server. Comma / semicolon / whitespace separated; case does
   not matter. Each entry must be a **real address** — one `@`, something either
   side, a dot in the domain. A malformed entry (`foo@`, `@x.io`, `foo@bar` with
   no dot, a stray `@`) is **silently dropped** by `parseEmailList`, so a typo
   means that person simply will not be promoted, with no error anywhere.

2. Reload the environment and restart so the new value reaches the process:

   ```bash
   cd /path/to/app
   set -a; . ./.env; set +a
   pm2 restart campusos --update-env && pm2 save
   ```

3. The newly listed person signs in at `https://campusos.reivex.io/signin`
   (the platform host). The sign-in promotes them; nothing on screen says so.

4. **Verify before you walk away** (section D).

What survived: every existing session, and every existing `platform_roles` row.
What did **not** take effect until step 2: the new list. What step 3 does: writes
one `platform_roles` row for the newly listed person, if they were not already one.

---

## B. Remove a platform admin (actually revoke, not just de-list)

Removing the address from `SUPERADMIN_EMAILS` only stops **future** promotion. The
existing `platform_roles` row stays, so the person **remains** a platform admin.
To revoke, you must delete the row, as the owner.

1. Remove their address from `SUPERADMIN_EMAILS` in `.env`, then restart as in
   A.2 — otherwise their next sign-in re-promotes them.

2. Delete the row, connecting as the **owner** (the application role cannot write
   `platform_roles`; only the owner can). Use `MIGRATION_DATABASE_URL` from
   `.env` — the `campusos_owner` connection:

   ```bash
   psql "$MIGRATION_DATABASE_URL"
   ```

   ```sql
   -- Find them (confirm the exact address first):
   SELECT id, email FROM users WHERE lower(email) = lower('them@example.com');

   -- Revoke:
   DELETE FROM platform_roles
   WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower('them@example.com'))
     AND role = 'platform_admin';
   ```

3. It takes effect on their next request. Their session is not ended (that is
   separate); their platform-admin **powers** are gone immediately.

Order matters: de-list **then** delete. Delete without de-listing and their next
sign-in silently re-promotes them.

---

## C. Lockout recovery (you are locked out; read this cold)

You removed your own address, mistyped it, restarted into an empty list, or the
`platform_roles` row is wrong. `campusos.reivex.io/admin` now shows you the
public placeholder, not the tenant list. Here is the way back. You do **not**
need the running app — only the owner database connection.

**Step 1 — get an owner psql prompt.** `MIGRATION_DATABASE_URL` in `.env` is the
`campusos_owner` connection. If the shell has it:

```bash
psql "$MIGRATION_DATABASE_URL"
```

If not, it is `postgres://campusos_owner:<owner password>@<host>:5432/<db>` —
read it straight out of `.env`:

```bash
grep '^MIGRATION_DATABASE_URL=' .env
```

**Step 2 — find your account.** Your user row exists as soon as you have ever
signed in with Google, whether or not you are an admin:

```sql
SELECT id, email FROM users WHERE lower(email) = lower('you@example.com');
```

If this returns **no row**, you have never signed in on this deployment: sign in
once at `/signin` (you will be a nobody), then re-run it.

**Step 3 — check what is actually wrong.**

```sql
-- Do you hold the role right now?
SELECT * FROM platform_roles
WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower('you@example.com'));

-- Is your address on the list the RUNNING process has? (env, not .env on disk)
--   pm2 env <id> | grep SUPERADMIN_EMAILS      -- what the process actually has
--   grep '^SUPERADMIN_EMAILS=' .env            -- what is on disk (needs restart to apply)
```

Two failure shapes:

- **The row is missing** (de-listed, or never promoted): restore it directly.
- **The list is wrong / a typo** (`grep` shows your address malformed or absent):
  fix `.env`, restart (A.2), sign in — that re-promotes you. Or skip the app
  entirely and restore the row directly, below.

**Step 4 — restore access directly, as the owner.** This is the guaranteed path
and needs nothing but psql:

```sql
INSERT INTO platform_roles (user_id, role)
VALUES ((SELECT id FROM users WHERE lower(email) = lower('you@example.com')), 'platform_admin')
ON CONFLICT (user_id) DO NOTHING;
```

(`platform_roles` lost FORCE in migration 0016, so the owner may write it; the
application role still cannot. This insert is the same effect the sign-in
promotion has, done by hand.)

**Step 5 — also fix `.env`** so you are not relying on the hand-inserted row
alone and so the next restart does not surprise you: put your correct address
back in `SUPERADMIN_EMAILS`, restart (A.2). Then verify (D).

If `psql "$MIGRATION_DATABASE_URL"` itself fails (owner password wrong/rotated),
that is a database-credential problem, not a platform-admin one: recover the
owner role at the Postgres level (`scripts/db-bootstrap.sql` documents the roles)
before returning here.

---

## D. Verify you still have access — before ending the session

Never discover a lockout later. After any change, confirm both layers while you
still have a working way in.

- **From the database** (authoritative, needs only owner psql):

  ```sql
  SELECT u.email, pr.role
  FROM platform_roles pr JOIN users u ON u.id = pr.user_id
  WHERE pr.role = 'platform_admin'
  ORDER BY u.email;
  ```

  Confirm your address is listed, and that anyone you revoked is not.

- **From the app** (confirms the running process agrees): open
  `https://campusos.reivex.io/admin` while signed in. A platform admin sees the
  list of universities and the "Add university" / roles controls; anyone else
  sees only a plain placeholder. Seeing the tenant list is proof.

Do not end the session until at least the database check passes for your own
address. If you changed `SUPERADMIN_EMAILS`, also confirm `pm2 env <id> | grep
SUPERADMIN_EMAILS` shows the value you intended — that is what the process will
use for the next promotion, and a `.env` edit that was never restarted will not
show here.

---

## Quick reference

| Task                 | Restart needed?            | Owner psql needed?          |
| -------------------- | -------------------------- | --------------------------- |
| Add a super admin    | yes (then they sign in)    | no                          |
| Remove a super admin | yes (de-list)              | **yes** (delete the row)    |
| Recover from lockout | eventually (to fix `.env`) | **yes** (restore the row)   |
| Verify access        | no                         | recommended (authoritative) |

The one thing that most often goes wrong: assuming removing an address revokes
the person. It does not. De-list **and** delete the row.
