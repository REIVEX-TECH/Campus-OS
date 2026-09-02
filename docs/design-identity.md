# Identity and auth: design

Status: **design only, nothing built.** This document is for review before any
code lands. It follows the architecture decision already made: **Firebase is the
Google sign in provider and nothing else.** Firebase answers exactly one
question, "does this person control this Google account", and returns a verified
email plus a signed token. Everything that makes someone a user of CampusOS lives
in our Postgres under RLS: the user record, sessions, tenant membership, roles,
the anonymous handle, and every authorisation decision.

Firebase is a thin front door. Postgres is the identity system.

---

## 0. What already exists, and why it constrains this design

Three facts about the current codebase drive most of what follows.

**RLS is the real boundary, and it is forced.** Every tenant scoped table has
`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`, with the policy
`USING (tenant_id = current_setting('app.tenant_id', true))` and the same
expression as `WITH CHECK`. `FORCE` means the policy applies even to the table
owner (`campusos_app`). `current_setting(..., true)` returns NULL when unset, so
**no tenant context means no rows**: default deny. A superuser still bypasses
RLS, which is precisely why the application must never connect as one.

**Tenant context is transaction local.** `withTenant(tenantId, fn)` opens a
transaction and runs `set_config('app.tenant_id', $1, true)`. The final `true`
makes it local to the transaction, so it is safe on a pooled connection and
cannot leak into the next query.

**Tenant config is files today.** `tenants/{slug}/tenant.config.ts` is validated
by a zod schema at load and assembled by `createTenantRegistry([...])`. The slug
is permanent and is the `tenant_id` on every scoped row.

Two consequences shape this design:

1. Identity tables are **not all tenant scoped**. A user exists above tenants and
   may belong to several. So `app.tenant_id` alone cannot protect them, and a
   second context variable is needed.
2. The super admin question is not "how do we bypass RLS" but "who is allowed to
   set a tenant context, and how do we record it". That reframing is the whole of
   section 4.

---

## 1. User model

### Tables

All identity tables are platform level except `tenant_memberships`, which is
tenant scoped and joins the two worlds.

```
users
  id                uuid pk
  google_sub        text unique not null      -- Google stable subject id
  email             citext unique not null    -- verified by Firebase
  email_verified_at timestamptz not null
  handle            citext unique not null    -- public anonymous identity
  handle_changed_at timestamptz
  avatar_seed       text not null             -- feeds the existing IdentityAvatar
  status            text not null             -- active | suspended | deleted
  created_at        timestamptz not null
  last_seen_at      timestamptz

sessions
  id                uuid pk
  user_id           uuid not null -> users(id) on delete cascade
  token_hash        bytea not null unique     -- sha256 of an opaque 256 bit token
  created_at        timestamptz not null
  last_used_at      timestamptz not null
  expires_at        timestamptz not null      -- absolute expiry
  revoked_at        timestamptz
  user_agent        text
  ip_hash           bytea                     -- hashed, never raw

tenant_memberships
  id                uuid pk
  tenant_id         text not null -> tenants(slug)
  user_id           uuid not null -> users(id) on delete cascade
  role              text not null             -- student | teacher | tenant_admin
  status            text not null             -- active | invited | suspended
  created_at        timestamptz not null
  unique (tenant_id, user_id)

platform_roles
  user_id           uuid pk -> users(id) on delete cascade
  role              text not null             -- platform_admin
  granted_by        uuid -> users(id)
  granted_at        timestamptz not null
```

**We deliberately do not store the Google display name or photo.** The only
things taken from Google are the subject id and the verified email. The public
identity is the anonymous handle (section 2). This is data minimisation per
CLAUDE.md 8, and it removes any temptation to render a real name.

### Roles

Four roles, in two scopes:

- Per tenant, on `tenant_memberships.role`: `student`, `teacher`, `tenant_admin`.
- Platform wide, on `platform_roles.role`: `platform_admin`, the super admin.

`platform_admin` is intentionally a separate table, not a role value on
membership, because it is not scoped to a tenant and must never be grantable by a
tenant admin. Granting it is itself an audited action.

### How a user gets attached to a tenant

A user signs in once with Google. Membership is separate from authentication, and
there are three ways to acquire it:

