# feat(web): read-mostly rooms admin (rename) + room dedup unique index

Targets `main`. Second of the two room PRs (auto-create shipped in PR #17). No
data migration; one additive base index migration plus an idempotent index
creation in the backfill. Deploy: `pnpm db:migrate:all && pnpm backfill:rooms &&
rebuild` (re-running the backfill is what creates the index on the existing DB).

## Why

With rooms auto-created and deduped on ingest, the old "map each pending room"
admin is obsolete: there is nothing to map. It is replaced by a read-mostly list
whose only edit is a display-name rename. The dedup invariant is now enforced by
the database.

## What

- **Retire the mapping backend.** Removed `AdminRoomsRepository.listPendingRooms`
  and `resolveRoom` (and `PendingRoom`/`ResolveRoom*`/`RoomResolveError`), the
  `/admin/rooms/resolve` route, and the pending-mapping UI. `backfillRooms` stays
  (the rollout script uses it).
- **Read-mostly rooms admin** (`admin/rooms/page.tsx`): an iOS-clean grouped list
  of rooms, each showing its building, capacity, and current class count. Rename
  is an unobtrusive per-row `<details>` disclosure (native, zero-JS) posting to a
  new `/admin/rooms/rename` route (same `isAdminAuthed` gate). `listRooms()` now
  returns building/capacity/entry-count; `renameRoom()` updates the display
  `name` only and never touches `dedup_key`, so a re-crawl of the original source
  string still resolves to the same room (no duplicate).
- **Partial unique index** `rooms_tenant_dedup_uq` on `(tenant_id, dedup_key)`
  WHERE `deleted_at IS NULL`, declared in the schema and created by base migration
  `0003` (fresh databases). On an already-migrated database that base migration is
  watermark-skipped (see PR #17's note), so the backfill creates it idempotently
  once the data is unique by key. `backfillRooms` now reports `duplicateKeys`; the
  script creates the index only when that is zero across all tenants, otherwise it
  skips and names the offenders (they need a room merge first).
- **Soft-delete filtering on room reads** (`getRoom`, `findFreeRooms`, admin
  `listRooms`), so a future merged-away (soft-deleted) room stops being browsable,
  free-room eligible, or listed. (Merge itself is the deferred fast-follow.)

## Data & migration impact

Additive base migration `0003_room_dedup_unique.sql` (partial unique index,
`IF NOT EXISTS`). No table data changes in the migration. The index is safe
because PR #17's backfill already deduped the data; the backfill re-run verifies
uniqueness (`duplicateKeys == 0`) before creating it on the existing DB. Rollback:
drop the index. No `tenant_id` scope change.

## Tests

- `test/rooms-admin.integration.test.ts` (new): `listRooms` returns
  building/capacity/entry-count; `renameRoom` trims and collapses the name,
  leaves `dedup_key` so a re-crawl reuses the room (asserted end to end),
  rejects unknown id / blank name, is tenant isolated; `backfillRooms` reports
  `duplicateKeys == 0` on deduped data.
- Existing room integration suites pass unchanged with the unique index present
  (verified against a freshly reset database, i.e. CI's path).
- `e2e/admin-auth.spec.ts`: the mutation gate check now targets the new
  `/admin/rooms/rename` route (401 unauth).

Commands: `pnpm turbo run typecheck lint format:check test build`,
`pnpm test:integration` (db 4 + module 22), `pnpm --filter web test:e2e` (10).

## Verification steps

Sign in at `/admin/login`, open `/admin/rooms`, confirm the list shows real rooms
with class counts, rename one, and confirm a re-ingest does not recreate the old
name. On the VPS, re-run `pnpm backfill:rooms` and confirm it logs
`✓ unique index rooms_tenant_dedup_uq ensured`.

## Follow-ups

- Room merge (the deferred fast-follow): repoint entries + `change_subscriptions`,
  soft-delete the loser, record its `dedup_key` as an alias; the soft-delete read
  filtering landed here in preparation.
- Separate the base/module drizzle migration watermark tables so base migrations
  added later are not skipped (this PR again works around it via the backfill).
