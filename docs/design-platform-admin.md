# Platform administration, tenant management, and per-tenant RBAC

Design for the highest-stakes work in the project: cross-tenant power and
permissions. Written before Phase 1 and kept current as the phases land.

Status: see `docs/platform-admin-status.md` for what is built and what is not.

---

## 1. What exists today, and what is wrong with it

- A tenant admin is a `tenant_memberships` row with `role = 'tenant_admin'`.
  One role per person per tenant, enforced by a unique index on
  `(tenant_id, user_id)`, and the role is a bare text column.
- Who gets that role is decided by `adminEmails` in the tenant's **file** config,
  which means granting an admin is a deploy.
- Every admin surface asks the same question, "are you tenant_admin here", so
  every capability is all or nothing: whoever can rename a room can also approve
  a verification.
- Tenant configuration is a TypeScript file compiled into the app. Adding a
  university is a code change.
- There is no platform level administrator at all.

Each phase below replaces one of those.

---

## 2. The permission model

**Permissions are capabilities, not roles.** The catalogue is a fixed list in
code, because a permission only means something if some code checks it:

| Permission              | Guards                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `manage-timetable`      | Ingestion controls, term and section edits                   |
| `manage-rooms`          | Room naming and mapping                                      |
| `approve-verifications` | The verification queue, and the emails on it                 |
| `manage-members`        | Viewing the member list, suspending a member                 |
| `manage-roles`          | Creating roles, changing what a role can do, assigning roles |
| `view-analytics`        | The analytics dashboard                                      |
| `post`                  | Creating content in future modules                           |
| `moderate`              | Hiding content, handling reports                             |

**Roles are tenant-scoped bundles of permissions, stored as data.** A tenant has
its own roles; two tenants may both have a role keyed `moderator` with different
permissions, and neither can see the other's. Three roles are created with every
tenant and marked `is_system`, so a tenant cannot delete the one that lets it
administer itself:

- `student` → `post`
- `teacher` → `post`
- `tenant_admin` → every permission in the catalogue

**A user may hold several roles in a tenant, and effective permissions are the
union.** That is the whole reason for the change: a person can be a teacher who
also moderates, without inventing a `teacher_moderator` role.

### Tables

```
roles              (id, tenant_id, key, name, is_system, created_at)
                   unique (tenant_id, key)
role_permissions   (role_id, tenant_id, permission)   pk (role_id, permission)
membership_roles   (membership_id, role_id, tenant_id, user_id,
                    granted_at, granted_by)           pk (membership_id, role_id)
```

`tenant_id` is denormalised onto all three so every RLS policy can key on it
directly rather than joining to find out which tenant a row belongs to.

`tenant_memberships.role` stays for now as the member's legacy primary role. It
is no longer what any permission check reads, and since Phase 2 the member list
shows the roles held in `membership_roles` instead, so nothing displays it any
more. Dropping the column is a follow-up migration.

### Effective permissions, and why they are read through a definer function

Resolving "what may this person do here" needs to read `membership_roles` and
`role_permissions`. If those tables were readable to anyone holding the tenant
context, then any signed-in member, whose own permission check sets that context,
could also read every other member's roles. That is a leak created by the check
itself.

So the tables are readable only in a tenant context (which admin screens set),
and the per-request resolution goes through

```sql
auth_effective_permissions(p_user_id uuid, p_tenant_id text) returns setof text
```

a `SECURITY DEFINER` function that returns **only that user's** permissions, and
only when their membership is `active`. It is the same narrow-privileged-read
pattern already used by `auth_resolve_session` and `auth_handle_is_reserved`.

Because a definer function runs as the table owner, these three tables enable RLS
**without** `FORCE`, and so does `tenant_memberships`, which the function joins
to check the membership is active. That last one is the trap: it had `FORCE`, the
join was filtered, and the function returned nothing, so every member resolved to
no permissions at all. It failed **closed**, which is the safe direction and
exactly why it would have been easy to miss. The FORCE invariant test covers all
four, so the rule is recorded rather than remembered:

> a `SECURITY DEFINER` function cannot read, or join, a table with `FORCE`.

### The guard

`requirePermission(slug, permission)` replaced `requireTenantAdmin(slug)` in
Phase 2, which removed the older guard entirely:
it resolves the actor, asks the definer function for their permissions in that
tenant, and 404s if the permission is absent. 404 rather than 403, so an admin
surface never confirms its own existence to someone who cannot use it. Every
mutation re-checks inside its own transaction, as the verification flow already
does; the page gate is the first of two checks and never the only one.

---

## 3. Analytics, and the privacy line

**Timing only. No IP, no location, ever.** The decision is locked and the schema
reflects it: there is no column for either, so there is nothing to display by
mistake and nothing to leak.

Added to the model:

- `users.last_login_at`, set when a session is issued.
- `users.last_seen_at`, a column that already existed and was never written: the
  session `touch`, at most hourly, now moves it too, so "active this week" is
  one cheap read.

Both live on `users`, which only its owner may read, so the dashboard reads them
through two SECURITY DEFINER functions that answer for one tenant and return
counts only (`auth_tenant_activity_totals`, `auth_tenant_activity_days`), and
the member list gets a coarse bucket per person from a third
(`auth_tenant_member_activity`): today, this week, this month, longer ago, or
never. No function returns a timestamp.

