# Phase 5: cross-tenant access for platform administrators. Build plan, for review

**Status: plan only. Nothing here is built.** This is the security gate in
`docs/design-platform-admin.md` §5 and §6; the code starts when this plan has
been reviewed and approved as written or as amended. Written in the CLAUDE.md
§3 shape so the review can go line by line.

What Phases 1 to 4 already give a platform administrator: a `platform_roles`
row from `SUPERADMIN_EMAILS`, and the ability to create and edit universities.
What they deliberately do not give: any reach into a university. A platform
admin with no membership resolves to no permissions in every tenant and gets the
same 404s as a stranger. Phase 5 adds one thing, an explicit, expiring, audited
switch into one tenant at a time, and changes nothing about who a tenant's own
administrators are.

## 1. Plan

1. **Schema** (identity `0013_tenant_grants.sql`): `tenant_grants (id uuid pk,
user_id uuid → users, tenant_id text → universities, reason text not null,
created_at, expires_at not null, revoked_at)`, index on `(user_id, tenant_id,
expires_at)`. RLS **with FORCE**, one policy: own row (`user_id::text =
current_setting('app.user_id')`) for select, insert and update. No definer
   function reads it; the FORCE invariant map gains `tenant_grants: true`.
   `audit_log.admin_tenant_session_id` (already there since `0000`) is where a
   grant id lands; no schema change to the log.
2. **Opening and closing a grant** (`identity/src/grants.ts`):
   `openTenantGrant(actor, tenantId, { reason, minutes })` requires
   `isPlatformAdmin` (application check), a reason of at least 10 characters,
   a duration clamped to 60 minutes, and a tenant the registry knows; inserts
   the own row and writes `platform.grant_opened` (tenant, `meta.grantId`,
   `meta.minutes`) in the same transaction. `closeTenantGrant(actor, grantId)`
   sets `revoked_at` and writes `platform.grant_closed`. `liveGrant(actor,
tenantId)` returns the newest unexpired, unrevoked grant or null.
3. **How the grant becomes permissions, and nothing else.** No superuser, no
   `BYPASSRLS`, no second database role, no new definer function, no change to
   `auth_effective_permissions`. Instead the actor object every identity
   function already takes (`{ userId }`) may carry `grantId`, and
   `withActorInTenant` sets a third transaction-local setting, `app.grant_id`,
   when it is present. `canInTransaction` and `effectivePermissions` gain one
   branch: if `app.grant_id` is set, select the grant **as the actor, through
   the own-row policy**, and only when it exists, names this tenant, is
   unexpired and unrevoked, the effective set is `tenant_admin`'s catalogue.
   The predicate `expires_at > now()` is evaluated in SQL on every check, so an
   expired grant fails closed mid-session. The ordinary `app.tenant_id` context
   still bounds every table exactly as it bounds a tenant admin: breadth, never
   depth.
4. **Logging is atomic with the access.** `recordAudit` reads `app.grant_id`
   and stores it in `admin_tenant_session_id` on every line it writes, in the
   same transaction as the work. Every existing mutation already writes its
   line through `recordAudit`, so nothing done under a grant can commit without
   naming the grant, and a failed log rolls the action back. Reads under a
   grant (pages) are covered by the `platform.grant_opened` line, which names
   the tenant, the reason and the window.
5. **Carrying the grant on requests** (`apps/web/lib/grant-cookie.ts`): opening
   a grant sets `campusos_grant=<grantId>`, `HttpOnly`, `Secure`,
   `SameSite=Lax`, `Max-Age` = the window, `Domain` = `TENANT_BASE_DOMAIN`, so
   the tenant subdomains see it (in local dev the path form shares the host).
   The cookie is a pointer, not a credential: the row is re-read under the
   actor's own context on every request, and a cookie for someone else's grant
   matches no row.
6. **The guard** (`apps/web/lib/auth.ts`): `permitted` and `requirePermission`
   first resolve permissions as today. If none is held and the actor is a
   platform admin and the cookie names a live grant for this slug, the answer
   is `tenant_admin`'s set plus `grant: { id, tenantId, expiresAt, reason }`,
   and the actor passed to every mutation carries `grantId`. Without a live
   grant a platform admin stays at 404 everywhere in a tenant, which is the
   property the e2e pins.
7. **UI.** On `/admin/tenants/[slug]` (platform host): "Open this university",
   a reason field and a duration (15, 30, 60 minutes), `POST
/api/platform/grants`, then a redirect to the tenant's `/admin`. On every
   tenant admin page while a grant is live: a quiet banner above the admin nav,
   "Acting in {name} under a grant · expires in {n} min · {reason}", with
   "End now" (`POST /api/platform/grants/close`). The tenant admin pages
   themselves change in no other way; a platform admin under a grant uses the
   same Members page to make someone `tenant_admin`, which is how a tenant's
   first administrator is appointed from now on.
8. **`adminEmails` retirement, first half.** `tenantConfigSchema.adminEmails`
   is marked deprecated in its docstring and hidden from the tenant form; the
   sign-in upgrade keeps working so nothing breaks on deploy. Its removal, with
   `ensureConfiguredAdmin`, is a follow-up PR once LGU's administrator has been
   granted the role through the UI and confirmed.
9. **Transparency to the tenant.** Tenant administrators can see when the
   platform acted inside their university: a "Platform access" section on the
   tenant's analytics page lists the last 30 days of grants (who by handle,
   when, for how long, the reason) and how many actions each carried, read from
   `audit_log` in the tenant context. Open question 3 below.
10. **Docs.** Design §5 rewritten from intent to what was built; status table;
    `.env.example` unchanged (no new variable); PR body; no runbook beyond
    `pnpm db:migrate:all`.