1. **Email domain match.** A tenant config carries `allowedEmailDomains` (LGU has
   `lgu.edu.pk`). If the verified email matches, the user may self join that
   tenant as `student`. This is the normal path and needs no admin.
2. **Invitation.** A tenant admin invites an address; the membership row is
   created with `status = 'invited'` and activates on first sign in. This is how
   `teacher` and `tenant_admin` are granted.
3. **Platform admin grant.** Audited, and the bootstrap path for a brand new
   tenant that has no admin yet.

A user with no membership is still a valid user; they simply see only public
pages. Nothing about signing in implies membership.

### RLS on the identity tables

This needs care, because `app.tenant_id` does not apply to a table that has no
`tenant_id` column.

We introduce a second transaction local context variable, **`app.user_id`**, set
by a new `withActor(userId, fn)` helper that mirrors `withTenant`. Both can be set
on the same transaction.

| Table                | Policy                                                                                                       | Reasoning                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`              | `id = current_setting('app.user_id', true)::uuid`                                                            | A signed in user reads and updates only their own row. No user context, no rows: default deny, same shape as tenants.                             |
| `sessions`           | `user_id = current_setting('app.user_id', true)::uuid`                                                       | A user can list and revoke their own sessions.                                                                                                    |
| `tenant_memberships` | `user_id = current_setting('app.user_id', true)::uuid OR tenant_id = current_setting('app.tenant_id', true)` | Two legitimate reads: "which tenants am I in" (user context, before a tenant is chosen) and "who is in this tenant" (tenant context, for admins). |
| `platform_roles`     | `user_id = current_setting('app.user_id', true)::uuid`                                                       | A user sees their own platform role. Listing all platform admins is an audited action through a narrow function, not a broad policy.              |
| `audit_log`          | see section 4                                                                                                | Append only, readable in tenant context by that tenant's admins.                                                                                  |

**The session lookup problem, and the one escape hatch.** Resolving a request's
session happens before we know who the user is: we hold a token, not a user id.
That read cannot satisfy a `user_id = app.user_id` policy. Rather than weaken the
policy, we expose exactly one `SECURITY DEFINER` function:

```sql
auth_resolve_session(token_hash bytea)
  returns table (user_id uuid, session_id uuid, expires_at timestamptz)
```

It is owned by a role that can read `sessions`, takes a hash rather than a token,
and returns at most one row for an exact match, so it cannot enumerate. Everything
else about sessions goes through normal RLS. This keeps "RLS is the boundary" true
without exception and confines the exception to a single reviewable function.

**What RLS does and does not guarantee here.** RLS guarantees tenant isolation and
own row access. It does **not** encode the full role matrix: whether a `student`
may rename a room is an application layer decision. Encoding RBAC in policies
makes them hard to reason about and easy to get subtly wrong, and a mistake there
is silent. So: RLS is the hard wall between tenants; role checks are an explicit,
unit tested `can(actor, permission)` layer on top, called server side by every
protected route. Both are required and neither substitutes for the other. The
split is stated so a reviewer knows exactly where to look for each guarantee.

---

## 2. Anonymous identity

The Google email is the **private** link, used for authentication, tenant
eligibility, and moderation accountability. The **public** identity is an
anonymous handle plus a generated avatar. Nothing public reveals the email.

### Generation

On first sign in the user is assigned `Adjective_Noun_1234`:

- Curated word lists, roughly 256 adjectives and 256 nouns, both reviewed for
  unfortunate combinations and kept clear of anything identity related: no
  nationalities, genders, religions, or body words. With a four digit suffix that
  is about 671 million combinations, so collisions are rare and cheap to retry.
- Uniqueness is enforced by a unique index on `handle`, stored as citext, so
  `Brave_Otter_12` and `brave_otter_12` cannot both exist and impersonation by
  case is impossible.
- Assignment is generate, insert, and on unique violation retry with a fresh
  suffix, bounded to a few attempts before widening the suffix. Uniqueness comes
  from the database constraint, never from a pre check, so it is race free.
- `avatar_seed` defaults to the user id and feeds the `IdentityAvatar` component
  that already exists and is deterministic. Same user, same mark, everywhere.

### Changing it later

Both handle and avatar are changeable, with guards that exist to stop
impersonation and churn:

- Rate limited to one change per 30 days, surfaced in the UI as a date.
- The previous handle is written to `handle_history` and reserved for 90 days, so
  a freed handle cannot immediately be taken to impersonate its former owner.
- The new handle is validated against the generator alphabet plus a blocklist:
  reserved words such as `admin`, `moderator`, `campusos`, `staff`, and a
  profanity list.
- Changing the handle does not change the user id, so moderation history follows
  the account rather than the name.
- `avatar_seed` may be re rolled freely; it carries no meaning.

### Exposure

A `public_profiles` view exposes only `user_id`, `handle`, and `avatar_seed`.
Public UGC joins go through that view, so an accidental `select *` on `users` can
never leak an email into a response.

---

## 3. Per module auth

Login gates **specific actions**, not the site. Timetable, free rooms, search, and
the teacher and room profiles stay fully public and must keep working signed out.
Posting, marketplace, communities, and admin require an account.

### Declaring it

The module manifest already carries `routes`, `apiRoutes`, and `permissions`. We
extend the route types with an explicit access rule:

```ts
type Access =
  | { visibility: 'public' }
  | { visibility: 'authenticated'; permission?: string }
  | { visibility: 'tenant_admin' }
  | { visibility: 'platform_admin' };

