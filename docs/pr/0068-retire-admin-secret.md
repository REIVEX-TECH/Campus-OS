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

## What the bypass sweep found

A sweep hunted for any remaining way into the admin area. Two things it raised
turned out to be real and are fixed here:

- **pm2 was still forwarding `ADMIN_SECRET`**, and its comment still told the
  next reader the app read it. Nothing consumed the value, so nothing broke and
  nothing said so; what it left was a live instruction to keep setting a secret
  that no longer does anything, and the obvious place to wire one back in. The
  forward and the comment are gone. The guard test never looked at
  `ecosystem.config.cjs`, which is why the first pass missed it, so the scan now
  covers it: reintroducing the line fails the test.
- **The sign in provider was not pinned.** Firebase issues tokens for every
  method a project has enabled, all signed by the same keys and all carrying
  `email_verified`. Admin is granted by matching an address against
  `adminEmails`, so any other enabled provider able to assert a verified address
  would have been a second door into the admin area, opened from the Firebase
  console rather than from this repo. Only Google is offered in the UI, so only
  `sign_in_provider === 'google.com'` is accepted now.

The claim checks moved into a pure `identityFromClaims` so they can be tested
without key material; the signature, audience, issuer and expiry checks are
unchanged and still run first.

`docs/pr/` is deliberately outside the guard's scan: those files record what
each change did at the time, and several describe the secret while it existed.
Rewriting them would be falsifying history rather than retiring a secret.

## Data & migration impact

No schema change. `.env.example`, `docs/DEPLOY.md` and `docs/DEPLOY-VPS.md` no
longer ask for the secret; the "Tenant admins" section explains the account
path.

## Tests

- Unit: the static guard above, now covering the deploy config (verified by
  reintroducing the forward and watching it fail); `identityFromClaims` accepts
  Google and refuses `password`, `anonymous`, `github.com`, `custom`,
  `facebook.com`, a missing provider claim, an unverified address however it is
  spelled, and a missing subject or address. The old `admin-token` tests are
  deleted with the code they tested.
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
3. Remove `ADMIN_SECRET` from the VPS `.env`. Nothing changes: no code reads it
   and pm2 no longer forwards it.

## Follow-ups

- Add the LGU admin address to `adminEmails`.
- `docs/overnight/LOG.md` keeps its historical mention of the secret on purpose.