## 2. Assumptions and open questions

1. **Window.** Maximum 60 minutes, default 30; a platform admin reopens if
   needed, each time with a reason and a line in the log. Longer windows weaken
   the "per-request switch" property. Confirm.
2. **Cookie domain.** `Domain=TENANT_BASE_DOMAIN` assumes production keeps
   `campusos.reivex.io` as the base and tenants as its subdomains, which is the
   documented setup. Confirm that no tenant will ever live on a host outside
   that base; if one might, the grant must travel by another route (a signed
   one-time URL into the tenant that sets a host-local cookie), which is more
   code and a second design decision.
3. **Transparency (step 9).** Showing a tenant's administrators that the
   platform acted in their university, with the reason, is proposed as in
   scope because it is the honest counterpart to god-mode. It is small. Say if
   it should wait.
4. **What a grant does not cover.** The platform admin under a grant is exactly
   a `tenant_admin`: they cannot see emails anywhere the tenant admin cannot
   (the pending verification queue is the one place either can), cannot read
   sessions or users beyond the definer functions' counts, and cannot touch
   another tenant in the same request. No exception is proposed.
5. **Revoking a platform admin.** Deleting the `platform_roles` row (SQL, or a
   later platform UI) ends new grants immediately; open grants die at their
   expiry. Should revocation also revoke open grants? Proposed yes, in the same
   statement, cheap to do.

## 3. Changes (by file)

- `packages/modules/identity/drizzle/0013_tenant_grants.sql`: table, index,
  RLS with FORCE, own-row policy.
- `packages/modules/identity/src/schema/identity.ts`: `tenantGrants`.
- `packages/modules/identity/src/grants.ts` (new, export `./grants`): open,
  close, live, plus `GRANT_MAX_MINUTES`, `GRANT_REASON_MIN`.
- `packages/db/src/tenant-context.ts`: `withActorInTenant(userId, tenantId, fn,
{ grantId? })` sets `app.grant_id` when given; nothing else changes.
- `packages/modules/identity/src/rbac.ts`: the grant branch in
  `canInTransaction` and `effectivePermissions`, as one shared SQL fragment
  with its reasoning in a comment; every identity function's `actor` type
  becomes `{ userId: string; grantId?: string }` and passes it through.
- `packages/modules/identity/src/audit.ts`: `admin_tenant_session_id` from
  `app.grant_id`.
- `apps/web/lib/auth.ts`: grant-aware `permitted` / `requirePermission`;
  `PermittedActor.grant`.
- `apps/web/lib/grant-cookie.ts`: name, options, domain derivation (pure,
  tested).
- `apps/web/app/api/platform/grants/route.ts`, `.../close/route.ts`: same
  origin, per client limit, platform admin, zod; set and clear the cookie.
- `apps/web/app/_components/admin/grant-banner.tsx`; rendered from the shared
  admin header the five admin pages already use for `AdminNav`.
- `apps/web/app/admin/tenants/[slug]/page.tsx`: the open-grant form.
- `apps/web/app/u/[slug]/admin/analytics/page.tsx`: "Platform access" section
  (step 9), from a new `identity/src/analytics.ts` read.
- `apps/web/messages/en.ts`: banner, form, refusals, transparency strings.
- `packages/core/src/tenant/schema.ts`: `adminEmails` docstring deprecated.
- Docs as in step 10.

## 4. Data and migration impact

One identity migration, additive, backwards compatible, human-run with the
usual `pnpm db:migrate:all`. Rollback: `drop table tenant_grants` (audit lines
keep their grant ids as plain values). Nothing changes for existing tenants,
members, roles or sessions.

## 5. Tests

- **Unit.** Duration clamp and reason rule; cookie options and domain
  derivation for the base domain, a subdomain request, and local dev.
- **Integration (identity suite, CI).** A tenant admin cannot open a grant; a
  platform admin can, with an audit line; a grant for tenant `aaa` yields the
  full permission set in `aaa` and **nothing** in `bbb`; an expired grant (set
  back by the migration role) and a revoked grant both yield nothing; a grant
  id belonging to another user yields nothing (own-row policy); a mutation done
  under a grant carries `admin_tenant_session_id` and rolls back if the audit
  insert is made to fail; the FORCE invariant includes `tenant_grants: true`;
  `information_schema` still has no `ip_hash`.
- **e2e.** Grant routes are 404 without the platform role; **a platform admin
  without a grant is 404 on every tenant admin page and mutation** (a minted
  platform admin session in the e2e database); with a grant cookie the
  verification page opens and the banner is present; after "End now" it is 404
  again.
- **Browser (local).** Open a grant for LGU from the platform admin, land on the
  tenant queue with the banner, grant a member `tenant_admin`, end the grant,
  confirm the 404 returns and the audit lines carry the grant id.

## 6. Verification steps (after approval and merge)

1. `pnpm db:migrate:all`.
2. As the platform admin: `/admin/tenants/lgu` → Open, reason, 15 minutes →
   the LGU queue with the banner. Members → grant yourself or a colleague
   `tenant_admin`. End now → `/admin` on the LGU host is 404 again.
3. `select action, admin_tenant_session_id from audit_log where tenant_id =
'lgu' order by at desc limit 5` shows the grant id on each line.

## 7. Follow-ups (already known)

- Removing `adminEmails` and `ensureConfiguredAdmin` once LGU's administrator
  holds the role through the UI (a small PR after production verification).
- A platform UI to list and revoke platform admins (today: SQL).
- Grants for a **read-only** look at a tenant (analytics without the ability to
  change anything) would be a second permission profile; not proposed now.