interface ModuleRoute {
  path: string;
  id: string;
  access: Access;
}
interface ModuleApiRoute {
  method: HttpMethod;
  path: string;
  id: string;
  access: Access;
}
```

`access` is **required, not optional**. That is the important detail: a developer
adding a route cannot forget it, and there is no implicit default that could
silently expose something. The timetable module explicitly marks its read routes
`public`, which is a visible, reviewable statement rather than an accident.

A unit test walks every registered manifest and asserts each route carries an
access rule, so the fail closed property is enforced by CI rather than discipline.

### Enforcing it

Two layers with clearly different jobs:

1. **Middleware, for user experience, not security.** Middleware runs on the edge
   and cannot reach Postgres, so it must never be trusted for authorisation. It
   does one cheap thing: if a route is known to need auth and there is no session
   cookie at all, redirect to sign in, avoiding a flash of a protected page. It
   can be wrong without being unsafe.
2. **The server side guard, which is the actual boundary.** Every protected server
   component and route handler calls `requireActor(access)`, which resolves the
   session, loads the actor and their membership for the current tenant, evaluates
   the rule, and either returns the actor or throws a redirect or 403. Because the
   check sits where the data is fetched, no path renders or mutates without it.
   This satisfies CLAUDE.md 8: hiding a UI element is not access control.

The guard returns an `Actor` of `{ userId, handle, tenantRole, platformRole }`, and
repositories take the tenant id from the **verified membership**, never from the
URL. That is what makes section 5 hold.

---

## 4. Platform super admin: the critical design

This is the piece to scrutinise hardest, so it is written as explicit guarantees
and the mechanism providing each.

### The rule

**The super admin never bypasses RLS.** There is no `BYPASSRLS` role, no superuser
connection, no wildcard policy such as `app.tenant_id = '*'`, and no second
database user with wider grants. If any of those existed, the platform's strongest
guarantee would degrade into a matter of application correctness, which is exactly
what we refuse.

### The reframing

A platform admin does not get more database power. They get the right to **open a
tenant context they are not a member of**, and that right is checked in the
application, time boxed, and recorded. Once the context is open, their queries run
through the identical `withTenant(tenantId, ...)` path as any ordinary request, and
RLS constrains them to that one tenant.

The invariant a reviewer should check: **no request ever holds a database context
that can see two tenants' rows.** Cross tenant work is a sequence of single tenant
contexts, each separately authorised and logged.

### Entering a tenant

```
admin_tenant_sessions
  id             uuid pk
  actor_user_id  uuid not null -> users(id)
  tenant_id      text not null -> tenants(slug)
  reason         text not null            -- required, empty string rejected
  started_at     timestamptz not null
  expires_at     timestamptz not null     -- short, 30 minutes
  ended_at       timestamptz
  ip_hash        bytea
