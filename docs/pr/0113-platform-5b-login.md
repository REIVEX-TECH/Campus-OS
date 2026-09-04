# feat(platform): 5B piece 1 - platform login at /login

## What

Phase 5B, piece 1: the platform-host login. The platform login and the tenant
list already existed (`app/signin/page.tsx`, `app/admin/page.tsx` from Phase 4);
`platform_roles` was empty only because promotion reads `SUPERADMIN_EMAILS`, which
was not reaching the process (the env forwarding gap, fixed separately). This
piece adds the `/login` URL platform admins reach for and makes both names serve
one implementation.

- `app/_components/platform-sign-in.tsx` - the platform-host sign in extracted
  into a shared server component (redirects to `/admin` when already signed in;
  renders the Google button with `tenant={null}`).
- `app/signin/page.tsx` and `app/login/page.tsx` both render it - the same door,
  two names. On a tenant host both paths are rewritten to the tenant tree by
  middleware, so this serves the platform host alone.
- `app/admin/page.tsx` - the signed-out placeholder's sign-in button now points
  at `/login`.

Signing in here runs `ensurePlatformAdmin(actor, superadminEmails())` (session
route), which writes the one `platform_roles` row for a listed address. So with
`SUPERADMIN_EMAILS` now in the process, signing in at `campusos.reivex.io/login`
promotes the admin and `/admin` shows the tenant list.

## Data & migration impact

No schema change.

## Tests

- `apps/web/e2e/admin-entry.spec.ts`: `/login` and `/signin` both serve the
  platform sign in (200, "Sign in to CampusOS") on the platform host.

```bash
pnpm -C apps/web exec playwright test e2e/admin-entry.spec.ts
```

## Verification steps

- `tsc --noEmit`, `next build` clean; `/login` and `/signin` both build as
  dynamic routes.
- Operator: visit `campusos.reivex.io/login`, sign in with a `SUPERADMIN_EMAILS`
  address, land on `/admin` and see the tenant list.

## Follow-ups

- Pieces 2 to 4: open/close a grant with preflight + visible countdown; typed
  redirect on mid-request grant expiry; `statement_timeout` on granted
  transactions; `auth_tenant_grants_for_tenant` in the tenant admin view.
