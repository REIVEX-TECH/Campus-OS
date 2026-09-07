# fix(media): exclude /media from the tenant rewrite, assert MEDIA_DATA_DIR at boot

Object-storage serving needed three loose ends closed before Marketplace leans on
it harder.

## What

- **/media is never tenant-rewritten.** On a tenant subdomain, `/media/x.webp` was
  rewritten to `/u/{label}/media/x.webp` and 404d. `media` is added to the
  middleware matcher (so the middleware never runs for it, mirroring `api`), and
  `planRoute` short-circuits `/media/...` to `next` (unit-tested).
- **MEDIA_DATA_DIR boot check.** Flipped to `requiredInProduction` in
  `app-env.vars.json`, so the boot assertion fails closed if it is unset in
  production instead of letting the first upload throw at runtime.
- **e2e image upload test.** A member posts a Lost & Found item with a real image
  (a 1x1 PNG through the sharp pipeline) and the resulting `/media` URL is fetched
  and asserted 200 + `image/*`. The Playwright web server now sets `MEDIA_DATA_DIR`
  to a temp dir.

## Data & migration impact

No schema change.

## Tests

- Unit: `planRoute` passes `/media` through on tenant, platform, and legacy hosts
  (`tenant-routing.test.ts`).
- e2e: `lost-found-upload.spec.ts` (posts a photo, fetches it from `/media`).
- Typecheck, lint, format, unit green locally.

## Verification

1. On a tenant subdomain, load an item with a photo; the thumbnail serves from
   `/media/...` (nginx in prod, the dev route locally).
2. Unset MEDIA_DATA_DIR in production and boot: the process refuses to start with a
   clear message (do not actually do this in prod; it is the boot check's point).

## Follow-ups

Lost & Found still leaks photo files on withdraw/remove/expire (separate PR).