```

The flow:

1. The admin opens `campusos.reivex.io/admin`, picks a tenant, and must type a
   **reason**. The field is mandatory and stored.
2. The server verifies `platform_roles.role = 'platform_admin'` for the actor.
3. **Step up authentication.** If the session's last successful authentication is
   older than a short window, say 15 minutes, Google re authentication is required
   before the grant is issued. A stolen long lived session is therefore not enough
   to enter a tenant.
4. A row is inserted into `admin_tenant_sessions` with a 30 minute expiry, and an
   `audit_log` entry `admin.tenant.enter` is written **in the same transaction**.
   If the audit write fails, the grant fails. The grant and its audit record are
   atomic, so an unlogged entry is not representable.
5. The active grant id is held in the admin's session. Every subsequent request re
   reads the grant, checks it is unexpired and unended, and only then calls
   `withTenant(grant.tenant_id, ...)`.

Leaving is explicit (`admin.tenant.leave`) or automatic at expiry. Expiry is
enforced server side on every request, never by a browser timer.

### Auditing

```
audit_log
  id                      bigserial pk
  at                      timestamptz not null default now()
  actor_user_id           uuid                  -- null for system actions
  admin_tenant_session_id uuid                  -- set for platform admin work
  tenant_id               text                  -- the tenant the action touched
  action                  text not null         -- 'room.rename', 'admin.tenant.enter'
  target_type             text
  target_id               text
  request_id              text                  -- correlates to the access log
  ip_hash                 bytea
  meta                    jsonb                 -- before and after for mutations
```

Rules:

- **Every mutation** under an admin tenant session writes one row, with before and
  after values in `meta`.
- **Every request** under an admin tenant session also writes a row recording the
  route touched. Admin sessions are rare and 30 minutes long, so the volume is
  bounded and completeness is worth it. This is what makes "every cross tenant
  access is logged" literally true rather than approximately true.
- The log is **append only**. `UPDATE` and `DELETE` are revoked from the
  application role and a trigger raises an exception on either, so a compromised
  application cannot rewrite history.
- **The affected tenant can see it.** A tenant admin reading their own audit view
  sees every platform admin entry into their tenant, with actor handle, reason,
  and timestamps. A platform that can silently enter its customers' data is one
  customers should not trust; making entry visible to the tenant is the difference.
  This is a product commitment, not merely a log table.

### Creating and configuring tenants

Tenant creation operates on the platform level `tenants` table (section 6), which
is not tenant scoped. It is guarded by a distinct `platform.tenant.create`
permission and audited the same way. It does not require, and must not use, a
tenant context.

### Residual risks, stated plainly

- A compromised `platform_admin` account can reach any tenant, one at a time, and
  the audit trail will show it. Mitigations are step up auth, short grants, the
  mandatory reason, tenant visible logs, and keeping the number of platform admins
  very small. No amount of RLS removes this risk; the design makes it loud rather
  than silent.
- Anyone with direct database superuser access bypasses everything. That is a
  deployment and secrets concern, which is why the application role is least
  privilege and `FORCE RLS` is on.

---

## 5. Per tenant admin

A `tenant_admin` at `{slug}.campusos.reivex.io/admin` manages only their own
tenant: rooms today, users and content later.

The boundary is structural, not conditional:

1. The host resolves to a slug, using the existing middleware logic.
2. `requireActor({ visibility: 'tenant_admin' })` loads the actor's membership
   **for that slug**. No membership with `role = 'tenant_admin'` means 404.
3. The tenant context passed to `withTenant` comes from the **membership row**,
   not from the URL or a header.
4. RLS then forces every statement to that tenant.

So no code path lets a tenant admin's request set a tenant context they are not a
member of. The only code that sets a context for a non member is the audited
platform admin path in section 4, which is a different and separately reviewed
function.

Integration tests to write: a `tenant_admin` of tenant A receives zero rows and a
403 on every admin surface of tenant B, including direct API calls carrying a
forged `x-tenant-slug` header, which middleware already strips and re sets.

---

## 6. Database backed tenant config

Today `tenants/{slug}/tenant.config.ts` is compiled in. The goal is admin editable
records: name, slug, logo, theme colour, enabled modules, and SEO, all editable by
the platform admin, nothing hardcoded.

### The table

```
tenants
  slug                  text pk            -- permanent, never updated
  display_name          text not null
  aliases               text[] not null default '{}'
  timezone              text not null
  locale                text not null
  branding              jsonb not null     -- colours, logo reference
  allowed_email_domains text[] not null default '{}'
  enabled_modules       text[] not null default '{}'
  seo                   jsonb not null
  status                text not null      -- active | disabled
  created_at            timestamptz not null
  updated_at            timestamptz not null
