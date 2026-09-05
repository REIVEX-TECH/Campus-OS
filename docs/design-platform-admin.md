# Platform administration, tenant management, and per-tenant RBAC

Design for the highest-stakes work in the project: cross-tenant power and
permissions. Written before Phase 1 and kept current as the phases land.

Status: see `docs/platform-admin-status.md` for what is built and what is not.

---

## 1. What exists today, and what is wrong with it

- A tenant admin is a `tenant_memberships` row with `role = 'tenant_admin'`.
  One role per person per tenant, enforced by a unique index on
  `(tenant_id, user_id)`, and the role is a bare text column.
- Who gets that role is granted through the roles UI (a platform admin under a
  grant, or an existing tenant admin), audited. It is no longer a config value:
  `adminEmails` was retired (converted once by migration 0023, then removed in
  0025), because a database-editable value must never decide who is an admin.
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

| Permission              | Guards                                                      |
| ----------------------- | ----------------------------------------------------------- |
| `manage-timetable`      | Ingestion controls, term and section edits                  |
| `manage-rooms`          | Room naming and mapping                                     |
| `approve-verifications` | The verification queue, and the emails on it                |
| `manage-members`        | Viewing the member list                                     |
| `manage-roles`          | Assigning and revoking a tenant's existing roles            |
| `restrict-members`      | Restricting a member to read-only, suspending their sign in |
| `view-analytics`        | The analytics dashboard                                     |
| `post`                  | Creating content in future modules                          |
| `moderate`              | Hiding content, handling reports                            |

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

### Definitions and assignments are different powers

Deciding **which roles exist and what each one carries** is not the same power as
deciding **who holds one here**, and the two belong to different people:

| Power                                            | Whose            | Where                        |
| ------------------------------------------------ | ---------------- | ---------------------------- |
| Create a role, change its permissions, retire it | Platform admin   | The platform host, no tenant |
| View the definitions, read only                  | Tenant admin     | `/admin/roles`               |
| Grant a role to a member, revoke it              | Tenant admin     | `/admin/members`             |
| Hold a role                                      | Anyone in tenant | `membership_roles`           |

Until this split, `manage-roles` carried both, and that is an escalation hole
rather than a convenience. A tenant administrator could mint a role carrying
`communities.unmask`, a permission the catalogue deliberately gives to **nobody**,
and grant it to themselves; nothing compared the new role against the granter's
own. The catalogue's careful default was one form submission away from being
undone by the person it was written to constrain.

**Definitions become platform-level templates.**

```
role_templates             (key, name, is_system, created_at, updated_at)
                           pk (key)                     -- no tenant_id
role_template_permissions  (template_key, permission)   pk (template_key, permission)
```

There is no `tenant_id` on either, because a definition is not a tenant's to
own. A platform admin edits them at `campusos.reivex.io`, which has no tenant
context, so this needs no cross-tenant grant and does not wait for Phase 5.

A tenant's `roles` and `role_permissions` rows stay exactly as they are, and
become **materialisations** of the templates: written when a tenant is created,
and rewritten when a template changes, by a sync of the same shape as
`pnpm tenants:sync`. Every permission check keeps reading the tenant's own rows
through `auth_effective_permissions`, so the hot path does not change at all.

**Assignment gets the rule that was missing.** A grant is refused when the target
role carries any permission the granting actor does not themselves hold:

> nobody may grant a power they do not have.

That is one set comparison against `auth_effective_permissions` for the actor,
inside the granting transaction. It makes `communities.unmask` behave as written:
a tenant admin cannot reach it, because they do not hold it.

`manage-roles` therefore narrows to assigning and revoking. The permission that
edits definitions is not in the tenant catalogue at all: it is platform-admin
status, which is a `platform_roles` row and not a tenant permission.

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

