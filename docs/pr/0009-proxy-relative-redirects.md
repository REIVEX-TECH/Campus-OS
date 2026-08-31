# fix(web): relative redirect Location behind the reverse proxy

Targets `main`. No schema change, no migration.

## The bug

After a successful admin login on the VPS, the browser was redirected to
`http://localhost:3003/admin/rooms` (the app's internal upstream host:port) and
failed with `ERR_CONNECTION_REFUSED`. The admin route handlers built the redirect
target with `new URL(path, request.url)`, and behind nginx `request.url` is the
upstream socket origin (`http://127.0.0.1:3003/...`), not the public
`https://lgu.reivex.io`. So every admin redirect (login submit, logout, resolve)
pointed at the wrong host.

## The fix

Emit **root-relative** `Location` headers so the browser resolves them against
the public origin it is already on.

- **`lib/redirects.ts`**: `relativeRedirect(location, status = 303)` returns a
  `NextResponse` with a relative `Location` (never an absolute upstream URL).
- **Admin route handlers** (`login/submit`, `logout`, `rooms/resolve`): every
  `NextResponse.redirect(new URL(..., request.url))` is replaced with
  `relativeRedirect(...)`. Cookies (login/logout) are still set on the response.
- **`middleware.ts`**: the canonicalising `/u/{label}/* -> /*` redirect stays
  absolute (Next middleware requires an absolute URL), but it is built from
  `req.nextUrl`, which comes from the forwarded `Host` header (the public host),
  not the upstream socket, so it is correct behind the proxy. Only route handlers
  (which use `request.url` = the socket) need the relative form.
- The `redirect()` (next/navigation) calls in `requireAdmin` and the login page
  already pass relative string paths and were unaffected; audited and left as is.

Canonical/SEO URLs are unchanged: they derive from the forwarded `Host` header
(nginx `proxy_set_header Host $host`), which is the public host, not the socket.

## Docs

`docs/DEPLOY-VPS.md`: the nginx vhost now also sets `X-Forwarded-Host $host`
(for completeness) and the note states redirects are relative, so the upstream
host never leaks and `X-Forwarded-Host` is not required.

## Tests

- **Unit** (`test/redirects.test.ts`): `relativeRedirect` returns a relative
  `Location` (starts with `/`, not `http(s)://`) with the right status and query.
- **E2E** (`e2e/admin-subdomain.spec.ts`): the admin login POST (simulated
  subdomain) redirects with a **relative** `Location` that is not absolute and
  does not contain `localhost` — the exact regression. (In e2e the upstream and
  public host coincide, so only asserting the Location shape catches the bug.)

```bash
pnpm --filter web test        # 18 unit tests
pnpm turbo run typecheck lint format:check build test   # all 22 tasks green
```

## Data & migration impact

None.
