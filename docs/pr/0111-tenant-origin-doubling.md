# fix(web): tenant links double the slug (lgu.lgu.campusos.reivex.io)

## What

Hotfix for a user-facing bug: clicking a university card on
`campusos.reivex.io` opened `https://lgu.lgu.campusos.reivex.io/` instead of
`https://lgu.campusos.reivex.io/` — the slug prepended to a host that already
carried it, the same doubling class as the old `/u/lgu/u/lgu` bug, now on the
hostname.

## Cause (both, as suspected)

1. **Helper logic.** `tenantUrlForHost(slug, host)` was host-reflective:
   `https://${slug}.${host}`. It assumed it was only ever called on the platform
   host. When a tenant-link emitter was itself served on a tenant host, it
   doubled: `lgu` + `.` + `lgu.campusos.reivex.io`.
2. **The env gap.** With `TENANT_BASE_DOMAIN`/`PLATFORM_HOST` not reaching the
   process (the recurring `ecosystem.config.cjs` forwarding gap), `planRoute`
   fails to recognise `lgu.campusos.reivex.io` as a tenant subdomain, so the
   platform landing (`app/page.tsx`) renders on the tenant host — exactly the
   condition that makes the host-reflective helper double. That env gap is fixed
   separately (boot-assertion PR); this PR makes the helper correct regardless.

## Fix

New central helper `tenantOrigin(slug)` in `lib/tenant-routing.ts`, replacing
`tenantUrlForHost`:

- **Base-domain, not host-reflective.** Builds `https://{slug}.{TENANT_BASE_DOMAIN}`
  from the configured base, so it is identical on whatever host it renders on.
  The request host is no longer an input, so a page served on the wrong host can
  no longer poison the link.
- **Idempotent.** If the base already leads with `{slug}.` (a tenant host passed
  in, or an already-doubled base), every leading `{slug}.` group is stripped so
  the slug appears exactly once. `{slug}.{slug}.*` is unrepresentable.
- **Fail safe + loud.** Returns null when there is no public base (local dev, or
  an absent/misconfigured base that fell back to localhost); callers emit the
  `/u/{slug}` path form instead of a wrong absolute host, and production logs the
  misconfiguration rather than silently constructing a bad host.

Adopted by every emitter so the guard is central: landing cards
(`app/page.tsx`), sitemap tenant-instance URLs (`app/sitemap.ts`), and
canonical/OG origin (`lib/metadata.ts` — now correct even if a tenant page is
served on a wrong host). `tenantUrlForHost` is removed so the doubling primitive
cannot be reintroduced.

## Files

- `apps/web/lib/tenant-routing.ts` — `tenantOrigin` replaces `tenantUrlForHost`.
- `apps/web/app/page.tsx`, `apps/web/app/sitemap.ts` — use `tenantOrigin`.
- `apps/web/lib/metadata.ts` — canonical/OG origin via `tenantOrigin`, host fallback.
- `apps/web/test/tenant-routing.test.ts` — `tenantOrigin` coverage.

## Data & migration impact

No schema change.

## Tests

`apps/web/test/tenant-routing.test.ts`: `tenantOrigin` is `{slug}.{base}`;
idempotent (never doubles); never yields `lgu.lgu.*` for any base it could render
against; null for a local/absent base (never a wrong absolute host).

```bash
pnpm -C apps/web exec vitest run test/tenant-routing.test.ts
```

## Verification steps

- `pnpm -C apps/web exec vitest run` (76 pass), `tsc --noEmit`, `next build` — all clean.
- On the platform host, a university card now links to
  `https://{slug}.{TENANT_BASE_DOMAIN}` (single hop, no doubling), regardless of
  which host the landing was served on.

## Follow-ups

- The environment forwarding gap (cause 2) is fixed by the boot-assertion PR;
  both are needed — this makes the link correct, that makes routing correct.