```

`slug` stays immutable, enforced by a trigger, because it is the `tenant_id` on
every scoped row and the RLS key. Renaming it would orphan data.

**The same zod schema validates both sources.** `packages/core/src/tenant/schema.ts`
already validates file configs; the database row is parsed through it too. Two
sources, one validation boundary, so behaviour cannot drift.

### Migration without breaking LGU

The risk is not the table. It is that **middleware resolves a tenant on every
request and runs on the edge, where it cannot query Postgres.** That is the one
genuinely hard part of this migration and the thing most likely to cause an
outage if rushed.

Sequenced so the live tenant is never at risk:

1. **Add the table and a `TenantSource` interface** with two implementations,
   `FileTenantSource` (today's behaviour) and `DbTenantSource`. Nothing switches.
2. **Seed from the files**, idempotently, so database and files agree exactly. A
   test asserts the seeded row parses to a value deep equal to the file config.
3. **Introduce `TENANT_SOURCE=file|db`**, defaulting to `file`. The registry reads
   through the interface. Still no behaviour change in production.
4. **Solve the edge problem.** Middleware needs only host to slug resolution,
   which is pure string work over a small set of slugs and aliases. That set is
   published as a cached snapshot, revalidated periodically and on tenant edit,
   rather than queried per request. Full config is loaded server side from an in
   process cache with a short TTL and explicit invalidation when an admin saves.
5. **Flip staging to `db`**, verify the live LGU pages, then flip production.
   Rolling back is an environment variable, not a deploy.
6. **Keep the file configs** as the bootstrap seed for a fresh environment and for
   local development. Remove the runtime file path only once the database path has
   been stable for a while.

Logo and theme become editable data, so `branding.logoPath` becomes a stored asset
reference. Asset storage sits behind an interface per CLAUDE.md 2, with a local
filesystem implementation first, so there is no vendor lock in and no paid tier.

---

## 7. Retiring `ADMIN_SECRET`

Today admin access is an HMAC of the tenant slug keyed by a shared `ADMIN_SECRET`,
carried in a cookie and checked server side. It is honest about being a stopgap.
It must not break during the transition.

1. **Identity ships; the secret still works.** No change to admin access.
2. **Dual accept.** `requireAdmin` accepts either a valid legacy admin token or an
   authenticated actor with `tenant_admin` for that tenant. Which path was used is
   recorded on every admin request, so adoption is measured rather than guessed.
3. **Create real admins.** A platform admin grants `tenant_admin` membership to
   the people who currently share the secret. They sign in with Google.
4. **Turn the legacy path off per environment** with `ADMIN_LEGACY_SECRET=off`,
   which needs no deploy and reverts instantly. Flip it only once the audit shows
   every admin for that tenant has signed in through the new path at least once.
5. **Delete the code and the variable** in a final PR, updating `.env.example`.

At no point is there a window where a tenant cannot reach its admin.

---

## 8. Security and moderation

The platform will host student users and, later, user generated content. Per
CLAUDE.md 8, the moderation surface ships **with** UGC, not after it.

### Accountability

The anonymous handle maps to a verified university email. That link is the whole
accountability model: pseudonymous in public, attributable to moderators.
Revealing it requires a `moderation.identity.reveal` permission and writes an
`audit_log` entry every time, with a reason, exactly like a tenant entry.
Moderators are told in the interface that the lookup is logged.

### What must exist before any UGC ships

- Reporting: report a post, comment, or user, into a queue with a reason.
- A moderation queue with actions, each audited: hide, delete, warn, suspend, ban.
- Blocking and muting at the user level, enforced server side in queries rather
  than by filtering in the client.
- Rate limits on posting and on report submission, to stop both spam and report
  brigading.
- An appeal path, so a suspension is not a dead end.
- Retention and deletion: what a user deletion removes, what it anonymises, and
  what the audit trail keeps for accountability. These conflict, and the
  resolution belongs in writing before launch rather than during an incident.

### Session and transport hygiene

- Opaque 256 bit session tokens, stored only as sha256 hashes, so a database dump
  yields no usable sessions.
- `httpOnly`, `Secure`, `SameSite=Lax` cookies, with absolute and idle expiry.
  Revoke all sessions on email change, handle change, or suspension.
- Rate limit every auth endpoint and the Firebase token exchange.
- No PII in URLs, logs, or analytics. IP addresses are hashed before storage.
- The Firebase token is verified server side against Google's published keys on
  every exchange, checking issuer, audience, expiry, and `email_verified`. An
  unverified email is rejected outright.

### Data minimisation

We store the Google subject id and the verified email. We do not store the Google
display name or photo. If a future feature needs a real name, that is a new and
separately reviewed decision with its own consent, not a quiet addition.

---

## 9. Proposed PR sequence

Ordered so that the riskiest, least reversible pieces land only after the
foundations they depend on are already proven in production. Each PR is
independently revertible.

**PR 1: identity schema and RLS. The safe first PR.**
Adds the `identity` module package with `users`, `sessions`, `tenant_memberships`,
`platform_roles`, `handle_history`, and `audit_log`, their RLS policies, the
`app.user_id` context and `withActor` helper, and the `auth_resolve_session`
function. No routes, no UI, no auth flow, nothing user visible. Its whole value is
integration tests that prove isolation: a user cannot read another user's row,
membership reads work in both contexts, and the audit log rejects update and
delete. Nothing in the running product changes, so this is safe to land early and
review slowly.

**PR 2: Firebase verification and sessions.**
Server side token verification against Google's keys, sign in and sign out, the
session cookie, and `requireActor`. A user can sign in and see their own handle
placeholder. Still gates nothing, so the public site is unaffected.

**PR 3: anonymous identity.**
Word lists, handle assignment on first sign in, the avatar seed, the
`public_profiles` view, the profile page, and the change flow with its reservation
window.

**PR 4: per module access rules.**
Adds required `access` to manifest routes, the CI test that every route declares
one, the middleware redirect, and the guard. Timetable routes are marked public
explicitly. Admin pages start requiring `tenant_admin` while still accepting the
legacy secret, which is step 2 of section 7.

**PR 5: the platform admin path.**
`platform_roles`, `admin_tenant_sessions`, step up authentication, the audited
tenant context switch, the audit writer, and the tenant facing audit view. This is
the highest risk PR and deliberately lands after the guard and the audit table
have been in production for a while.

**PR 6: database backed tenant config, behind a flag.**
The `tenants` table, `TenantSource` with both implementations, the idempotent
seed, the cached host to slug snapshot for the edge, and `TENANT_SOURCE` defaulting
to `file`. Production behaviour is unchanged on merge; the flip is a separate,
observable operational step.

**PR 7: tenant administration UI.**
Platform admin screens to create a tenant and edit branding, modules, and SEO,
writing through the same zod validation.

**PR 8: retire `ADMIN_SECRET`.**
Flip `ADMIN_LEGACY_SECRET=off`, then delete the code path and the variable.

**PR 9, only alongside the first UGC feature: moderation.**
Reporting, queue, blocking, rate limits, appeals, and the audited identity reveal.
This does not ship before it is needed, but no UGC ships without it.

### Open questions for review

1. **Audit volume.** Logging every request under an admin session, not only every
   mutation, is the honest reading of "every cross tenant access is logged". It
   costs write volume during admin sessions. Confirm that trade is the one you
   want, or narrow it to mutations plus one entry per route per session.
2. **Step up window.** 15 minutes for re authentication before entering a tenant,
   and a 30 minute grant. Both are guesses that should match how you actually
   work.
3. **Self join by email domain.** Anyone with an `lgu.edu.pk` address becomes a
   student automatically. If LGU would rather approve members, that becomes an
   invitation only tenant setting, which is a small addition to the tenants table.
4. **Teacher claiming.** The timetable already has teacher records from the
   import. Should a signed in teacher be able to claim their imported record, and
   who approves that? This links a public directory entry to a real account and
   deserves its own decision.
