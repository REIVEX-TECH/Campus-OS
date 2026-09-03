# chore(identity): retire the shared admin secret

Targets `main`. Design doc PR 8, pulled forward. Admin access is a role on an
account from here on; nothing else opens the admin area.

## What

- **The shared `ADMIN_SECRET` password login is gone**: the `/admin/login` page,
  the secret submit route, the `/admin/logout` route, the per tenant signed
  `campusos_admin` cookie, and the helpers that read and issued it
  (`lib/admin-auth.ts`, `lib/admin-token.ts`). The `admin.login.*` strings go
  with them.
- **Rooms and analytics now gate on `requireTenantAdmin`**, the same gate the
  verification queue uses: a `tenant_memberships` row with `role = 'tenant_admin'`
  and `status = 'active'` for that tenant, read on every request. The room
  rename mutation gates on the same, and checks `Origin` and a per client limit
  first like every other mutation. Anyone else gets **404**, for pages and
  mutations alike, so the admin area's existence says nothing about who holds
  the role.
- **Bare `/admin`** sends a signed out visitor to the ordinary sign in, a member
  without the role to 404, and an admin to the verification queue. The three
  admin pages link to each other and share the account sign out.
- **A static guard test** (`no-admin-secret.test.ts`) scans the app, the
  packages, the env template and the deploy docs for the secret, the cookie, and
  the retired helpers. A future bypass would have to delete the test to land.

## One correction to the brief

There is **no `ADMIN_SESSION_SECRET`**, and none is needed. The account based
admin rides the ordinary `campusos_session` cookie: an opaque random token whose
sha256 is stored in `sessions`, resolved through a definer function on every
request. Nothing is signed, so there is no key to keep. After this PR **no admin
secret of any kind exists**; the only way into `/admin` is a Google sign in with
an address in the tenant's `adminEmails`, or a membership an admin granted.

## Lock out check

`tenants/lgu/tenant.config.ts` lists `ahadnawaz585@gmail.com`, which you have
confirmed reaches `/admin` without a secret. **The LGU address is still not in
the list**: I do not have it and will not guess. Add it in the same line before
or after merging; until then the gmail address is the only key.

## Data & migration impact

No schema change. `.env.example`, `docs/DEPLOY.md` and `docs/DEPLOY-VPS.md` no
longer ask for the secret; the "Tenant admins" section explains the account
path.

## Tests

- Unit: the static guard above. The old `admin-token` tests are deleted with
  the code they tested.
- e2e: `admin-auth` rewritten to pin 404 on all three admin pages and all three
  admin mutations without the role, and 404 on the retired login, submit and
  logout paths; `admin-entry` and `admin-subdomain` rewritten for the sign in
  redirect and its root relative Location on a tenant subdomain.
- `pnpm turbo run typecheck lint test`, `pnpm --filter web build` and
  `pnpm --filter web test:e2e` pass.

## Verification steps

After deploy (no migration):

1. Signed out, `https://lgu.<host>/admin` lands on sign in; `/admin/login`,
   `/admin/rooms` and `/admin/analytics` are 404.
2. Sign in with `ahadnawaz585@gmail.com`. `/admin` lands on the verification
   queue; rooms and analytics open from its links; rename a room.
3. Remove the old secret from the VPS env. Nothing changes.

## Follow-ups

- Add the LGU admin address to `adminEmails`.
- `docs/overnight/LOG.md` keeps its historical mention of the secret on purpose.
