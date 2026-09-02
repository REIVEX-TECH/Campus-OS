# fix(web): set metadataBase so social cards resolve

Targets `main`. Removes the build warning that shared-link previews were being
resolved against `http://localhost:3000`.

## What

Next needs an absolute origin to turn a relative Open Graph image into a shareable
URL. Tenant pages already set one per request from the host, in `pageMetadata`.
Statically rendered routes cannot: the 404 and the platform `opengraph-image` are
prerendered, so there is no request host to read, and Next fell back to
`http://localhost:3000` and warned.

The root layout now sets `metadataBase` from configuration, preferring
`PLATFORM_HOST` and falling back through `TENANT_BASE_DOMAIN` and `APP_DOMAIN`.
It reuses `baseUrlFromHost`, so it picks http for local hosts and https
elsewhere, exactly like every other URL the app builds. Tenant pages still
override it per request with their own host, so a tenant's cards keep pointing at
the tenant.

Deliberately configuration and not `headers()`: reading the request host in the
root layout would opt the whole tree into dynamic rendering and de-optimise the
routes that are currently prerendered, to fix metadata for the few routes that
have no host anyway.

## Data & migration impact

None.

## Tests

- The build no longer emits the `metadataBase` warning, which was the defect.
- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (32) pass.
- `.env.example` documents that `PLATFORM_HOST` now also sets this origin, so an
  operator knows leaving it unset makes previews point at localhost.

## Verification steps

`pnpm turbo run build --filter=web` prints no `metadataBase` warning. With
`PLATFORM_HOST` set, view source on a page and the `og:image` is absolute on that
host.

## Follow-ups

None.