The existing `sessions.ip_hash` predated this decision. It was an unsalted hash
of an address, never shown anywhere; Phase 3 stopped writing it and dropped the
column, and `audit_log.ip_hash`, which was never written, with it. A field that
must never be displayed is better absent.

What the dashboard shows: sign-ins over time, active users over time, members by
role, verification queue depth and age, plus the existing data counts. Trends
rather than totals. Everything aggregated over the tenant; a member list shows
last-active as a coarse relative time ("this week"), never a timestamp trail.

### Emails

An email is shown to a tenant admin in exactly one place: a **pending**
verification request, where the whole task is checking that a person is who they
say. It is not in the member list, not in analytics, not in the audit log, and it
disappears from the request the moment it is decided, along with the rest of the
submitted details. Everywhere else a person is their handle.

---

## 4. Tenant configuration: file to database

Until Phase 4, `tenants/*/tenant.config.ts` was compiled in and read
synchronously everywhere.

**What middleware needs, and does not.** Host → tenant resolution happens in
middleware, on the edge runtime, which cannot open a Postgres connection. It
turned out middleware never needed the configuration: it takes the subdomain
label (or the `/u/{slug}` path) as the slug and passes it down in
`x-tenant-slug`; whether that slug is a real tenant is decided by the first
server component that resolves it, which 404s otherwise. So there is no edge
snapshot to publish and nothing to revalidate at the edge. The database is the
source of truth and the app reads it where the app already runs.

- `tenant_configs` (base schema, `0004`) holds the whole validated config as
  JSON, keyed by slug, with a version; `universities` keeps the columns other
  tables and RLS key on and is kept in step by the code that writes.
- `apps/web/lib/tenants.ts` builds the registry from the database rows merged
  over the file configs (`mergeTenantConfigs` in core): per slug a valid row
  wins, a missing row falls back to the file, an invalid row is skipped and
  logged. Cached per process for 30 seconds and invalidated by a write in that
  process, so a page pays at most one read.
- Reads need no context: the rows are what render a tenant's public pages.
  Writes are allowed by policy only to a platform administrator, checked
  against their own `platform_roles` row (identity `0012`); no definer
  function, no FORCE change.
- The platform admin (`/admin` on the platform host) lists tenants with their
  source, creates one (universities row, config row, the three system roles,
  one audit line, in one transaction) and edits one. Saving a file tenant
  writes its first row, which is the migration path through the UI.
- The bootstrap from §5 arrives here too, because tenant creation needs someone
  to do it: a sign in whose address is in `SUPERADMIN_EMAILS` writes a
  `platform_roles` row once. Cross-tenant access, the rest of §5, does not.

**LGU is migrated by copying its file config into the database**, either by
saving it once in the platform admin or with `pnpm tenants:sync`, confirming
the source chip reads "Database", and only then removing the file. Rollback is
deleting the row: the file answers again within the cache window. The live
steps are a runbook (`docs/runbooks/tenant-config-to-db.md`) run by a human.

---

## 5. Platform administration, and cross-tenant access

This is Phase 5 and is **not built**; it is described here so the earlier phases
are shaped to receive it.

- **Bootstrap.** `SUPERADMIN_EMAILS` in the environment is the master key: a
  verified Google sign-in whose address is listed becomes a platform admin. It is
  a bootstrap, not a session: the environment names who _may_ be one; a
  `platform_roles` row records who _is_.
- **Login** at `campusos.reivex.io/login`, the platform host, which has no tenant.
- **Cross-tenant access is an explicit, audited, per-request switch.** A platform
  admin does not silently gain every tenant. They open a _tenant grant_: a
  short-lived, reason-carrying record naming one tenant. Requests made under it
  set the ordinary `app.tenant_id` context and are subject to exactly the same
  RLS as a tenant admin's. **No superuser, no `BYPASSRLS`, no second database
  role.** God-mode is breadth, never depth: it can reach any tenant, and inside
  one it can do no more than that tenant's own administrator.
- **Logging is atomic with the access.** The audit row is written in the same
  transaction as the work, so an unlogged cross-tenant action cannot exist: if
  the log fails, the action rolls back. `audit_log` is already append-only at the
  database level, with a trigger that refuses updates and deletes.
- **Assigning tenant admins** replaces `adminEmails`. The file list is read once
  during migration to seed the existing grants, then retired.

The security review of this design is the gate before any of it is written.

---

## 6. Phases

| Phase | What                                                      | Risk                                |
| ----- | --------------------------------------------------------- | ----------------------------------- |
| 1     | RBAC schema, RLS, resolver, guard; migrate `tenant_admin` | Safe, additive                      |
| 2     | Tenant-admin UI for members and roles                     | Safe, gated by Phase 1              |
| 3     | Analytics with activity timing                            | Safe, additive                      |
| 4     | Tenant config file → database, super-admin tenant CRUD    | Delicate: touches the live tenant   |
| 5     | Cross-tenant god-mode                                     | Gate: planned, reviewed, then built |

Each phase is its own pull request, green in CI, merged before the next begins.