- `tenant_configs` (identity `0012`; the base folder stays frozen, see the
  migration's header) holds the whole validated config as
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
- **Assigning tenant admins** has replaced `adminEmails`. The file list was read
  once (migration 0023) to seed the existing admins as real memberships, then the
  field and its sign-in seeding were removed (0025). Creating a tenant and
  appointing its first administrator are one act: a tenant with nobody who can
  administer it is a tenant nobody can finish setting up.

The security review of this design is the gate before any of it is written.

---

## 6. Membership, restriction, and suspension

Three things about a person in a tenant are separate, and conflating any two of
them is how this goes wrong:

| Thing            | What it says                                | Where it lives                          |
| ---------------- | ------------------------------------------- | --------------------------------------- |
| **Role**         | What they may do                            | `membership_roles` → `role_permissions` |
| **Verification** | Whether the university has confirmed them   | `tenant_memberships.verified_at`        |
| **Standing**     | Whether they may act, or sign in, right now | `tenant_memberships.status`             |

**Everyone who signs in gets `student`.** Not only those whose address matches
the tenant's domain: a membership is created for any signed-in person on the
tenant they signed in on, with the `student` role, which carries reading and
nothing else that matters. Verification is layered on top and is what
`communities.post`, `communities.comment`, `communities.vote` and
`communities.create` actually wait for. The domain policy decides whether
verification is automatic, not whether the person exists here.

That is a change from `ensureDomainMembership`, which returned null and wrote
nothing for an address off the list, leaving a signed-in person with no
membership at all and therefore no way to even request verification from a page
that reads their membership to render itself.

**Standing has three values, and only one is a punishment of the account.**

| Status       | May sign in | May read | May write | Set by             |
| ------------ | ----------- | -------- | --------- | ------------------ |
| `active`     | yes         | yes      | yes       | joining            |
| `restricted` | yes         | yes      | **no**    | `restrict-members` |
| `suspended`  | **no**      | no       | no        | `restrict-members` |

`restricted` is what today's `suspended` already does and all it does: every
write in the communities module passes one choke point, `isVerifiedMember`,
which requires `status = 'active'`, so a non-active membership is read-only
already. This renames it honestly and gives it the three things it lacked: a
reason, an actor, and an expiry.

`suspended` is new and is enforced one layer lower, where a session resolves
into an actor. A suspended person is signed out of that tenant, not of the
platform: the same account may be in good standing at another university.

Both are reversible, both carry `restriction_reason`, `restricted_by` and
`restricted_until` (null meaning until lifted), and both write an `audit_log`
line in the same transaction as the change.

**Nothing is ever shadow-applied.** A restricted person is shown what was done,
why, and until when, and may leave one appeal note that reaches the tenant's
administrators. A system that lies to the person it is punishing cannot be
appealed against, and an unappealable moderation system is one that never
learns it was wrong.

**The ladder.** A community moderator bans and mutes inside their own community
and nowhere else. A tenant administrator restricts and suspends inside their own
tenant. A platform administrator does the same in any tenant, under the Phase 5
grant, as that tenant's administrator and never as more.

---

## 7. Phases

| Phase | What                                                      | Risk                                |
| ----- | --------------------------------------------------------- | ----------------------------------- |
| 1     | RBAC schema, RLS, resolver, guard; migrate `tenant_admin` | Safe, additive                      |
| 2     | Tenant-admin UI for members and roles                     | Safe, gated by Phase 1              |
| 3     | Analytics with activity timing                            | Safe, additive                      |
| 4     | Tenant config file → database, super-admin tenant CRUD    | Delicate: touches the live tenant   |
| 5     | Cross-tenant god-mode                                     | Gate: planned, reviewed, then built |
| 6     | Role definitions to platform templates; no upward grant   | Delicate: moves an existing power   |
| 7     | Membership for everyone; restriction and suspension       | Safe, additive; one status rename   |

Each phase is its own pull request, green in CI, merged before the next begins.

Phases 6 and 7 do not wait for 5. Definitions move to the platform host, which
has no tenant context and therefore needs no cross-tenant grant; restriction and
suspension are a tenant administrator's powers, which exist already. Phase 5 adds
one line to each: a platform administrator, acting under a grant, is that
tenant's administrator and can do exactly what one can.
