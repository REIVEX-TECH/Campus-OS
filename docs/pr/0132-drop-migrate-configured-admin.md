# chore(identity): drop the one-time config-admin conversion tool

`auth_migrate_configured_admin` (identity `0023`) converted each config
`adminEmails` admin into a real `tenant_memberships` row. It ran once in
production (3a), and its only caller, `scripts/migrate-configured-admins.ts`, was
deleted when config-admin seeding was retired (3b). A dead owner-only definer
that still seeds `tenant_admin` for an arbitrary email is exactly the
dead-primitive pattern this project removes rather than leaves behind.

## What

- Migration `0028` drops the function (`DROP FUNCTION IF EXISTS
auth_migrate_configured_admin(text, text)`). The `0023` migration stays in
  history; this is its retirement.
- Removed from the `DEFINER_INTENT` map (so the now-live guard stays consistent:
  the function is gone from both the database and the map).
- Removed the `0023` describe from the identity isolation suite (it tested the
  dropped function).

## Data & migration impact

Migration `0028` drops one owner-only function; no table or data change. It was
already unreachable at runtime (owner-only, revoked from `campusos_app`, no
caller), so nothing behavioural changes. No rollback needed.

## Tests

`DEFINER_INTENT` (now running) confirms no undeclared/stale definer after the
drop; journal parity confirms `0028` is paired.

```bash
pnpm -C packages/modules/identity test:integration
pnpm -C packages/modules/communities test:integration
```

## Follow-ups

None. The config-admin machinery is fully gone: the field, the seeding path, the
self-promotion definer (`0025`), and now the one-time conversion tool.
